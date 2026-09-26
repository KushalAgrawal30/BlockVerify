# Course Project — First Functional Module Implementation

**Project:** BlockVerify — A Blockchain-Based Product Authentication System to
Eliminate Counterfeit Goods Across the Supply Chain

**Team:** Jeevesh Malhotra · Kushal Agrawal · Mayank Balmoori

**Module submitted:** Module 1 — Blockchain Core: On-Chain Product Registry,
Ownership Transfer and Chain-of-Custody Verification

---

## 1. What the implemented module represents

BlockVerify's architecture has four layers (slide 11): a blockchain layer, an
application layer, an off-chain data layer, and a presentation layer. Every one
of them ultimately depends on the blockchain layer, because that is where the
product's identity and its custody history actually live — the rest of the
system only reads from it, writes to it, or renders it.

Module 1 is that blockchain layer, together with the deployment and integration
code needed to run and exercise it:

- `ProductRegistry.sol` — the immutable product identity registry
- `OwnershipTransfer.sol` — the custody chain and the verification algorithm
- `scripts/deploy.js` — deployment to an Ethereum network
- `test/blockverify.test.js` — the functional and security test suite
- `backend/chain.js` — the Ethers.js bridge and wallet/role mapping

This corresponds to steps 1 and 2 of the project methodology (slide 16):
*Requirement Analysis & Contract Design* and *Smart Contract Development*.

It was chosen as the first module deliberately. The data schema and the
permission rules have to be settled on-chain before the API, the database
schema, or the user interface can be written against them — a change to the
`Product` struct or to who is allowed to call `transferOwnership` would force a
rewrite of every layer above it.

---

## 2. Purpose and functionality of the module

The module provides four capabilities.

**Product registration.** A manufacturer submits a serial number, product name,
batch number and manufacturing date. The contract assigns an auto-incremented
`productId`, records the caller's wallet address as both `manufacturer` and
`currentOwner`, and emits a `ProductRegistered` event. Registration of a serial
number that already exists is rejected.

**Ownership transfer.** The current owner of a product transfers it to another
address. The contract updates `currentOwner` and appends a `{from, to,
timestamp}` entry to that product's transfer log. Any caller who is not the
current owner is rejected, as is any transfer of a product that was never
registered.

**Chain-of-custody verification.** Given a product ID, the contract returns one
of three statuses — `NOT REGISTERED`, `VERIFIED GENUINE`, or `OWNERSHIP
MISMATCH` — along with the current owner and the number of transfers. This is
the core algorithm of the project and is described in section 4.

**Auditable history.** The complete transfer log for any product can be read by
anyone, with no authentication and no permission from the manufacturer.

---

## 3. How the module contributes to the overall project

The project's central academic claim (objective 07, slide 8) is that a
blockchain gives tamper-proof, decentralised trust that a conventional
centralised database cannot. Module 1 is the part of the system where that claim
is actually cashed out. Everything else in BlockVerify is a convenience layer:

| Layer | Depends on Module 1 for |
| --- | --- |
| QR generation | the `productId` that the QR encodes as a pointer |
| Backend API | every write and read of product data; it holds no product state itself |
| MongoDB | nothing — it deliberately stores no product data at all |
| React UI | the verification result and custody timeline it renders |

Because the contract enforces the rules — not the server — the security
properties survive even if the backend is compromised. A malicious operator with
full access to our API and our database still cannot alter a recorded transfer,
re-register a serial number, or move a product they do not own. That is the
property being demonstrated, and it is implemented entirely inside this module.

---

## 4. How the submitted code works

### 4.1 `ProductRegistry.sol` — product identity

The on-chain record matches the dataset design on slide 13:

```solidity
struct Product {
    uint256 productId;     // unique, auto-incremented on registration
    string  name;          // product name
    address manufacturer;  // wallet of the registering manufacturer
    string  batchNumber;   // production batch identifier
    uint256 mfgDate;       // manufacturing timestamp
    address currentOwner;  // updated on every transfer
}
```

Two pieces of state support it:

- `mapping(uint256 => Product) products` — the registry itself
- `mapping(bytes32 => bool) serialUsed` — the duplicate guard, keyed by
  `keccak256(serial)`

