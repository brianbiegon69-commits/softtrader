require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const APP_ID = process.env.DERIV_APP_ID;
const SIGNUP_URL = process.env.DERIV_SIGNUP_URL || 'https://deriv.com/signup/';
const IS_PROD = process.env.NODE_ENV === 'production';

if (!APP_ID) {
  console.warn('WARNING: DERIV_APP_ID is not set. Login and live ticks will not work until you add it to .env');
}

const app = express();
app.set('trust proxy', 1); // needed behind Vercel/Nginx so secure cookies work
app.use(express.json());
app.use(cookieParser());

/* ------------------------------------------------------------------ */
/* Deriv live ticks: one shared WebSocket, fanned out to browsers (SSE) */
/* ------------------------------------------------------------------ */

// Label shown on the site -> Deriv symbol. Verify symbols with an `active_symbols`
// call if any come back empty (Deriv occasionally renames them).
const SYMBOLS = {
  'VOL 10': 'R_10',
  'VOL 25': 'R_25',
  'VOL 50': 'R_50',
  'VOL 75': 'R_75',
  'VOL 100': 'R_100',
  'VOL 150': '1HZ150V',
  'BULL MARKET': 'RDBULL',
  'BEAR MARKET': 'RDBEAR'
};
const LABEL_BY_SYMBOL = Object.fromEntries(Object.entries(SYMBOLS).map(([k, v]) => [v, k]));

const latest = {};          // label -> { name, quote, dir, cls }
const sseClients = new Set();
let ws, pingTimer, retry = 0;

function connectDeriv() {
  if (!APP_ID) return;
  ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(APP_ID)}`);

  ws.on('open', () => {
    retry = 0;
    console.log('Connected to Deriv WebSocket');
    Object.values(SYMBOLS).forEach(sym => ws.send(JSON.stringify({ ticks: sym, subscribe: 1 })));
    clearInterval(pingTimer);
    pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ ping: 1 })), 30000);
  });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.error) { console.error('Deriv error:', msg.error.message); return; }
    if (msg.msg_type !== 'tick' || !msg.tick) return;

    const label = LABEL_BY_SYMBOL[msg.tick.symbol];
    if (!label) return;
    const prev = latest[label];
    const quote = msg.tick.quote;
    const dir = prev ? (quote >= prev.quote ? 'up' : 'dn') : 'up';
    const cls = label === 'BULL MARKET' ? 'bull' : label === 'BEAR MARKET' ? 'bear' : '';
    latest[label] = { name: label, quote, dir, cls };

    const payload = `data: ${JSON.stringify(latest[label])}\n\n`;
    sseClients.forEach(res => res.write(payload));
  });

  ws.on('close', () => {
    clearInterval(pingTimer);
    const delay = Math.min(30000, 1000 * 2 ** retry++);
    console.log(`Deriv WebSocket closed, reconnecting in ${delay / 1000}s`);
    setTimeout(connectDeriv, delay);
  });

  ws.on('error', err => console.error('Deriv WebSocket error:', err.message));
}
connectDeriv();

app.get('/api/ticks', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  // send what we already have so the ticker fills instantly
  Object.values(latest).forEach(t => res.write(`data: ${JSON.stringify(t)}\n\n`));
  sseClients.add(res);
  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 25000);
  req.on('close', () => { clearInterval(keepAlive); sseClients.delete(res); });
});

/* ------------------------------------------------------------------ */
/* Deriv OAuth login                                                   */
/* ------------------------------------------------------------------ */

// Sessions are stored in an encrypted cookie (AES-256-GCM), not in server memory,
// so login keeps working on serverless hosts like Vercel where every request may
// hit a different instance. Set SESSION_SECRET to a long random string in production.
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
if (!process.env.SESSION_SECRET) {
  console.warn('WARNING: SESSION_SECRET is not set. Using a temporary key: logins will not survive restarts or work across serverless instances.');
}
const KEY = crypto.createHash('sha256')
  .update(process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'))
  .digest();

function seal(data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url');
}

function open(token) {
  try {
    const buf = Buffer.from(String(token), 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    const out = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
    return JSON.parse(out.toString('utf8'));
  } catch {
    return null;
  }
}

const AUTH_BASE = 'https://auth.deriv.com/oauth2';
const b64url = buf => Buffer.from(buf).toString('base64url');
const PKCE_TTL_MS = 10 * 60 * 1000;

// The callback URL must exactly match the redirect URL registered on Deriv.
// Set REDIRECT_URI in the environment to pin it; otherwise it is built from the request.
function redirectUri(req) {
  return process.env.REDIRECT_URI || `${req.protocol}://${req.get('host')}/auth/callback`;
}

// Step 1: send the visitor to Deriv's login page (OAuth 2.0 authorization code flow with PKCE).
app.get('/auth/login', (req, res) => {
  if (!APP_ID) return res.status(500).send('DERIV_APP_ID is not configured on the server.');
  const state = crypto.randomBytes(16).toString('hex');
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  res.cookie('pkce', seal({ state, verifier, created: Date.now() }), {
    httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: PKCE_TTL_MS
  });
  const url = new URL(`${AUTH_BASE}/auth`);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: APP_ID,
    redirect_uri: redirectUri(req),
    scope: 'trade',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  }).toString();
  res.redirect(url.toString());
});

app.get('/auth/signup', (req, res) => res.redirect(SIGNUP_URL));

// Step 2: Deriv sends the visitor back here with ?code=...&state=...
// The code is exchanged for an access token on the server, never in the browser.
app.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const p = req.cookies.pkce ? open(req.cookies.pkce) : null;
  res.clearCookie('pkce');
  if (error || !code || !p || p.state !== state || Date.now() - p.created > PKCE_TTL_MS) {
    return res.redirect('/?login=failed');
  }
  try {
    const r = await fetch(`${AUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: APP_ID,
        code: String(code),
        code_verifier: p.verifier,
        redirect_uri: redirectUri(req)
      })
    });
    const tok = await r.json().catch(() => ({}));
    if (!r.ok || !tok.access_token) {
      console.error('Token exchange failed:', r.status, tok.error || '');
      return res.redirect('/?login=failed');
    }
    const ttl = Math.min((Number(tok.expires_in) || 3600) * 1000, SESSION_TTL_MS);
    // The access token stays in an encrypted, httpOnly cookie and is never sent to page scripts.
    res.cookie('sid', seal({ accessToken: tok.access_token, created: Date.now(), ttl }), {
      httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: ttl
    });
    res.redirect('/?login=success');
  } catch (e) {
    console.error('Token exchange error:', e.message);
    res.redirect('/?login=failed');
  }
});

function getSession(req) {
  const s = req.cookies.sid ? open(req.cookies.sid) : null;
  return s && Date.now() - s.created < (s.ttl || SESSION_TTL_MS) ? s : null;
}

// Safe info for the front end (never includes the token)
app.get('/api/me', (req, res) => {
  const s = getSession(req);
  if (!s) return res.status(401).json({ loggedIn: false });
  res.json({ loggedIn: true });
});

app.post('/auth/logout', (req, res) => {
  res.clearCookie('sid');
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */

app.get('/api/health', (req, res) => res.json({ ok: true, derivConnected: ws && ws.readyState === WebSocket.OPEN }));

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`Pulsedesk server running on http://localhost:${PORT}`));

module.exports = app; // lets serverless hosts such as Vercel use the app directly
