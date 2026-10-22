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

// Sessions live in memory. For production with several server instances,
// replace this Map with Redis or a database.
const sessions = new Map(); // sid -> { accounts: [{ account, token, currency }], created }
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

setInterval(() => {
  const now = Date.now();
  for (const [sid, s] of sessions) if (now - s.created > SESSION_TTL_MS) sessions.delete(sid);
}, 60 * 60 * 1000).unref();

app.get('/auth/login', (req, res) => {
  if (!APP_ID) return res.status(500).send('DERIV_APP_ID is not configured on the server.');
  res.redirect(`https://oauth.deriv.com/oauth2/authorize?app_id=${encodeURIComponent(APP_ID)}&l=EN`);
});

app.get('/auth/signup', (req, res) => res.redirect(SIGNUP_URL));

// Deriv redirects here with ?acct1=...&token1=...&cur1=...&acct2=... etc.
app.get('/auth/callback', (req, res) => {
  const accounts = [];
  for (let i = 1; req.query[`acct${i}`]; i++) {
    accounts.push({
      account: String(req.query[`acct${i}`]),
      token: String(req.query[`token${i}`] || ''),
      currency: String(req.query[`cur${i}`] || '')
    });
  }
  if (!accounts.length) return res.redirect('/?login=failed');

  const sid = crypto.randomBytes(32).toString('hex');
  sessions.set(sid, { accounts, created: Date.now() });
  res.cookie('sid', sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: SESSION_TTL_MS
  });
  // Tokens are kept server-side only; they are not placed in the page URL.
  res.redirect('/?login=success');
});

function getSession(req) {
  const s = sessions.get(req.cookies.sid);
  return s && Date.now() - s.created < SESSION_TTL_MS ? s : null;
}

// Safe info for the front end (no tokens)
app.get('/api/me', (req, res) => {
  const s = getSession(req);
  if (!s) return res.status(401).json({ loggedIn: false });
  res.json({
    loggedIn: true,
    accounts: s.accounts.map(({ account, currency }) => ({ account, currency }))
  });
});

app.post('/auth/logout', (req, res) => {
  sessions.delete(req.cookies.sid);
  res.clearCookie('sid');
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */

app.get('/api/health', (req, res) => res.json({ ok: true, derivConnected: ws && ws.readyState === WebSocket.OPEN }));

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`Pulsedesk server running on http://localhost:${PORT}`));
