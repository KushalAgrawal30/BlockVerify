const fs = require("fs");
const path = require("path");
const { ethers, artifacts } = require("hardhat");

async function main() {
  const c = await ethers.deployContract("OwnershipTransfer");
  await c.waitForDeployment();
  const address = await c.getAddress();

  const { abi } = await artifacts.readArtifact("OwnershipTransfer");
  const out = path.join(__dirname, "..", "deployment.json");
  fs.writeFileSync(out, JSON.stringify({ address, abi }, null, 2));

  console.log("OwnershipTransfer deployed at", address);
  console.log("wrote", out);
}

main().catch((e) => { console.error(e); process.exit(1); });
