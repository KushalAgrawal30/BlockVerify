// Generates the report's four charts as standalone HTML, rendered to PNG by Chrome.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "build", "charts");
fs.mkdirSync(OUT, { recursive: true });

const bench = JSON.parse(fs.readFileSync(path.join(ROOT, "benchmark-results.json")));
const tamper = JSON.parse(fs.readFileSync(path.join(ROOT, "tamper-results.json")));
const L = bench.latency_ms;

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#fcfcfb;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#0b0b0b}
.viz{--surface-1:#fcfcfb;--ink:#0b0b0b;--ink-2:#52514e;--muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;
     --s1:#2a78d6;--s2:#eb6834;--good:#0ca30c;--critical:#d03b3b;
     padding:20px 24px;background:var(--surface-1)}
.title{font-size:17px;font-weight:650;margin:0 0 2px}
.sub{font-size:12.5px;color:var(--ink-2);margin:0 0 16px;line-height:1.45}
.legend{display:flex;gap:18px;margin:0 0 14px;font-size:12.5px;color:var(--ink-2)}
.key{display:flex;align-items:center;gap:6px}
.swatch{width:11px;height:11px;border-radius:2px}
.grp{margin-bottom:13px}
.glabel{font-size:12.5px;color:var(--ink);margin-bottom:5px;font-weight:550}
.bar{display:flex;align-items:center;gap:8px;margin-bottom:2px}
.track{flex:1;position:relative;height:16px}
.fill{height:100%;border-radius:0 4px 4px 0;min-width:2px}
.val{font-size:12px;color:var(--ink-2);font-variant-numeric:tabular-nums;white-space:nowrap;min-width:62px}
.axis{border-top:1px solid var(--axis);margin-top:4px;display:flex;justify-content:space-between;
      font-size:11px;color:var(--muted);padding-top:4px;font-variant-numeric:tabular-nums}
