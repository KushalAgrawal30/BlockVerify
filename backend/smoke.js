// End-to-end API check. Needs: hardhat node + mongod + seeded db + server running.
//   node smoke.js
import assert from "node:assert/strict";

const BASE = process.env.API || "http://127.0.0.1:4000";
const call = async (path, opts = {}) => {
  const res = await fetch(BASE + path, {
    method: opts.body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};
const login = async (who) =>
  (await call("/api/auth/login", { body: { email: `${who}@demo.io`, password: "demo1234" } })).body.token;

const mfg = await login("manufacturer");
const dist = await login("distributor");
assert.ok(mfg && dist, "demo users must exist — run `node seed.js` first");

// bad credentials are rejected
assert.equal((await call("/api/auth/login", { body: { email: "manufacturer@demo.io", password: "wrong" } })).status, 401);
// unauthenticated register is rejected
assert.equal((await call("/api/products/register", { body: { serial: "X", name: "X" } })).status, 401);

const serial = "SMOKE-" + Date.now();
const reg = await call("/api/products/register", { token: mfg, body: { serial, name: "Smoke Widget", batchNumber: "BATCH-S" } });
assert.equal(reg.status, 201);
const id = reg.body.productId;
assert.ok(reg.body.qr.startsWith("data:image/png;base64,"), "QR is generated on registration");

// duplicate serial must revert on-chain
assert.equal((await call("/api/products/register", { token: mfg, body: { serial, name: "Clone" } })).status, 400);
// a distributor may not register at all
assert.equal((await call("/api/products/register", { token: dist, body: { serial: serial + "b", name: "X" } })).status, 403);

const wallets = (await call("/api/wallets")).body;
const distWallet = wallets.find((w) => w.role === "Distributor").address;

// a non-owner cannot transfer
assert.equal((await call(`/api/products/${id}/transfer`, { token: dist, body: { to: distWallet } })).status, 400);
// the owner can
assert.equal((await call(`/api/products/${id}/transfer`, { token: mfg, body: { to: distWallet } })).status, 200);

const v = (await call(`/api/products/${id}/verify`)).body;
assert.equal(v.status, "VERIFIED GENUINE");
assert.equal(v.hops, 1);
assert.equal(v.owner.toLowerCase(), distWallet.toLowerCase());

// an id that was never registered — the cloned-QR case
assert.equal((await call("/api/products/999999/verify")).body.status, "NOT REGISTERED");

console.log(`all backend checks passed (product #${id})`);
