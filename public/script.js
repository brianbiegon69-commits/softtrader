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