**`registerProduct(serial, name, batchNumber, mfgDate) → productId`**
Hashes the serial, reverts with `"duplicate serial"` if that hash has been seen
before, marks it used, increments `productCount`, stores the struct with
`msg.sender` as both manufacturer and initial owner, and emits
`ProductRegistered`.

Storing `keccak256(serial)` rather than the string keeps the duplicate check to
a single 32-byte storage slot regardless of how long the serial is, which is
both cheaper and constant-cost.

**`getProduct(productId) → Product`** — a `view` function, free to call, no
transaction required.

### 4.2 `OwnershipTransfer.sol` — custody and verification

`OwnershipTransfer` inherits from `ProductRegistry`, so a single deployment
provides both. The two-contract split from the design is preserved as a
separation of concerns in source, without introducing a second contract address
or a cross-contract authorisation problem.

It adds `mapping(uint256 => Hop[]) transferLog`, where `Hop` is
`{address from, address to, uint256 timestamp}`.

**`transferOwnership(productId, to)`** enforces three preconditions before
changing any state:

```solidity
require(p.manufacturer != address(0), "not registered");
require(p.currentOwner == msg.sender, "not current owner");
require(to != address(0) && to != msg.sender, "bad recipient");
```

It then sets `currentOwner = to`, pushes the hop onto the log with
`block.timestamp`, and emits `OwnershipTransferred`.

**`verifyProduct(productId) → (status, owner, hops)`** is the core innovation.
It does **not** read a stored "is authentic" flag, because a stored flag is only
a claim that somebody wrote down. It re-derives authenticity by replaying the
custody chain:

```solidity
if (p.manufacturer == address(0)) return (0, address(0), 0);  // NOT REGISTERED

address cursor = p.manufacturer;
for (uint256 i = 0; i < log.length; i++) {
    if (log[i].from != cursor) return (2, p.currentOwner, log.length);  // MISMATCH
    cursor = log[i].to;
}
if (cursor != p.currentOwner) return (2, p.currentOwner, log.length);   // MISMATCH
return (1, p.currentOwner, log.length);                                 // GENUINE
```

The walk starts at the manufacturer and follows each hop. Every hop's `from`
must equal where the previous hop ended, and the final address must equal the
recorded `currentOwner`. Any gap returns `OWNERSHIP MISMATCH` rather than
"genuine".

This is the on-chain equivalent of the per-hop signature check in the project
design (slide 15). Each hop in the log was written by a transaction that the
network already verified as signed by its `from` address — an unsigned or
wrongly-signed transaction would never have been mined. Replaying the `from`
addresses therefore checks exactly what a signature check would, without
re-doing elliptic-curve work on-chain, which would be prohibitively expensive in
gas.

### 4.3 `scripts/deploy.js` — deployment

Deploys `OwnershipTransfer`, waits for confirmation, and writes the deployed
address together with the compiled ABI to `deployment.json`. Every other layer
reads that one file, so no contract address is ever hard-coded.

### 4.4 `backend/chain.js` — the Ethers.js bridge

Creates a `JsonRpcProvider` against the node, derives the twenty test wallets
from Hardhat's published test mnemonic, and maps them to supply-chain roles
exactly as specified on slide 13:

```js
export const ROLE_ACCOUNTS = {
  Manufacturer: [0],
  Distributor:  [1, 2, 3, 4, 5],
  Retailer:     [6, 7, 8, 9, 10, 11, 12],
  Customer:     [13, 14, 15, 16, 17, 18, 19],
};
```

Each wallet is wrapped in an Ethers `NonceManager`. This was necessary: Ethers
caches the `eth_getTransactionCount` RPC response for 250 ms, so several
transactions sent in quick succession from one wallet would otherwise reuse a
stale nonce and be rejected by the node with `Nonce too low`. The `NonceManager`
tracks the counter locally instead of re-querying.

### 4.5 `test/blockverify.test.js` — the test suite

Eight Hardhat/Chai tests covering the functional and security cases listed in
the evaluation plan (slide 17). Full output is given in section 10.

---

## 5. Technologies and tools used

| Purpose | Technology | Version |
| --- | --- | --- |
| Smart contract language | Solidity | 0.8.24 |
| Development & test framework | Hardhat | 2.22.x |
| Local Ethereum network | Hardhat Network (EVM, Paris target) | bundled |
| Blockchain client library | Ethers.js | 6.17.0 |
| Test assertions | Chai + Mocha (via `@nomicfoundation/hardhat-toolbox`) | 5.x |
| Runtime | Node.js | 24.13.0 |
| Package manager | npm | 11.6.2 |

