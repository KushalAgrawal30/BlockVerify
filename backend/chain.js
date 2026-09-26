// Ethers.js bridge: one provider, one contract, one signer per demo role account.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";

const here = path.dirname(fileURLToPath(import.meta.url));
const deployment = JSON.parse(
  fs.readFileSync(path.join(here, "..", "deployment.json"), "utf8")
);

export const provider = new ethers.JsonRpcProvider(
  process.env.RPC_URL || "http://127.0.0.1:8545"
);

// Hardhat's default funded accounts, derived from its published test mnemonic.
const MNEMONIC = "test test test test test test test test test test test junk";
// NonceManager: ethers caches eth_getTransactionCount for 250ms, so rapid
// back-to-back sends from one wallet would otherwise reuse a stale nonce.
export const accounts = Array.from({ length: 20 }, (_, i) => {
  const w = ethers.HDNodeWallet.fromPhrase(MNEMONIC, "", `m/44'/60'/0'/0/${i}`).connect(provider);
  const managed = new ethers.NonceManager(w);
  managed.address = w.address;
  return managed;
});

export const contractAddress = deployment.address;
export const readContract = new ethers.Contract(deployment.address, deployment.abi, provider);
export const asAccount = (i) => new ethers.Contract(deployment.address, deployment.abi, accounts[i]);

// Slide 13 role → account mapping.
export const ROLE_ACCOUNTS = {
  Manufacturer: [0],
  Distributor: [1, 2, 3, 4, 5],
  Retailer: [6, 7, 8, 9, 10, 11, 12],
  Customer: [13, 14, 15, 16, 17, 18, 19],
};

export const accountIndexFor = (address) =>
  accounts.findIndex((a) => a.address.toLowerCase() === address.toLowerCase());

export const STATUS = ["NOT REGISTERED", "VERIFIED GENUINE", "OWNERSHIP MISMATCH"];
