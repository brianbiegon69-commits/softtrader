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
    document.getElementById("loginBtn").textContent = me.accounts[0].account;
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
