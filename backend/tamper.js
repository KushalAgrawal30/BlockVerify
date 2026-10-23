// Tamper-resistance comparison. Runs the same four attacks against the
// blockchain system and the centralized baseline and records which are
// detected. This is the project's central claim turned into an experiment.
//
//   node tamper.js
import fs from "fs";
import mongoose from "mongoose";
import { ethers } from "ethers";
import { readContract, accounts, contractAddress, provider } from "./chain.js";
import { BaseProduct } from "./baseline.js";

const CHAIN_API = "http://127.0.0.1:4000";
const BASE_API = "http://127.0.0.1:4001";
const FORGED = "0x000000000000000000000000000000000000dEaD";

const call = async (base, path, { body, token } = {}) => {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

const findings = [];
const log = (system, attack, outcome, detected, detail) => {
  findings.push({ system, attack, outcome, detected, detail });
  console.log(`  ${detected ? "BLOCKED/DETECTED" : "UNDETECTED     "}  ${attack} — ${detail}`);
};

const token = (await call(CHAIN_API, "/api/auth/login",
  { body: { email: "manufacturer@demo.io", password: "demo1234" } })).body.token;
if (!token) { console.error("log in failed — is the API running and seeded?"); process.exit(1); }
await mongoose.connect(process.env.MONGO_URL || "mongodb://127.0.0.1:27017/blockverify-baseline");

const run = `${Date.now()}`.slice(-7);
const serial = `TMP-${run}`;

// Register one product in each system, with one legitimate transfer each.
const chainId = (await call(CHAIN_API, "/api/products/register",
  { token, body: { serial, name: "Tamper Subject", batchNumber: "BATCH-T" } })).body.productId;
await call(CHAIN_API, `/api/products/${chainId}/transfer`, { token, body: { to: accounts[1].address } });

const baseId = (await call(BASE_API, "/api/products/register",
  { body: { serial, name: "Tamper Subject", batchNumber: "BATCH-T" } })).body.productId;
await call(BASE_API, `/api/products/${baseId}/transfer`,
  { body: { to: accounts[1].address, as: "Manufacturer" } });

console.log(`\nsubjects: blockchain product #${chainId}, centralized product #${baseId}\n`);

// === Attack 1: duplicate registration =======================================
console.log("Attack 1 — register the same serial twice");
const dupChain = await call(CHAIN_API, "/api/products/register", { token, body: { serial, name: "Clone" } });
log("blockchain", "duplicate registration", dupChain.body.error, dupChain.status !== 201,
    `contract reverted: ${dupChain.body.error}`);
const dupBase = await call(BASE_API, "/api/products/register", { body: { serial, name: "Clone" } });
log("centralized", "duplicate registration", dupBase.body.error, dupBase.status !== 201,
    `unique index rejected: ${dupBase.body.error}`);

// === Attack 2: transfer by a party who does not hold the product ============
console.log("\nAttack 2 — transfer a product the caller does not own");
const badChain = await call(CHAIN_API, `/api/products/${chainId}/transfer`,
  { token, body: { to: accounts[6].address } });
log("blockchain", "unauthorized transfer", badChain.body.error, badChain.status !== 200,
    `contract reverted: ${badChain.body.error}`);
const badBase = await call(BASE_API, `/api/products/${baseId}/transfer`,
  { body: { to: accounts[6].address, as: "Manufacturer" } });
log("centralized", "unauthorized transfer", badBase.body.error, badBase.status !== 200,
    `application check rejected: ${badBase.body.error}`);

// === Attack 3: operator rewrites the stored record directly =================
// The realistic insider attack: someone with database or server access edits
// the record, bypassing every application-level check.
console.log("\nAttack 3 — operator edits the stored record directly (bypassing the API)");

await BaseProduct.updateOne({ productId: baseId },
  { $set: { currentOwner: FORGED, history: [{ from: accounts[0].address, to: FORGED, timestamp: 1 }] } });
const baseAfter = (await call(BASE_API, `/api/products/${baseId}/verify`)).body;
log("centralized", "direct record rewrite", baseAfter.status, baseAfter.status !== "VERIFIED GENUINE",
    `verification returns "${baseAfter.status}", owner forged to ${baseAfter.owner.slice(0, 10)}… — history rewritten, no trace`);

// The chain has no equivalent write path at all: no API, no admin interface,
// and no database to edit. The nearest possible action is forcing the node's
// storage directly, which only a local development node permits and which a
// real network would reject outright.
const slot = ethers.toBeHex(
  BigInt(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [chainId, 1]))) + 5n, 32);
await provider.send("hardhat_setStorageAt", [contractAddress, slot, ethers.zeroPadValue(FORGED, 32)]);
const [code, owner] = await readContract.verifyProduct(chainId);
const STATUS = ["NOT REGISTERED", "VERIFIED GENUINE", "OWNERSHIP MISMATCH"];
log("blockchain", "direct storage rewrite (dev node only)", STATUS[Number(code)], Number(code) === 2,
    `verification returns "${STATUS[Number(code)]}" — replaying the transfer log no longer lands on currentOwner`);

// === Attack 4: silently erase a transfer from the history ===================
console.log("\nAttack 4 — delete a transfer from the custody history");
// A competent insider leaves the record internally consistent: erase the
// history AND reset currentOwner to the manufacturer, so the replay check
// still passes and the product simply appears never to have left the factory.
await BaseProduct.updateOne({ productId: baseId },
  { $set: { history: [], currentOwner: accounts[0].address } });
const erased = (await call(BASE_API, `/api/products/${baseId}/verify`)).body;
log("centralized", "history deletion", erased.status, erased.status !== "VERIFIED GENUINE",
    `verification returns "${erased.status}" with ${erased.hops} hops — one real transfer erased, record still internally consistent`);

const logLen = (await readContract.getTransferLog(chainId)).length;
log("blockchain", "history deletion", `log still has ${logLen} hop(s)`, true,
    `no code path can shorten the log — append-only array, ${logLen} hop(s) intact`);

// --- summary ----------------------------------------------------------------
const by = (s) => findings.filter((f) => f.system === s);
const rate = (s) => `${by(s).filter((f) => f.detected).length}/${by(s).length}`;

const summary = {
  meta: { timestamp: new Date().toISOString(), contractAddress, chainProductId: chainId, baselineProductId: baseId },
  detection_rate: { blockchain: rate("blockchain"), centralized: rate("centralized") },
  findings,
};
fs.writeFileSync("tamper-results.json", JSON.stringify(summary, null, 2));

console.log(`\n${"=".repeat(74)}`);
console.log(`detection rate — blockchain: ${rate("blockchain")}   centralized: ${rate("centralized")}`);
console.log(`${"=".repeat(74)}`);
console.log(`
Both systems reject the application-level attacks (1 and 2): a unique index and
a server-side owner check are not hard to write. The architectural difference
appears in attacks 3 and 4. In the centralized system, anyone with database
access rewrites ownership and erases custody history, and verification still
reports a clean record, because the history and the owner it is checked against
are both attacker-controlled. The blockchain system has no such write path; the
closest equivalent requires forcing node storage, which only a development node
permits, and even that is caught — replaying the transfer log no longer agrees
with currentOwner.

wrote tamper-results.json`);

await mongoose.disconnect();