Solidity 0.8.x was chosen specifically because arithmetic overflow and underflow
checks are built into the compiler from 0.8.0 onward, removing a whole class of
vulnerability without an external library such as SafeMath.

---

## 6. Blockchain components involved

**Platform.** Ethereum. The contracts are standard EVM bytecode and are
portable without modification to any EVM-compatible network, including the
Polygon Layer-2 deployment named as future scope (slide 18).

**Network.** Hardhat Network, a local development blockchain, running at
`http://127.0.0.1:8545` with chain ID 31337. It mines a block per transaction
(automine), gives immediate finality, and provides twenty pre-funded accounts.
This removes testnet faucets and confirmation delays from the development loop
while keeping the execution semantics identical to mainnet.

**Deployed contract address (current run):**
`0x5FbDB2315678afecb367f032d93F642f64180aa3`

**Wallets.** Twenty externally-owned accounts derived from Hardhat's published
test mnemonic on derivation path `m/44'/60'/0'/0/{i}`, each pre-funded with
10,000 test ETH. Role assignment follows slide 13:

| Role | Accounts | Example address |
| --- | --- | --- |
| Manufacturer | #0 | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| Distributor | #1–#5 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| Retailer | #6–#12 | `0x976EA74026E726554dB657fA54763abd0C3a0aa9` |
| Customer | #13–#19 | `0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec` |

These are publicly known development keys with no value on any real network.
They are used only so that multi-actor supply-chain transactions can be
demonstrated without wallet-installation friction. A production deployment would
use MetaMask or another self-custodial wallet, with each participant signing
their own transactions.

**Smart contracts.** `ProductRegistry` (base) and `OwnershipTransfer` (derived),
compiled with `solc` 0.8.24 to the Paris EVM target and deployed as one contract
instance.

**Events.** `ProductRegistered` and `OwnershipTransferred` are emitted on every
state change, giving an indexed off-chain audit trail that block explorers and
monitoring tools can consume without polling contract state.

**Transaction types.** Two state-changing functions (`registerProduct`,
`transferOwnership`) which cost gas and require signatures; three `view`
functions (`getProduct`, `getTransferLog`, `verifyProduct`) which are free and
require no wallet, which is what makes open public verification possible.

---

## 7. How blockchain is incorporated into the solution

The design principle is a strict on-chain / off-chain split (slide 9).

**On-chain — data whose integrity must not depend on trusting us:** product
identity, manufacturer, batch number, manufacturing date, current owner, and
every ownership transfer with its timestamp.

**Off-chain (MongoDB) — data nobody needs to audit:** user accounts, hashed
passwords, role assignments, and session tokens.

The split is what makes the system practical. Storing everything on-chain would
be prohibitively expensive in gas; storing everything off-chain would reduce the
project to an ordinary CRUD application with no trust guarantees at all. Only
product provenance is genuinely trust-sensitive, so only product provenance goes
on the chain.

Blockchain is doing three specific jobs here that a centralised database cannot:

**Immutability.** A recorded transfer cannot be edited or deleted afterwards,
not even by us. In a MongoDB-based system, anyone with database credentials
could rewrite a product's history and leave no evidence.

**Decentralised authorisation.** `require(p.currentOwner == msg.sender)` is
enforced by every node that validates the transaction, not by our application
code. Bypassing it would require compromising the network, not the server.

**Open auditability.** `verifyProduct` is a `view` function on a public
contract. A customer, a regulator, or a competitor can verify a product using
only the contract address and a public RPC endpoint, without an account, an API
key, or our cooperation. This is demonstrated concretely in the project's
frontend, where `frontend/src/chain.js` performs verification by calling the
Ethereum node directly and never touches our backend.

---

## 8. Data and input used for implementation and testing

**On-chain data.** The `Product` struct and `Hop` records described in
section 4, generated entirely by the contracts themselves.

**Seed dataset** (`backend/seed.js`), matching the demonstration dataset
specified on slide 13:

- **25 products** distributed across **3 batches** (`BATCH-A`, `BATCH-B`,
  `BATCH-C`), cycling through five realistic pharmaceutical product names
  (Paracetamol 500 mg, Amoxicillin 250 mg, Insulin Pen, Vitamin D3 60k, Cough
  Syrup 100 ml)