.note{font-size:11.5px;color:var(--muted);margin-top:12px;line-height:1.45}
table.grid{border-collapse:collapse;width:100%;font-size:12.5px}
table.grid th{text-align:left;font-weight:600;color:var(--ink-2);padding:7px 10px;border-bottom:1px solid var(--axis);font-size:12px}
table.grid td{padding:8px 10px;border-bottom:1px solid var(--grid);vertical-align:middle}
.cell{display:inline-flex;align-items:center;gap:7px;font-weight:600;font-size:12px}
.dot{width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;
     color:#fff;font-size:11px;font-weight:700;flex:none}
.tot{font-weight:650;color:var(--ink)}
`;

const page = (title, sub, body, note) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head>
<body><div class="viz"><p class="title">${title}</p><p class="sub">${sub}</p>${body}
${note ? `<p class="note">${note}</p>` : ""}</div></body></html>`;

const legend = (a, b) => `<div class="legend">
  <span class="key"><span class="swatch" style="background:var(--s1)"></span>${a}</span>
  <span class="key"><span class="swatch" style="background:var(--s2)"></span>${b}</span></div>`;

// A zero value draws no bar at all — a minimum-width stub would read as a
// small non-zero quantity, which is exactly what the figure must not imply.
const bar = (v, max, color, label) => `<div class="bar">
  <div class="track">${v > 0 ? `<div class="fill" style="width:${(v / max) * 100}%;background:var(--${color});min-width:3px"></div>` : ""}</div>
  <span class="val">${label}</span></div>`;

const ticks = (max, n = 4) => `<div class="axis">${
  Array.from({ length: n + 1 }, (_, i) => `<span>${Math.round((max / n) * i).toLocaleString()}</span>`).join("")}</div>`;

// --- Chart 1: latency ------------------------------------------------------
{
  const rows = [
    ["Register a product", L.register_blockchain.median, L.register_centralized.median],
    ["Transfer ownership", L.transfer_blockchain.median, L.transfer_centralized.median],
    ["Verify a product", L.verify_blockchain_direct.median, L.verify_centralized.median],
  ];
  const max = 140;
  const body = legend("BlockVerify (blockchain)", "Centralized baseline (MongoDB only)") +
    rows.map(([n, a, b]) => `<div class="grp"><div class="glabel">${n}</div>
      ${bar(a, max, "s1", `${a.toFixed(2)} ms`)}${bar(b, max, "s2", `${b.toFixed(2)} ms`)}</div>`).join("") +
    ticks(max);
  fs.writeFileSync(path.join(OUT, "chart-latency.html"), page(
    "Median operation latency by system",
    `Median of ${bench.meta.trials} trials per operation. Lower is better. Milliseconds.`,
    body,
    "Verification here is the direct chain read used by the browser. The same check routed through the Express API measures " +
    `${L.verify_blockchain_via_api.median.toFixed(2)} ms (see Table 3). Transaction latency is measured on a local Hardhat node with automatic mining, so it excludes real network consensus delay.`));
}

// --- Chart 2: gas ----------------------------------------------------------
{
  const g = [["registerProduct", bench.gas.register.median], ["transferOwnership", bench.gas.transfer.median],
             ["verifyProduct (view)", 0]];
  const max = 200000;
  const body = g.map(([n, v]) => `<div class="grp"><div class="glabel">${n}</div>
    ${bar(v, max, "s1", v === 0 ? "0 — no transaction" : v.toLocaleString() + " gas")}</div>`).join("") + ticks(max);
  fs.writeFileSync(path.join(OUT, "chart-gas.html"), page(
    "Gas consumption per contract operation",
    `Median of ${bench.meta.trials} trials. Gas units, not currency. Identical across every trial — standard deviation 0.`,
    body,
    "Verification is a <code>view</code> function: it executes locally on a node rather than in a mined transaction, so it consumes no gas and needs no wallet."));
}

// --- Chart 3: throughput ---------------------------------------------------
{
  const t = bench.throughput_ops_per_sec;
  const max = 1100;
  const body = legend("BlockVerify (blockchain)", "Centralized baseline (MongoDB only)") +
    `<div class="grp"><div class="glabel">Verifications per second</div>
     ${bar(t.verify_blockchain, max, "s1", `${t.verify_blockchain} /s`)}
     ${bar(t.verify_centralized, max, "s2", `${t.verify_centralized} /s`)}</div>` + ticks(max);
  fs.writeFileSync(path.join(OUT, "chart-throughput.html"), page(
    "Verification throughput",
    "Sequential requests, single client. Higher is better.",
    body,
    `The centralized baseline sustains ${(t.verify_centralized / t.verify_blockchain).toFixed(0)}× the verification rate. The blockchain path pays for three separate JSON-RPC round trips per verification (getProduct, getTransferLog, verifyProduct) against MongoDB's single indexed document read.`));
}

// --- Chart 4: tamper detection matrix --------------------------------------
{
  const ATTACKS = [
    ["1. Duplicate serial registration", "duplicate registration"],
    ["2. Transfer by a non-owner", "unauthorized transfer"],
    ["3. Operator rewrites the stored record", "rewrite"],
    ["4. Transfer silently erased from history", "history deletion"],
  ];
  const find = (sys, key) => tamper.findings.find((f) => f.system === sys && f.attack.includes(key));
  const cell = (f) => f.detected
    ? `<span class="cell" style="color:var(--good)"><span class="dot" style="background:var(--good)">✓</span>DETECTED</span>`
    : `<span class="cell" style="color:var(--critical)"><span class="dot" style="background:var(--critical)">✕</span>UNDETECTED</span>`;

  const body = `<table class="grid"><thead><tr><th>Attack</th>
    <th>BlockVerify (blockchain)</th><th>Centralized baseline</th></tr></thead><tbody>${
    ATTACKS.map(([label, key]) => `<tr><td>${label}</td>
      <td>${cell(find("blockchain", key))}</td><td>${cell(find("centralized", key))}</td></tr>`).join("")}
    <tr><td class="tot">Detection rate</td>
      <td class="tot">${tamper.detection_rate.blockchain}</td>
      <td class="tot">${tamper.detection_rate.centralized}</td></tr></tbody></table>`;
  fs.writeFileSync(path.join(OUT, "chart-tamper.html"), page(
    "Tamper-resistance: four attacks against both systems",
    "Each attack executed against both implementations over the same dataset.",
    body,
    "Both systems reject the application-level attacks (1 and 2). The difference appears once an attacker has direct storage access: in the centralized system, verification still reports <strong>VERIFIED GENUINE</strong> on a forged record, because the history and the owner it is checked against are both attacker-controlled."));
}

console.log("wrote 4 chart pages to", OUT);
console.log(`
Render them to PNG with headless Chrome, e.g.:
  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \\
    --default-background-color=fcfcfbff --window-size=860,392 \\
    --screenshot=ss/fig-chart-latency.png build/charts/chart-latency.html`);
