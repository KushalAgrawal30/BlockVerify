import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import { User, Session } from "./models.js";
import {
  readContract, asAccount, accounts, accountIndexFor,
  contractAddress, ROLE_ACCOUNTS, STATUS,
} from "./chain.js";

const JWT_SECRET = process.env.JWT_SECRET || "blockverify-dev-secret";
const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/config", (_req, res) => res.json({ contractAddress }));

// --- auth ------------------------------------------------------------------
const auth = async (req, res, next) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  try {
    const { id } = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(id);
    if (!user) throw new Error("no user");
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
};

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: `requires role: ${roles.join("/")}` });

app.post("/api/auth/register", async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !ROLE_ACCOUNTS[role])
    return res.status(400).json({ error: "name, email, password and a valid role are required" });
  if (await User.findOne({ email: email.toLowerCase() }))
    return res.status(409).json({ error: "email already registered" });

  // Hand out the next free demo wallet for this role.
  const pool = ROLE_ACCOUNTS[role];
  const taken = (await User.find({ role })).map((u) => u.accountIndex);
  const accountIndex = pool.find((i) => !taken.includes(i));
  if (accountIndex === undefined) return res.status(409).json({ error: `no free demo wallet for ${role}` });

  const user = await User.create({
    name, email, role, accountIndex,
    walletAddress: accounts[accountIndex].address,
    passwordHash: await bcrypt.hash(password, 10),
  });
  res.status(201).json({ id: user.id, walletAddress: user.walletAddress });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: (email || "").toLowerCase() });
  if (!user || !(await bcrypt.compare(password || "", user.passwordHash)))
    return res.status(401).json({ error: "invalid credentials" });

  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "8h" });
  await Session.create({ user: user.id, token });
  res.json({ token, user: { name: user.name, role: user.role, walletAddress: user.walletAddress } });
});

app.get("/api/auth/me", auth, (req, res) =>
  res.json({ name: req.user.name, role: req.user.role, walletAddress: req.user.walletAddress }));

// --- products --------------------------------------------------------------
const shape = (p) => ({
  productId: Number(p.productId),
  name: p.name,
  manufacturer: p.manufacturer,
  batchNumber: p.batchNumber,
  mfgDate: Number(p.mfgDate),
  currentOwner: p.currentOwner,
});

const qrPayload = (productId) => JSON.stringify({ contractAddress, productId });

// Dry-run every write first: a reverted send loses its revert reason and
// leaves the wallet's nonce ahead of the chain. staticCall gives us the real
// "duplicate serial" / "not current owner" message and never touches state.
async function send(contract, method, args) {
  await contract[method].staticCall(...args);
  return (await contract[method](...args)).wait();
}

app.post("/api/products/register", auth, requireRole("Manufacturer"), async (req, res) => {
  const { serial, name, batchNumber, mfgDate } = req.body;
  if (!serial || !name) return res.status(400).json({ error: "serial and name are required" });
  try {
    const c = asAccount(req.user.accountIndex);
    const receipt = await send(c, "registerProduct", [serial, name, batchNumber || "", Math.floor(mfgDate || Date.now() / 1000)]);
    const productId = Number(await c.productCount());
    res.status(201).json({
      productId,
      txHash: receipt.hash,
      gasUsed: receipt.gasUsed.toString(),
      qr: await QRCode.toDataURL(qrPayload(productId)),
    });
  } catch (e) {
    res.status(400).json({ error: reason(e) });
  }
});

app.get("/api/products/:id/qr", async (req, res) => {
  res.json({ payload: qrPayload(Number(req.params.id)), qr: await QRCode.toDataURL(qrPayload(Number(req.params.id))) });
});

// Verification is a plain chain read — no auth, anyone can audit.
app.get("/api/products/:id/verify", async (req, res) => {
  const id = Number(req.params.id);
  const [status, owner, hops] = await readContract.verifyProduct(id);
  if (Number(status) === 0) return res.json({ status: STATUS[0], productId: id });

  const product = shape(await readContract.getProduct(id));
  const log = await readContract.getTransferLog(id);
  res.json({
    status: STATUS[Number(status)],
    productId: id,
    owner,
    hops: Number(hops),
    product,
    history: log.map((h) => ({ from: h.from, to: h.to, timestamp: Number(h.timestamp) })),
  });
});

app.post("/api/products/:id/transfer", auth, async (req, res) => {
  const { to } = req.body;
  const toIndex = accountIndexFor(to || "");
  if (toIndex < 0) return res.status(400).json({ error: "recipient must be a known demo wallet" });
  try {
    const receipt = await send(asAccount(req.user.accountIndex), "transferOwnership", [Number(req.params.id), to]);
    res.json({ txHash: receipt.hash, gasUsed: receipt.gasUsed.toString(), to });
  } catch (e) {
    res.status(400).json({ error: reason(e) });
  }
});

// Products currently held by the logged-in user's wallet.
app.get("/api/products/mine", auth, async (req, res) => {
  const total = Number(await readContract.productCount());
  const mine = [];
  for (let id = 1; id <= total; id++) {
    const p = await readContract.getProduct(id);
    if (p.currentOwner.toLowerCase() === req.user.walletAddress.toLowerCase()) mine.push(shape(p));
  }
  res.json(mine);
});

// Directory of demo wallets, so a transfer form can offer real recipients.
app.get("/api/wallets", async (_req, res) => {
  const users = await User.find({}, "name role walletAddress");
  res.json(
    Object.entries(ROLE_ACCOUNTS).flatMap(([role, idx]) =>
      idx.map((i) => ({
        role,
        address: accounts[i].address,
        name: users.find((u) => u.walletAddress === accounts[i].address)?.name || null,
      }))
    )
  );
});

const reason = (e) =>
  (e.shortMessage || e.reason || e.message).replace(/^execution reverted:?\s*/, "").replace(/^"|"$/g, "");

const PORT = process.env.PORT || 4000;
mongoose
  .connect(process.env.MONGO_URL || "mongodb://127.0.0.1:27017/blockverify")
  .then(() => app.listen(PORT, () => console.log(`BlockVerify API on :${PORT}, contract ${contractAddress}`)))
  .catch((e) => { console.error("mongo connect failed:", e.message); process.exit(1); });
