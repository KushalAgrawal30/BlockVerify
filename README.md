# BlockVerify

Blockchain-based product authentication. Manufacturers register genuine products
on-chain, a QR code is bound to each record, and anyone can scan it to replay the
product's full chain of custody straight from the chain.

Stack: Solidity + Hardhat · Ethers.js · Node/Express · MongoDB · React (Vite).

## Run it

Four terminals, in order:

```bash
npm install                      # once, at repo root
(cd backend && npm install)      # once
(cd frontend && npm install)     # once

# 1. local Ethereum node
npm run chain

# 2. deploy contracts + seed demo data (needs mongod running)
npm run deploy
npm run seed

# 3. API
npm run api                      # http://127.0.0.1:4000

# 4. web app
npm run web                      # http://localhost:5173
```

Demo logins (password `demo1234`): `manufacturer@demo.io`, `distributor@demo.io`,
`retailer@demo.io`, `customer@demo.io`.

## Checks

```bash
npm test      # 9 Hardhat/Chai contract tests, prints gas per tx type
npm run smoke # end-to-end API test: auth, roles, register, transfer, verify
```

## Evaluation

A centralized MongoDB-only implementation of the same workflow lives in
`backend/baseline.js`, so the project's central claim can be measured rather
than asserted. With the chain, both APIs and mongod running:

```bash
npm run baseline     # terminal 5: the MongoDB-only system on :4001
npm run bench        # latency, gas and throughput over N trials (default 30)
npm run tamper       # runs four attacks against both systems
```

`npm run bench` writes `benchmark-results.json` with median/mean/p95 for every
operation on both systems. `npm run tamper` writes `tamper-results.json`.

Headline result: both systems reject the application-level attacks, but an
operator with direct database access rewrites ownership and erases custody
history in the centralized system without verification noticing — 4/4 attacks
detected on-chain against 2/4 centralized.

## What's implemented

| Objective (slide 8) | Status |
| --- | --- |
| 01 Smart-contract product registry | done — `contracts/ProductRegistry.sol` |
| 02 QR bound to every registered product | done — generated on registration, encodes `{contractAddress, productId}` |
| 03 Instant verification by QR scan | done — camera scanner + direct chain read |
| 04 Contract-governed ownership transfer | done — `contracts/OwnershipTransfer.sol`, owner-only |
| 05 Transparent auditable history | done — full transfer log + timeline UI |
| 06 Role-based interfaces | done — 4 roles, capability-gated |
| 07 Blockchain vs. centralized DB | done — baseline built, benchmarks and tamper tests measured |

## Layout

```
contracts/         ProductRegistry.sol, OwnershipTransfer.sol
scripts/deploy.js  writes deployment.json (address + ABI) for the backend
test/              Hardhat + Chai contract tests
backend/           Express API, Mongoose models, Ethers bridge, QR, seed, smoke
                   baseline.js (MongoDB-only comparison), bench.js, tamper.js
frontend/src/      React app — App.jsx, Verify.jsx, Scanner.jsx, chain.js, api.js
```

## Design notes

**On-chain vs off-chain.** The chain holds only what has to be trustless:
product identity, batch, manufacturer, current owner, and every transfer hop.
MongoDB holds users, roles, sessions — data nobody needs to audit.

**Verification never trusts a flag.** `verifyProduct` walks the transfer log from
the manufacturer forward and confirms it lands on the recorded `currentOwner`. A
broken link returns `OWNERSHIP MISMATCH`, not "genuine". Each hop is already a
signed transaction, so replaying `from` addresses is the on-chain equivalent of
checking every signature.

**QR codes carry no product data** — just `{contractAddress, productId}`. Every
scan forces a fresh chain read, so a photocopied label cannot carry stale or
forged claims.

**The frontend verifies without the backend.** `frontend/src/chain.js` talks to
the Ethereum node directly (via a transparent dev proxy, since Hardhat's node
refuses cross-origin POSTs). The API is a convenience for writes, never part of
the trust path — which is the whole argument against a centralized database.

**Two contracts, one deployment.** `OwnershipTransfer` inherits
`ProductRegistry`, so the split stays conceptual instead of adding a second
address and a cross-contract permission problem.
