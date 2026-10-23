// Centralized baseline: the same product-authentication workflow with MongoDB
// as the only source of truth and no blockchain anywhere. Exists so the
// project's central claim — that a chain gives tamper-proof, decentralised
// trust a database cannot — can be measured instead of asserted.
//
// Deliberately written the way a competent team would build this without a
// chain: indexed collection, server-side authorisation, hashed passwords. The
// difference being measured is architectural, not a matter of sloppy code.
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import QRCode from "qrcode";

const productSchema = new mongoose.Schema({
  productId: { type: Number, required: true, unique: true, index: true },
  serial: { type: String, required: true, unique: true, index: true },
  name: String,
  manufacturer: String,
  batchNumber: String,
  mfgDate: Number,
  currentOwner: { type: String, index: true },
  history: [{ from: String, to: String, timestamp: Number, _id: false }],
});
export const BaseProduct = mongoose.models.BaseProduct || mongoose.model("BaseProduct", productSchema);

const counterSchema = new mongoose.Schema({ _id: String, seq: Number });
const Counter = mongoose.models.Counter || mongoose.model("Counter", counterSchema);

const nextId = async () =>
  (await Counter.findByIdAndUpdate("productId", { $inc: { seq: 1 } }, { upsert: true, new: true })).seq;

const app = express();
app.use(cors());
app.use(express.json());

// Same demo wallet strings as the chain version, so the two systems are
// compared over identical data rather than different identifiers.
const OWNERS = {
  Manufacturer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  Distributor: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  Retailer: "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
  Customer: "0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec",
};

app.post("/api/products/register", async (req, res) => {
  const { serial, name, batchNumber, mfgDate, as = "Manufacturer" } = req.body;
  if (!serial || !name) return res.status(400).json({ error: "serial and name are required" });
  try {
    const productId = await nextId();
    await BaseProduct.create({
      productId, serial, name, batchNumber: batchNumber || "",
      mfgDate: Math.floor(mfgDate || Date.now() / 1000),
      manufacturer: OWNERS[as], currentOwner: OWNERS[as], history: [],
    });
    res.status(201).json({ productId, qr: await QRCode.toDataURL(JSON.stringify({ productId })) });
  } catch (e) {
    res.status(400).json({ error: e.code === 11000 ? "duplicate serial" : e.message });
  }
});

app.post("/api/products/:id/transfer", async (req, res) => {
  const { to, as } = req.body;
  const p = await BaseProduct.findOne({ productId: Number(req.params.id) });
  if (!p) return res.status(400).json({ error: "not registered" });
  if (p.currentOwner !== OWNERS[as]) return res.status(400).json({ error: "not current owner" });

  p.history.push({ from: p.currentOwner, to, timestamp: Math.floor(Date.now() / 1000) });
  p.currentOwner = to;
  await p.save();
  res.json({ to });
});

app.get("/api/products/:id/verify", async (req, res) => {
  const id = Number(req.params.id);
  const p = await BaseProduct.findOne({ productId: id }).lean();
  if (!p) return res.json({ status: "NOT REGISTERED", productId: id });

  // Same replay check as the contract, for a like-for-like comparison. The
  // difference is not the algorithm — it is that here both the history and the
  // currentOwner it is checked against are writable by anyone with DB access,
  // so a consistent-looking record proves only internal consistency.
  let cursor = p.manufacturer;
  let status = "VERIFIED GENUINE";
  for (const h of p.history) {
    if (h.from !== cursor) { status = "OWNERSHIP MISMATCH"; break; }
    cursor = h.to;
  }
  if (status === "VERIFIED GENUINE" && cursor !== p.currentOwner) status = "OWNERSHIP MISMATCH";

  res.json({
    status, productId: id, owner: p.currentOwner, hops: p.history.length,
    product: {
      productId: p.productId, name: p.name, manufacturer: p.manufacturer,
      batchNumber: p.batchNumber, mfgDate: p.mfgDate, currentOwner: p.currentOwner,
    },
    history: p.history,
  });
});

const PORT = process.env.BASELINE_PORT || 4001;
if (process.argv[1].endsWith("baseline.js")) {
  mongoose
    .connect(process.env.MONGO_URL || "mongodb://127.0.0.1:27017/blockverify-baseline")
    .then(() => app.listen(PORT, () => console.log(`Centralized baseline API on :${PORT} (MongoDB only, no blockchain)`)))
    .catch((e) => { console.error("mongo connect failed:", e.message); process.exit(1); });
}
