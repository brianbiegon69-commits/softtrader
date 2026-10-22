/* ---------- Markets board ---------- */
// Sample values shown until the backend streams live prices.
const markets = [
  { name: "Volatility 10",  quote: "10105.82", dir: "dn" },
  { name: "Volatility 25",  quote: "2840.70",  dir: "up" },
  { name: "Volatility 50",  quote: "153.14",   dir: "up" },
  { name: "Volatility 75",  quote: "34352.11", dir: "dn" },
  { name: "Volatility 100", quote: "1025.57",  dir: "up" },
  { name: "Bull Market",    quote: "1009.27",  dir: "up" },
  { name: "Bear Market",    quote: "1020.92",  dir: "dn" }
];

// Map the backend's labels to friendly names
const FRIENDLY = {
  "VOL 10": "Volatility 10", "VOL 25": "Volatility 25", "VOL 50": "Volatility 50",
  "VOL 75": "Volatility 75", "VOL 100": "Volatility 100", "VOL 150": "Volatility 150",
  "BULL MARKET": "Bull Market", "BEAR MARKET": "Bear Market"
};

const rowsEl = document.getElementById("rows");
const byName = new Map(markets.map(m => [m.name, m]));

function render() {
  rowsEl.innerHTML = [...byName.values()].map(m =>
    `<div class="row"><b>${m.name}</b><span class="px ${m.dir}">${m.quote} ${m.dir === "up" ? "▲" : "▼"}</span></div>`
  ).join("");
}
render();

/* ---------- Live ticks from the backend (optional) ---------- */
if (window.EventSource) {
  const es = new EventSource("/api/ticks");
  let queued = false;
  es.onmessage = e => {
    let t;
    try { t = JSON.parse(e.data); } catch { return; }
    const name = FRIENDLY[t.name] || t.name;
    byName.set(name, { name, quote: Number(t.quote).toFixed(2), dir: t.dir });
    document.getElementById("status").textContent = "Live";
    if (!queued) { queued = true; setTimeout(() => { queued = false; render(); }, 1000); }
  };
  // No backend running (e.g. static hosting): stop retrying and keep the sample data.
  let gotData = false;
  es.addEventListener("message", () => { gotData = true; });
  es.onerror = () => { if (!gotData) es.close(); };
}

/* ---------- Login status ---------- */
fetch("/api/me")
  .then(r => (r.ok ? r.json() : null))
  .then(me => {
    if (!me || !me.loggedIn) return;
    document.getElementById("loginBtn").textContent = "Logged in";
  })
  .catch(() => {});

document.getElementById("year").textContent = new Date().getFullYear();


/* ---------- Strategy notebook (saved in this browser only) ---------- */
(function () {
  const KEY = "pulsedesk_strategies";
  const form = document.getElementById("sForm");
  if (!form) return;
  const list = document.getElementById("saved");
  const countEl = document.getElementById("count");

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
  }
  function store(items) {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* storage blocked */ }
  }
  function line(label, text) {
    if (!text) return null;
    const p = document.createElement("p");
    const b = document.createElement("b");
    b.textContent = label + ": ";
    p.append(b, document.createTextNode(text));
    return p;
  }
  function render() {
    const items = load();
    countEl.textContent = items.length ? "(" + items.length + ")" : "";
    list.replaceChildren();
    if (!items.length) {
      const e = document.createElement("p");
      e.className = "empty";
      e.textContent = "Nothing saved yet. Fill in the form and press Save strategy.";
      list.append(e);
      return;
    }
    items.forEach(it => {
      const box = document.createElement("div");
      box.className = "saved-item";
      const h = document.createElement("h4"); h.textContent = it.name;
      const m = document.createElement("div"); m.className = "meta"; m.textContent = it.market + " \u00b7 " + it.type;
      box.append(h, m);
      [line("Entry", it.entry), line("Exit / stake", it.exit),
       line("Stake", it.stake), line("Daily loss limit", it.loss), line("Notes", it.notes)]
        .filter(Boolean).forEach(n => box.append(n));
      const del = document.createElement("button");
      del.type = "button"; del.textContent = "Delete";
      del.onclick = () => { store(load().filter(x => x.id !== it.id)); render(); };
      box.append(del);
      list.append(box);
    });
  }

  form.addEventListener("submit", e => {
    e.preventDefault();
    const v = id => document.getElementById(id).value.trim();
    const name = v("sName");
    if (!name) return;
    const items = load();
    items.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name, market: v("sMarket"), type: v("sType"),
      entry: v("sEntry"), exit: v("sExit"), stake: v("sStake"), loss: v("sLoss"), notes: v("sNotes"),
      saved: new Date().toISOString()
    });
    store(items.slice(0, 100));
    form.reset();
    render();
  });

  document.getElementById("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(load(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pulsedesk-strategies.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  /* Example strategy: fills the form with a practice test */
  function fillExample(focusAfter) {
    const set = (id, val) => { document.getElementById(id).value = val; };
    set("sName", "Even Keel 100");
    set("sMarket", "Volatility 100");
    set("sType", "Even / Odd");
    set("sEntry", "Always trade Even, 1 tick duration. No pattern-watching.");
    set("sExit", "Same small stake every trade, never changed. Take 100 trades. Stop early if the balance falls 10% in one session.");
    set("sStake", "1");
    set("sLoss", "10% of balance");
    set("sNotes", "");
    if (focusAfter) document.getElementById("sName").focus();
  }
  function clearForm() {
    ["sName","sEntry","sExit","sStake","sLoss","sNotes"].forEach(id => { document.getElementById(id).value = ""; });
    document.getElementById("sName").focus();
  }
  document.getElementById("tplBtn").addEventListener("click", () => fillExample(true));
  document.getElementById("clearBtn").addEventListener("click", clearForm);
  // Start with the example already filled in (no focus, so the page does not scroll).
  fillExample(false);

  render();

  /* Stake calculator */
  const bal = document.getElementById("cBal"), risk = document.getElementById("cRisk"), out = document.getElementById("cOut");
  function calc() {
    const b = parseFloat(bal.value), r = parseFloat(risk.value);
    if (!(b > 0) || !(r > 0) || r > 100) { out.textContent = "Enter your balance to see a suggested maximum stake."; return; }
    const stake = b * r / 100;
    out.replaceChildren(
      document.createTextNode("Suggested maximum stake per trade: "),
      Object.assign(document.createElement("b"), { textContent: stake.toFixed(2) }),
      document.createTextNode(" (" + r + "% of " + b + "). This is a guide for limiting losses, not advice.")
    );
  }
  bal.addEventListener("input", calc);
  risk.addEventListener("input", calc);
})();


