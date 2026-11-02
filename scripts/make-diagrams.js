// Generates the paper's architecture and workflow figures as standalone HTML,
// rendered to PNG by headless Chrome (same pipeline as make-charts.js).
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "..", "build", "diagrams");
fs.mkdirSync(OUT, { recursive: true });

const INK = "#0b0b0b", INK2 = "#52514e", MUTED = "#898781";
const TEAL = "#0a4f4a", MINT = "#1baf7a", BLUE = "#2a78d6", ORANGE = "#eb6834";
const SURF = "#fcfcfb", LINE = "#c3c2b7";

const shell = (w, h, svg) => `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:${SURF};font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
svg{display:block}
.lyr{font-size:9.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase}
.ttl{font-size:13px;font-weight:650}
.bdy{font-size:11px}
.sm{font-size:10px}
.mono{font-family:"SF Mono",Menlo,Consolas,monospace;font-size:10.5px}
.cap{font-size:10px;font-style:italic}
</style></head><body><svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M0,0 L10,5 L0,10 z" fill="${INK2}"/></marker>
  <marker id="ag" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M0,0 L10,5 L0,10 z" fill="${MINT}"/></marker>
</defs>${svg}</svg></body></html>`;

const box = (x, y, w, h, fill, stroke) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>`;
const t = (x, y, s, cls = "bdy", fill = INK, anchor = "start") =>
  `<text x="${x}" y="${y}" class="${cls}" fill="${fill}" text-anchor="${anchor}">${s}</text>`;

// ---------------------------------------------------------------- Figure 1
{
  const W = 900, H = 500;
  let s = "";
  // Presentation layer
  s += box(40, 30, 580, 68, "#eef4f3", TEAL);
  s += t(56, 50, "Presentation layer", "lyr", TEAL);
  s += t(56, 70, "React + Vite — role portals (Manufacturer · Distributor · Retailer · Customer)", "bdy");
  s += t(56, 87, "In-app camera QR scanner", "sm", INK2);

  // Application layer
  s += box(40, 168, 390, 86, "#eef4f3", TEAL);
  s += t(56, 188, "Application layer", "lyr", TEAL);
  s += t(56, 208, "Express API — JWT authentication, role gate", "bdy");
  s += t(56, 225, "Ethers.js signer · QR-code generation", "bdy");
  s += t(56, 243, "staticCall preflight before every write", "sm", INK2);

  // Off-chain
  s += box(40, 300, 240, 80, "#fff", LINE);
  s += t(56, 320, "Off-chain data layer", "lyr", MUTED);
  s += t(56, 340, "MongoDB", "ttl");
  s += t(56, 358, "users · roles · sessions", "bdy", INK2);
  s += t(56, 373, "no product data", "sm", ORANGE);

  // Blockchain
  s += box(330, 300, 530, 150, "#eef4f3", MINT);
  s += t(348, 320, "Blockchain layer", "lyr", TEAL);
  s += t(348, 342, "Hardhat Network (EVM) — JSON-RPC :8545, chain ID 31337", "bdy");
  s += box(348, 356, 494, 76, "#fff", MINT);
  s += t(364, 377, "OwnershipTransfer.sol", "mono", TEAL);
  s += t(364, 394, "transferOwnership() · getTransferLog() · verifyProduct()", "sm", INK2);
  s += t(364, 414, "↳ inherits ProductRegistry.sol — registerProduct() · getProduct()", "sm", INK2);

  // Write path
  s += `<path d="M150,98 L150,168" stroke="${INK2}" stroke-width="1.6" fill="none" marker-end="url(#a)"/>`;
  s += t(158, 128, "write path", "sm", INK2);
  s += t(158, 142, "register / transfer", "sm", MUTED);
  s += `<path d="M120,254 L120,300" stroke="${INK2}" stroke-width="1.6" fill="none" marker-end="url(#a)"/>`;
  s += t(128, 282, "auth", "sm", MUTED);
  s += `<path d="M330,254 L390,300" stroke="${INK2}" stroke-width="1.6" fill="none" marker-end="url(#a)"/>`;
  s += t(398, 286, "signed tx", "sm", MUTED);

  // Verification path — straight from presentation to chain
  s += `<path d="M560,98 L560,168 L690,168 L690,300" stroke="${MINT}" stroke-width="2" fill="none"
        stroke-dasharray="5 3" marker-end="url(#ag)"/>`;
  s += t(700, 150, "verification path", "sm", TEAL);
  s += t(700, 164, "direct chain read — view calls,", "sm", MUTED);
  s += t(700, 178, "no backend in the trust path", "sm", MUTED);

  s += t(40, 478, "Every write is a signed transaction; every read is a free view call. The backend can be stopped and verification still works.", "cap", MUTED);
  fs.writeFileSync(path.join(OUT, "fig-architecture.html"), shell(W, H, s));
}

// ---------------------------------------------------------------- Figure 2
{
  const W = 1004, H = 330;
  const lanes = [
    ["Manufacturer", "account #0", "registerProduct()", ["Submits serial, name,", "batch, mfg. date.", "Record written on-chain,", "QR code generated."]],
    ["Distributor", "accounts #1–5", "transferOwnership()", ["Receives goods, scans", "QR to confirm before", "accepting stock, then", "forwards to retailer."]],
    ["Retailer", "accounts #6–12", "transferOwnership()", ["Confirms receipt; the", "contract updates the", "on-chain owner to the", "retailer's wallet."]],
    ["Customer", "accounts #13–19", "verifyProduct()", ["Scans QR at point of", "sale; app reads live", "chain data and shows", "the full custody chain."]],
  ];
  const w = 205, gap = 44, y0 = 36;
  let s = "";
  lanes.forEach(([role, acct, fn, body], i) => {
    const x = 20 + i * (w + gap);
    s += box(x, y0, w, 36, i % 2 ? "#eef4f3" : TEAL, i % 2 ? MINT : TEAL);
    s += t(x + w / 2, y0 + 23, role, "ttl", i % 2 ? TEAL : "#fff", "middle");
    s += t(x + w / 2, y0 + 50, acct, "sm", MUTED, "middle");
    s += box(x, y0 + 60, w, 124, "#fff", LINE);
    s += t(x + 14, y0 + 82, fn, "mono", TEAL);
    body.forEach((l, j) => (s += t(x + 14, y0 + 103 + j * 16, l, "sm", INK2)));
    if (i < 3) {
      const ax = x + w + 8;
      s += `<path d="M${ax},${y0 + 120} L${ax + gap - 16},${y0 + 120}" stroke="${INK2}" stroke-width="1.6"
            fill="none" marker-end="url(#a)"/>`;
    }
  });
  s += box(20, 250, W - 40, 56, "#eef4f3", MINT);
  s += t(36, 272, "Each arrow is a signed blockchain transaction, not a database update, so the custody chain is independently verifiable.", "bdy", INK);
  s += t(36, 292, "Verification re-derives authenticity by replaying the transfer log rather than reading a stored “genuine” flag.", "sm", INK2);
  fs.writeFileSync(path.join(OUT, "fig-workflow.html"), shell(W, H, s));
}

console.log("wrote 2 diagram pages to", OUT);