- Serial numbers of the form `SN-<run>-001` … `SN-<run>-025`, unique per run so
  the duplicate-serial guard can be re-tested against a fresh chain
- Manufacturing dates spread one day apart going backwards from the seed time
- **Custody deliberately staggered** so the demonstration has products at every
  stage: 2 with the customer, 3 with the retailer, 5 with the distributor, and
  15 still with the manufacturer

**Off-chain data.** Four demonstration user accounts, one per role — Acme Pharma
(Manufacturer), NorthDist Logistics (Distributor), CityMart Retail (Retailer),
Priya Sharma (Customer) — with bcrypt-hashed passwords and their mapped wallet
addresses.

**Test inputs.** The suite constructs its own fixtures against a freshly
deployed contract in `beforeEach`, so tests are independent of the seed data and
of each other.

---

## 9. Initial setup and configuration

**Prerequisites:** Node.js 18 or later (24.13.0 used here) and npm. MongoDB is
required only for the layers above Module 1; the contracts, deployment and tests
run without it.

**Installation** — once:

```bash
cd "DLT project"
npm install                    # Hardhat, toolbox, Solidity compiler
(cd backend && npm install)    # Ethers, Express, Mongoose, qrcode
(cd frontend && npm install)   # React, Vite, Ethers, html5-qrcode
```

**To run and verify Module 1 on its own** — no database, no server needed:

```bash
npm test          # compiles the contracts and runs all 8 tests
```

**To deploy to a running network:**

```bash
npm run chain     # terminal 1: starts the local Ethereum node, leave running
npm run deploy    # terminal 2: deploys and writes deployment.json
npm run seed      # terminal 2: loads the 25-product demonstration dataset
```

No manual configuration is required. `hardhat.config.js` sets the Solidity
version and the localhost network; the contract address is discovered from
`deployment.json` rather than configured by hand. Optional environment variables
(`RPC_URL`, `MONGO_URL`, `PORT`, `JWT_SECRET`) all have working defaults.

**Note.** Restarting `npm run chain` resets the blockchain to an empty state.
`npm run deploy` and `npm run seed` must be re-run afterwards.

---

## 10. Working status — results and evidence

All results below were produced on the current build.

### 10.1 Compilation and functional test results

```
$ npm test

Compiled 2 Solidity files successfully (evm target: paris).

  BlockVerify
    ✔ registers a product with an immutable identity
    ✔ reverts on a duplicate serial
    ✔ transfers ownership down the supply chain
    ✔ rejects a transfer from a non-owner
    ✔ rejects a transfer of an unregistered product
    ✔ verifyProduct returns NOT_REGISTERED for an unknown id (cloned QR)
    ✔ verifyProduct returns GENUINE with an unbroken custody chain
      gas: registerProduct=207988  transferOwnership=121018
    ✔ reports gas cost per transaction type

  8 passing (239ms)
```

Mapped against the evaluation plan (slide 17):

| Evaluation requirement | Test | Result |
| --- | --- | --- |
| Register function works | test 1 | pass |
| Duplicate product ID must revert | test 2 | pass — reverts `duplicate serial` |
| Transfer works across the chain | test 3 | pass — 3 hops logged |
| Unauthorised transfer must be rejected | test 4 | pass — reverts `not current owner` |
| Transfer of unknown product rejected | test 5 | pass — reverts `not registered` |
| Cloned/invalid QR detected | test 6 | pass — returns `NOT REGISTERED` |
| Verification returns full history | test 7 | pass — GENUINE, 2 hops |
| Gas cost per transaction type | test 8 | measured, see 10.4 |

### 10.2 Deployment output

```
$ npm run deploy
OwnershipTransfer deployed at 0x5FbDB2315678afecb367f032d93F642f64180aa3
wrote deployment.json

$ npm run seed
seeded 4 users (password: demo1234)
registered 25 products across 3 batches: 1, 2, 3, ... 25
custody: 2 with customer, 3 with retailer, 5 with distributor, rest with manufacturer
```

### 10.3 End-to-end transaction evidence

A single product registered and moved through the entire supply chain. Every
transaction hash below is a real transaction mined on the local network.

**Step 1 — Registration.** Input: serial `SN-DEMO-001`, name `Insulin Pen`,
batch `BATCH-D`, submitted from Manufacturer account #0.

