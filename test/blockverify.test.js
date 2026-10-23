const { expect } = require("chai");
const { ethers } = require("hardhat");

const NOT_REGISTERED = 0n, GENUINE = 1n, MISMATCH = 2n;

describe("BlockVerify", function () {
  let c, mfg, dist, retail, cust;

  beforeEach(async function () {
    [mfg, dist, retail, cust] = await ethers.getSigners();
    c = await ethers.deployContract("OwnershipTransfer");
  });

  const register = (signer = mfg, serial = "SN-1") =>
    c.connect(signer).registerProduct(serial, "Paracetamol 500mg", "BATCH-A", 1700000000);

  it("registers a product with an immutable identity", async function () {
    await expect(register()).to.emit(c, "ProductRegistered");
    const p = await c.getProduct(1);
    expect(p.name).to.equal("Paracetamol 500mg");
    expect(p.manufacturer).to.equal(mfg.address);
    expect(p.currentOwner).to.equal(mfg.address);
  });

  it("reverts on a duplicate serial", async function () {
    await register();
    await expect(register()).to.be.revertedWith("duplicate serial");
  });

  it("transfers ownership down the supply chain", async function () {
    await register();
    await c.connect(mfg).transferOwnership(1, dist.address);
    await c.connect(dist).transferOwnership(1, retail.address);
    await c.connect(retail).transferOwnership(1, cust.address);

    expect((await c.getProduct(1)).currentOwner).to.equal(cust.address);
    expect(await c.getTransferLog(1)).to.have.lengthOf(3);
  });

  it("rejects a transfer from a non-owner", async function () {
    await register();
    await expect(
      c.connect(dist).transferOwnership(1, retail.address)
    ).to.be.revertedWith("not current owner");
  });

  it("rejects a transfer of an unregistered product", async function () {
    await expect(
      c.connect(mfg).transferOwnership(99, dist.address)
    ).to.be.revertedWith("not registered");
  });

  it("verifyProduct returns NOT_REGISTERED for an unknown id (cloned QR)", async function () {
    const [status] = await c.verifyProduct(42);
    expect(status).to.equal(NOT_REGISTERED);
  });

  it("verifyProduct returns GENUINE with an unbroken custody chain", async function () {
    await register();
    await c.connect(mfg).transferOwnership(1, dist.address);
    await c.connect(dist).transferOwnership(1, retail.address);
    const [status, owner, hops] = await c.verifyProduct(1);
    expect(status).to.equal(GENUINE);
    expect(owner).to.equal(retail.address);
    expect(hops).to.equal(2n);
  });

  it("verifyProduct returns OWNERSHIP MISMATCH when the record is tampered with", async function () {
    await register();
    await c.connect(mfg).transferOwnership(1, dist.address);

    // Force currentOwner to an address the transfer log does not lead to.
    // Only a development node allows this; it is how the mismatch branch —
    // unreachable through the contract's own functions — gets exercised.
    const slot = ethers.toBeHex(
      BigInt(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [1, 1]))) + 5n, 32);
    await ethers.provider.send("hardhat_setStorageAt", [
      await c.getAddress(), slot, ethers.zeroPadValue(retail.address, 32),
    ]);

    const [status, owner] = await c.verifyProduct(1);
    expect(status).to.equal(MISMATCH);
    expect(owner).to.equal(retail.address);          // the forged owner
    expect((await c.getTransferLog(1))[0].to).to.equal(dist.address); // the real one
  });

  it("reports gas cost per transaction type", async function () {
    const r = await (await register()).wait();
    const t = await (await c.connect(mfg).transferOwnership(1, dist.address)).wait();
    console.log(`      gas: registerProduct=${r.gasUsed}  transferOwnership=${t.gasUsed}`);
    expect(r.gasUsed).to.be.greaterThan(0n);
  });
});
