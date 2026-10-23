// Repeatable benchmark: runs N trials of register / transfer / verify against
// both the blockchain system and the centralized baseline, and reports
// distributions rather than single readings.
//
//   node bench.js [trials]      (default 30)
//
// Needs: hardhat node, mongod, npm run deploy, npm run seed, npm run api,
// and npm run baseline.
import fs from "fs";
import { readContract, accounts, asAccount, provider } from "./chain.js";

const TRIALS = Number(process.argv[2]) || 30;
const CHAIN_API = "http://127.0.0.1:4000";
const BASE_API = "http://127.0.0.1:4001";

const OWNERS = {
  Manufacturer: accounts[0].address,
  Distributor: accounts[1].address,
  Retailer: accounts[6].address,
  Customer: accounts[13].address,
};

const call = async (base, path, { body, token } = {}) => {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

// --- statistics -------------------------------------------------------------
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return {
    n: s.length,
    min: +s[0].toFixed(2),
    median: +pct(s, 50).toFixed(2),
    mean: +mean.toFixed(2),
    p95: +pct(s, 95).toFixed(2),
    max: +s[s.length - 1].toFixed(2),
    stdev: +Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length).toFixed(2),
  };
}
const timed = async (fn) => { const t0 = performance.now(); const r = await fn(); return [performance.now() - t0, r]; };

// --- run --------------------------------------------------------------------
const token = (await call(CHAIN_API, "/api/auth/login",
  { body: { email: "manufacturer@demo.io", password: "demo1234" } })).body.token;
if (!token) { console.error("log in failed — is the API running and seeded?"); process.exit(1); }

const run = `${Date.now()}`.slice(-7);
const results = {};
const record = (k, v) => (results[k] ??= []).push(v);

console.log(`running ${TRIALS} trials per operation...\n`);

// Registration — both systems
for (let i = 0; i < TRIALS; i++) {
  const serial = `BM-${run}-${String(i).padStart(3, "0")}`;
  const [ms, r] = await timed(() => call(CHAIN_API, "/api/products/register",
    { token, body: { serial, name: "Benchmark Unit", batchNumber: "BATCH-BM" } }));
  if (r.status !== 201) { console.error("chain register failed:", r.body); process.exit(1); }
  record("chain_register_ms", ms);
  record("chain_register_gas", Number(r.body.gasUsed));
  record("chain_ids", r.body.productId);

  const [bms, br] = await timed(() => call(BASE_API, "/api/products/register",
    { body: { serial, name: "Benchmark Unit", batchNumber: "BATCH-BM" } }));
  if (br.status !== 201) { console.error("baseline register failed:", br.body); process.exit(1); }
  record("base_register_ms", bms);
  record("base_ids", br.body.productId);
}

// Transfer — one hop per product, both systems
for (let i = 0; i < TRIALS; i++) {
  const [ms, r] = await timed(() => call(CHAIN_API, `/api/products/${results.chain_ids[i]}/transfer`,
    { token, body: { to: OWNERS.Distributor } }));
  if (r.status !== 200) { console.error("chain transfer failed:", r.body); process.exit(1); }
  record("chain_transfer_ms", ms);
  record("chain_transfer_gas", Number(r.body.gasUsed));

  const [bms] = await timed(() => call(BASE_API, `/api/products/${results.base_ids[i]}/transfer`,
    { body: { to: OWNERS.Distributor, as: "Manufacturer" } }));
  record("base_transfer_ms", bms);
}

// Verification — the operation end users actually perform
for (let i = 0; i < TRIALS; i++) {
  const [ms] = await timed(() => call(CHAIN_API, `/api/products/${results.chain_ids[i]}/verify`));
  record("chain_verify_api_ms", ms);

  // Direct chain read, the path the browser uses — no backend involved
  const [dms] = await timed(() => readContract.verifyProduct(results.chain_ids[i]));
  record("chain_verify_direct_ms", dms);

  const [bms] = await timed(() => call(BASE_API, `/api/products/${results.base_ids[i]}/verify`));
  record("base_verify_ms", bms);
}

// Throughput — sequential, since each wallet's transactions must be ordered
const seqStart = performance.now();
for (let i = 0; i < TRIALS; i++)
  await call(CHAIN_API, `/api/products/${results.chain_ids[i]}/verify`);
const chainVerifyTps = TRIALS / ((performance.now() - seqStart) / 1000);

const baseStart = performance.now();
for (let i = 0; i < TRIALS; i++)
  await call(BASE_API, `/api/products/${results.base_ids[i]}/verify`);
const baseVerifyTps = TRIALS / ((performance.now() - baseStart) / 1000);

// --- report -----------------------------------------------------------------
const summary = {
  meta: {
    trials: TRIALS,
    timestamp: new Date().toISOString(),
    network: "Hardhat Network (local, automine)",
    chainId: Number((await provider.getNetwork()).chainId),
    blockNumber: await provider.getBlockNumber(),
    node: process.version,
  },
  latency_ms: {
    register_blockchain: stats(results.chain_register_ms),
    register_centralized: stats(results.base_register_ms),
    transfer_blockchain: stats(results.chain_transfer_ms),
    transfer_centralized: stats(results.base_transfer_ms),
    verify_blockchain_via_api: stats(results.chain_verify_api_ms),
    verify_blockchain_direct: stats(results.chain_verify_direct_ms),
    verify_centralized: stats(results.base_verify_ms),
  },
  gas: {
    register: stats(results.chain_register_gas),
    transfer: stats(results.chain_transfer_gas),
    verify: { note: "0 — view function, executed locally, no transaction" },
  },
  throughput_ops_per_sec: {
    verify_blockchain: +chainVerifyTps.toFixed(1),
    verify_centralized: +baseVerifyTps.toFixed(1),
  },
  raw: results,
};

fs.writeFileSync("benchmark-results.json", JSON.stringify(summary, null, 2));

const row = (label, s) => `${label.padEnd(30)} ${String(s.median).padStart(9)} ${String(s.mean).padStart(9)} ${String(s.p95).padStart(9)} ${String(s.min).padStart(8)} ${String(s.max).padStart(9)}`;
console.log(`LATENCY (ms over ${TRIALS} trials)`);
console.log("".padEnd(30) + "   median      mean       p95      min       max");
for (const [k, v] of Object.entries(summary.latency_ms)) console.log(row(k, v));
console.log(`\nGAS (units)`);
for (const k of ["register", "transfer"]) console.log(row(k, summary.gas[k]));
console.log(`\nTHROUGHPUT (verifications/sec, sequential)`);
console.log(`  blockchain  ${chainVerifyTps.toFixed(1)}`);
console.log(`  centralized ${baseVerifyTps.toFixed(1)}`);
console.log(`\nwrote benchmark-results.json`);
