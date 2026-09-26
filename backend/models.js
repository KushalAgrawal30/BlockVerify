import mongoose from "mongoose";

// Off-chain, non-critical data only: who logs in, as what, and with which wallet.
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  role: { type: String, required: true, enum: ["Manufacturer", "Distributor", "Retailer", "Customer"] },
  walletAddress: { type: String, required: true },
  accountIndex: { type: Number, required: true },
}, { timestamps: true });

const sessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  token: { type: String, required: true, index: true },
  loginAt: { type: Date, default: Date.now },
}, { timestamps: true });

export const User = mongoose.model("User", userSchema);
export const Session = mongoose.model("Session", sessionSchema);
