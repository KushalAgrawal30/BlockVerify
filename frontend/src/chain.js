// Verification talks to the chain directly — no backend in the trust path.
// This is the point of the project: anyone with the RPC endpoint and the
// contract address can audit a product without asking us to be honest.
import { ethers } from "ethers";

// Ethers needs an absolute URL; /rpc is proxied to the node — see vite.config.js.
const RPC = (globalThis.location?.origin ?? "http://localhost:5173") + "/rpc";
const STATUS = ["NOT REGISTERED", "VERIFIED GENUINE", "OWNERSHIP MISMATCH"];
const ABI = [
  "function verifyProduct(uint256) view returns (uint8,address,uint256)",
  "function getProduct(uint256) view returns (tuple(uint256 productId,string name,address manufacturer,string batchNumber,uint256 mfgDate,address currentOwner))",
  "function getTransferLog(uint256) view returns (tuple(address from,address to,uint256 timestamp)[])",
];

export async function verifyOnChain(contractAddress, productId) {
  const c = new ethers.Contract(contractAddress, ABI, new ethers.JsonRpcProvider(RPC));
  const started = performance.now();
  const [code, owner, hops] = await c.verifyProduct(productId);
  const status = STATUS[Number(code)];
  if (Number(code) === 0) return { status, productId, latencyMs: Math.round(performance.now() - started) };

  const [p, log] = await Promise.all([c.getProduct(productId), c.getTransferLog(productId)]);
  return {
    status,
    productId,
    owner,
    hops: Number(hops),
    latencyMs: Math.round(performance.now() - started),
    product: {
      name: p.name,
      manufacturer: p.manufacturer,
      batchNumber: p.batchNumber,
      mfgDate: Number(p.mfgDate),
      currentOwner: p.currentOwner,
    },
    history: log.map((h) => ({ from: h.from, to: h.to, timestamp: Number(h.timestamp) })),
  };
}