```
productId : 27
txHash    : 0xd0a87690eef914bc8ae8c4329658f305a4346819fdc4369b0b92a338bd8baf8e
gasUsed   : 190912
```

**Step 2 — Verification immediately after registration.**

```json
{
  "status": "VERIFIED GENUINE",
  "productId": 27,
  "owner": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "hops": 0,
  "product": {
    "name": "Insulin Pen",
    "manufacturer": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "batchNumber": "BATCH-D",
    "currentOwner": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
  },
  "history": []
}
```

**Step 3 — Three ownership transfers.**

```
Manufacturer -> Distributor  tx 0xe9b8ecc0eec88fa6b2de16ffc804ea2d26a7c3ad2bb16bf6136c6a1f4ef67f82  gas 121018
Distributor  -> Retailer     tx 0x26bfdda3996b1b0dae441b3dc7284f626f87f6f11a8176569b03b635e6b0e6c8  gas 103918
Retailer     -> Customer     tx 0xb0175d0ba1445f1097e6d3b7b8c83ef7ace45843865c27302cf747a24e29e335  gas 103918
```

**Step 4 — Verification after the full custody chain.** The complete,
independently auditable provenance of the product:

```json
{
  "status": "VERIFIED GENUINE",
  "productId": 27,
  "owner": "0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec",
  "hops": 3,
  "history": [
    { "from": "0xf39Fd6e5...b92266", "to": "0x70997970...dc79C8", "timestamp": 1790440337 },
    { "from": "0x70997970...dc79C8", "to": "0x976EA740...3a0aa9", "timestamp": 1790440338 },
    { "from": "0x976EA740...3a0aa9", "to": "0x1CBd3b27...73C9Ec", "timestamp": 1790440339 }
  ]
}
```

Manufacturer → Distributor → Retailer → Customer, each hop a signed transaction
with an on-chain timestamp.

**Step 5 — Security and tamper cases, all correctly rejected.**

| Attack attempted | Result |
| --- | --- |
| Register serial `SN-DEMO-001` a second time | rejected — `duplicate serial` |
| Transfer a product the caller no longer owns | rejected — `not current owner` |
| Distributor attempts to register a product | rejected — `requires role: Manufacturer` |
| Verify product ID 999999 (cloned/forged QR) | `NOT REGISTERED` |

**Node log confirming a mined transaction:**

```
eth_sendRawTransaction
  Contract call:       OwnershipTransfer#transferOwnership
  Transaction:         0xb0175d0ba1445f1097e6d3b7b8c83ef7ace45843865c27302cf747a24e29e335
  From:                0x976ea74026e726554db657fa54763abd0c3a0aa9
  To:                  0x5fbdb2315678afecb367f032d93f642f64180aa3
  Value:               0 ETH
  Gas used:            103918 of 103918
  Block #49:           0x9052c7edb4e2d7d6e44d12f52db54d741553d93531dd1bc5bc068d252fb117d0
```

### 10.4 Gas cost benchmarking

| Operation | Gas used | Notes |
| --- | --- | --- |
| Contract deployment | 1,577,877 | one-time |
| `registerProduct` (first ever) | 207,940 | initialises the `productCount` slot from zero |
| `registerProduct` (steady state) | 190,840 | identical for every subsequent registration |
| `transferOwnership` (first for a product) | 121,018 | allocates the product's transfer-log array |
| `transferOwnership` (steady state) | ~103,910 | varies by ±12 gas with zero-bytes in the address |
| `getProduct` / `getTransferLog` / `verifyProduct` | 0 | `view` functions — free, no transaction |

These figures were measured with identical input strings so that calldata length
is held constant and only storage behaviour varies. The live transaction in
section 10.3 shows 190,912 gas rather than 190,840 because its serial string
(`SN-DEMO-001`) is longer, and every non-zero calldata byte costs 16 gas.

The 17,100 gas difference between the first and subsequent calls is a precise
consequence of two EVM pricing rules. Writing to a storage slot that currently
holds zero costs 20,000 gas, whereas updating a non-zero slot costs 5,000 — a
15,000 difference. The first access to a cold storage slot within a transaction
adds a further 2,100 gas under EIP-2929. Together: 15,000 + 2,100 = 17,100,
which matches the measured gap for both `registerProduct` and
`transferOwnership` exactly.

