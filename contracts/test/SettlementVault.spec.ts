import {expect} from "chai";
import {ethers} from "hardhat";

describe("SettlementVault", function () {
  it("prevents replay by requestId", async function () {
    const [admin, operator, recipient] = await ethers.getSigners();

    const tokenFactory = await ethers.getContractFactory("MockERC20", admin);
    const token = await tokenFactory.deploy("Mock USD", "mUSD");
    await token.waitForDeployment();

    const vaultFactory = await ethers.getContractFactory("SettlementVault", admin);
    const vault = await vaultFactory.deploy(await token.getAddress(), admin.address);
    await vault.waitForDeployment();

    await token.mint(await vault.getAddress(), 10_000n);
    await vault.connect(admin).setOperator(operator.address, true);

    const requestId = ethers.keccak256(ethers.toUtf8Bytes("req-1"));
    await vault.connect(operator).payout(recipient.address, 500n, requestId);

    await expect(vault.connect(operator).payout(recipient.address, 500n, requestId)).to.be.revertedWith(
      "already-executed"
    );
  });

  it("blocks payout when paused", async function () {
    const [admin, operator, recipient] = await ethers.getSigners();

    const tokenFactory = await ethers.getContractFactory("MockERC20", admin);
    const token = await tokenFactory.deploy("Mock USD", "mUSD");
    await token.waitForDeployment();

    const vaultFactory = await ethers.getContractFactory("SettlementVault", admin);
    const vault = await vaultFactory.deploy(await token.getAddress(), admin.address);
    await vault.waitForDeployment();

    await token.mint(await vault.getAddress(), 10_000n);
    await vault.connect(admin).setOperator(operator.address, true);
    await vault.connect(admin).pause();

    const requestId = ethers.keccak256(ethers.toUtf8Bytes("req-2"));
    await expect(vault.connect(operator).payout(recipient.address, 500n, requestId)).to.be.revertedWithCustomError(
      vault,
      "EnforcedPause"
    );
  });
});
