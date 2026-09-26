// Demo dataset: one user per role + 25 products across 3 batches, some already
// partway down the supply chain. Idempotent — wipes users/sessions, then reseeds.
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { User, Session } from "./models.js";
import { accounts, asAccount, ROLE_ACCOUNTS } from "./chain.js";

const PEOPLE = [
  ["Acme Pharma", "manufacturer@demo.io", "Manufacturer"],
  ["NorthDist Logistics", "distributor@demo.io", "Distributor"],
  ["CityMart Retail", "retailer@demo.io", "Retailer"],
  ["Priya Sharma", "customer@demo.io", "Customer"],
];
const BATCHES = ["BATCH-A", "BATCH-B", "BATCH-C"];
const NAMES = ["Paracetamol 500mg", "Amoxicillin 250mg", "Insulin Pen", "Vitamin D3 60k", "Cough Syrup 100ml"];

await mongoose.connect(process.env.MONGO_URL || "mongodb://127.0.0.1:27017/blockverify");
await User.deleteMany({});
await Session.deleteMany({});

const passwordHash = await bcrypt.hash("demo1234", 10);
for (const [name, email, role] of PEOPLE) {
  const accountIndex = ROLE_ACCOUNTS[role][0];
  await User.create({ name, email, role, accountIndex, walletAddress: accounts[accountIndex].address, passwordHash });
}
console.log(`seeded ${PEOPLE.length} users (password: demo1234)`);

const mfg = asAccount(ROLE_ACCOUNTS.Manufacturer[0]);
const dist = asAccount(ROLE_ACCOUNTS.Distributor[0]);
const retail = asAccount(ROLE_ACCOUNTS.Retailer[0]);
const stamp = Date.now().toString().slice(-6);

const ids = [];
for (let i = 0; i < 25; i++) {
  const batch = BATCHES[i % 3];
  const tx = await mfg.registerProduct(
    `SN-${stamp}-${String(i + 1).padStart(3, "0")}`,
    NAMES[i % NAMES.length],
    batch,
    Math.floor(Date.now() / 1000) - i * 86400
  );
  await tx.wait();
  ids.push(Number(await mfg.productCount()));
}
console.log(`registered ${ids.length} products across ${BATCHES.length} batches:`, ids.join(", "));

// Push the first 10 to the distributor, the first 5 on to the retailer.
for (const id of ids.slice(0, 10)) await (await mfg.transferOwnership(id, accounts[ROLE_ACCOUNTS.Distributor[0]].address)).wait();
for (const id of ids.slice(0, 5)) await (await dist.transferOwnership(id, accounts[ROLE_ACCOUNTS.Retailer[0]].address)).wait();
for (const id of ids.slice(0, 2)) await (await retail.transferOwnership(id, accounts[ROLE_ACCOUNTS.Customer[0]].address)).wait();
console.log("custody: 2 with customer, 3 with retailer, 5 with distributor, rest with manufacturer");

await mongoose.disconnect();