/* ---------- Practice runner: places the example trades on a DEMO account only ---------- */
(function () {
  const box = document.getElementById("runner");
  if (!box) return;
  const $ = id => document.getElementById(id);

  // Even Keel 100: always Even, 1 tick, Volatility 100.
  const SYMBOL = "R_100";
  const CONTRACT = "DIGITEVEN";
  const MAX_TRADES = 100, MAX_STAKE = 100, STEP_TIMEOUT = 20000, RESULT_TIMEOUT = 30000;

  let ws = null, running = false, stopRequested = false, reqId = 0;
  const waiters = new Map();      // req_id -> { resolve, reject, timer }
  let contractWait = null;        // { id, resolve, reject, timer }
  const debug = [];

  function mask(t) { return t.replace(/otp=[^"&\s]+/g, "otp=***"); }
  function dlog(dir, obj) {
    let t; try { t = typeof obj === "string" ? obj : JSON.stringify(obj); } catch { t = String(obj); }
    debug.push(dir + " " + mask(t).slice(0, 400));
    if (debug.length > 80) debug.shift();
    $("rDebug").textContent = debug.join("\n");
  }
  function status(t, bad) { const e = $("rStatus"); e.textContent = t; e.className = "out" + (bad ? " bad" : ""); }
  function errOf(m) {
    const e = m && (m.error || (Array.isArray(m.errors) && m.errors[0]));
    return e ? (e.message || e.code || JSON.stringify(e)) : null;
  }

  function onMessage(ev) {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.msg_type !== "tick") dlog("<-", m);
    const err = errOf(m);
    const w = m.req_id != null ? waiters.get(m.req_id) : null;
    if (w) {
      clearTimeout(w.timer); waiters.delete(m.req_id);
      err ? w.reject(new Error(err)) : w.resolve(m);
    } else if (err && contractWait) {
      clearTimeout(contractWait.timer);
      const c = contractWait; contractWait = null; c.reject(new Error(err));
    }
    const poc = m.proposal_open_contract || (m.data && m.data.proposal_open_contract);
    if (poc && contractWait && String(poc.contract_id) === String(contractWait.id)) {
      const st = String(poc.status || "").toLowerCase();
      const done = poc.is_sold === 1 || poc.is_sold === true || st === "won" || st === "lost" || st === "sold";
      if (done) {
        clearTimeout(contractWait.timer);
        const c = contractWait; contractWait = null;
        const profit = Number(poc.profit);
        c.resolve({ profit, win: st === "won" || profit > 0 });
      }
    }
  }

  function request(payload) {
    return new Promise((resolve, reject) => {
      const id = ++reqId;
      const timer = setTimeout(() => { waiters.delete(id); reject(new Error("No answer from Deriv (see debug log)")); }, STEP_TIMEOUT);
      waiters.set(id, { resolve, reject, timer });
      const msg = Object.assign({}, payload, { req_id: id });
      dlog("->", msg);
      ws.send(JSON.stringify(msg));
    });
  }

  function waitContract(id) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { contractWait = null; reject(new Error("Contract result did not arrive (see debug log)")); }, RESULT_TIMEOUT);
      contractWait = { id, resolve, reject, timer };
      const msg = { proposal_open_contract: 1, contract_id: id, subscribe: 1, req_id: ++reqId };
      dlog("->", msg);
      ws.send(JSON.stringify(msg));
    });
  }

  function addRow(n, win, profit, pl) {
    const r = document.createElement("div"); r.className = "rrow";
    const a = document.createElement("span"); a.textContent = "#" + n;
    const b = document.createElement("span"); b.className = win ? "w" : "l"; b.textContent = win ? "Win" : "Loss";
    const c = document.createElement("span"); c.textContent = (profit >= 0 ? "+" : "") + profit.toFixed(2);
    const d = document.createElement("span"); d.textContent = "P/L " + (pl >= 0 ? "+" : "") + pl.toFixed(2);
    r.append(a, b, c, d);
    $("rLog").prepend(r);
  }

  function summary(t, w, l, pl) {
    const rate = t ? (w / t * 100).toFixed(1) : "0.0";
    const e = $("rSummary"); e.replaceChildren();
    const b = document.createElement("b"); b.textContent = "Trades " + t + " · Wins " + w + " · Losses " + l + " · Win rate " + rate + "% · P/L " + (pl >= 0 ? "+" : "") + pl.toFixed(2);
    e.append(b);
    const n = document.createElement("div");
    n.textContent = "Break-even needs roughly 51–52% wins at a ~95% payout. Small samples are mostly noise, so judge the result after many trades.";
    e.append(n);
  }

  function setRunning(on) {
    running = on;
    $("rStart").disabled = on;
    $("rStop").disabled = !on;
    ["rStake", "rTrades", "rLoss"].forEach(id => { $(id).disabled = on; });
  }

  async function run() {
    const stake = Math.min(MAX_STAKE, Math.max(0.35, parseFloat($("rStake").value) || 1));
    const total = Math.min(MAX_TRADES, Math.max(1, parseInt($("rTrades").value, 10) || MAX_TRADES));
    const maxLoss = Math.max(0, parseFloat($("rLoss").value) || 0);
    $("rStake").value = stake; $("rTrades").value = total;
    stopRequested = false; setRunning(true);
    $("rLog").replaceChildren(); $("rSummary").replaceChildren();
    let t = 0, w = 0, l = 0, pl = 0;
    try {
      status("Requesting a demo connection…");
      const r = await fetch("/api/demo/otp", { method: "POST" });
      const info = await r.json().catch(() => ({}));
      if (info.accounts) dlog("accounts", info.accounts);
      if (!r.ok || !info.url) throw new Error(info.message || "Could not get a demo connection (" + r.status + ")");
      // Safety check in the browser as well: only ever connect to Deriv's demo endpoint.
      if (!/\/ws\/demo\?/.test(info.url)) throw new Error("Refusing to run: this is not a demo connection.");
      const currency = info.currency || "USD";

      ws = new WebSocket(info.url);
      ws.onmessage = onMessage;
      await new Promise((res, rej) => {
        ws.onopen = res;
        ws.onerror = () => rej(new Error("Could not open the demo connection"));
      });
      ws.onclose = () => dlog("--", "connection closed");
      dlog("--", "connected to demo account " + (info.accountId || ""));

      for (let i = 1; i <= total && !stopRequested; i++) {
        status("Trade " + i + " of " + total + "…");
        const prop = await request({
          proposal: 1, amount: stake, basis: "stake", contract_type: CONTRACT, currency,
          duration: 1, duration_unit: "t", underlying_symbol: SYMBOL
        });
        const p = prop.proposal || (prop.data && (prop.data.proposal || prop.data)) || {};
        const pid = p.id || p.proposal_id;
        const ask = Number(p.ask_price != null ? p.ask_price : (p.price != null ? p.price : stake));
        if (!pid) throw new Error("The price quote had no id (see debug log)");
        const bought = await request({ buy: pid, price: ask });
        const b = bought.buy || (bought.data && (bought.data.buy || bought.data)) || {};
        if (!b.contract_id) throw new Error("The purchase had no contract id (see debug log)");
        const res = await waitContract(b.contract_id);
        t++; if (res.win) w++; else l++;
        pl += res.profit;
        addRow(t, res.win, res.profit, pl);
        summary(t, w, l, pl);
        if (maxLoss > 0 && pl <= -maxLoss) { status("Stopped: demo loss limit reached."); break; }
      }
      if ($("rStatus").textContent.indexOf("Stopped") !== 0) {
        status(stopRequested ? "Stopped by you." : "Finished " + t + " trades.");
      }
    } catch (e) {
      status("Stopped: " + e.message, true);
      dlog("!!", e.message);
    } finally {
      try { if (ws) ws.close(); } catch { /* ignore */ }
      ws = null; waiters.clear(); contractWait = null;
      if (t) summary(t, w, l, pl);
      setRunning(false);
    }
  }

  $("rStart").addEventListener("click", () => { if (!running) run(); });
  $("rStop").addEventListener("click", () => { stopRequested = true; status("Stopping after the current trade…"); });

  // Only offer the runner to logged-in visitors.
  fetch("/api/me").then(r => {
    if (r.ok) { status("Ready. Press Start demo run."); return; }
    $("rStart").disabled = true; $("rLogin").style.display = "inline-block";
  }).catch(() => { $("rStart").disabled = true; });

  // Exposed for testing only
  window.__runner = { onMessage };
})();