Verification — the operation end users perform most often — costs nothing at
all, because `view` functions execute locally on a node rather than in a mined
transaction. This is what makes public verification at point of sale
economically viable: a customer scanning a QR code in a shop pays no gas, needs
no wallet, and needs no account.

### 10.5 Integration status beyond Module 1

To demonstrate the module working end to end, the layers immediately above it
are also running: an Express API with JWT authentication and role gating over
MongoDB, QR-code generation bound to each registered product, and a React
interface with role-based portals and a camera QR scanner. All output in section
10.3 was produced through that live API against the deployed contract. An
end-to-end integration check (`npm run smoke`) covering authentication, role
enforcement, registration, transfer and verification passes:

```
$ npm run smoke
all backend checks passed (product #26)
```

These layers are part of Modules 2 and 3 and are submitted here as supporting
evidence of Module 1's correctness, not as the module itself.

---

## 11. Source code inventory

**Module 1 — submitted implementation:**

| File | Lines | Contents |
| --- | --- | --- |
| `contracts/ProductRegistry.sol` | 55 | Product struct, registration, duplicate guard |
| `contracts/OwnershipTransfer.sol` | 55 | Transfer log, authorisation, `verifyProduct` |
| `scripts/deploy.js` | 18 | Deployment, ABI and address export |
| `test/blockverify.test.js` | 74 | 8 functional and security tests |
| `backend/chain.js` | 42 | Ethers.js bridge, wallet/role mapping |
| `hardhat.config.js` | 9 | Compiler and network configuration |
| **Total** | **253** | |

**Supporting integration code (Modules 2–3, partially complete):**

| File | Lines |
| --- | --- |
| `backend/server.js` | 176 |
| `backend/models.js`, `seed.js`, `smoke.js` | 126 |
| `frontend/src/` (App, Verify, Scanner, chain, api) | 363 |
| **Total** | **665** |

---

## 12. Progress against project objectives

| Objective (slide 8) | Status |
| --- | --- |
| 01 Smart-contract registry with immutable identities | **Complete** (Module 1) |
| 02 Unique QR bound to every registered product | Complete |
| 03 Instant verification by QR scan | Complete |
| 04 Contract-governed ownership transfer | **Complete** (Module 1) |
| 05 Transparent auditable ownership history | **Complete** (Module 1) |
| 06 Role-based interfaces for all four actors | Complete |
| 07 Demonstrate advantage over a centralised database | Architecture in place; comparative write-up and MongoDB-only baseline pending |

**Remaining work:** a centralised MongoDB-only baseline implementation for
side-by-side tamper-resistance comparison, formal QR-scan-to-verification
latency benchmarking, and scan-context ownership-mismatch detection (comparing
the scanning party's wallet against `currentOwner` to flag duplicated QR labels
automatically).

---

## Appendix — Screenshots to include

The following screens should be captured from the running system and attached to
this submission.

1. **Compilation and test run** — terminal showing `npm test` with all 8 tests
   passing and the gas line (section 10.1).
2. **Deployment** — terminal showing `npm run deploy` with the contract address,
   and `npm run seed` with the 25 products registered (section 10.2).
3. **Local blockchain node** — the `npm run chain` terminal showing mined
   `registerProduct` and `transferOwnership` transactions with their hashes, gas
   used and block numbers (as in the node log extract in section 10.3).
4. **Manufacturer portal registering a product** — the form filled in, and the
   result box showing the new product ID, transaction hash, gas used and the
   generated QR code.
5. **Verification result** — the Verify panel showing `VERIFIED GENUINE` with
   the product details, the chain-of-custody timeline listing all three hops
   with timestamps, and the read latency in milliseconds.
6. **Counterfeit detection** — the Verify panel showing `NOT REGISTERED` for
   product ID 999999.
7. **Tamper rejection** — the error shown when registering a duplicate serial
   (`duplicate serial`), and when a non-owner attempts a transfer (`not current
   owner`).
8. **Role-based interfaces** — the Distributor and Retailer portals showing
   stock in custody and the transfer control.
9. **Smoke test** — terminal showing `npm run smoke` passing (section 10.5).

To reproduce all of the above: `npm run chain`, `npm run deploy`, `npm run seed`,
`npm run api`, `npm run web`, then open http://localhost:5173 and sign in as
`manufacturer@demo.io` with password `demo1234`.
