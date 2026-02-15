import {expect} from "chai";
import {ethers} from "hardhat";

describe("SettlementVault Extended Tests", function () {
  it("only allows operator to execute payouts", async function () {
    const [admin, operator, nonOperator, recipient] = await ethers.getSigners();

    const tokenFactory = await ethers.getContractFactory("MockERC20", admin);
    const token = await tokenFactory.deploy("Mock USD", "mUSD");
    await token.waitForDeployment();

    const vaultFactory = await ethers.getContractFactory("SettlementVault", admin);
    const vault = await vaultFactory.deploy(await token.getAddress(), admin.address);
    await vault.waitForDeployment();

    await token.mint(await vault.getAddress(), 10_000n);
    await vault.connect(admin).setOperator(operator.address, true);

    const requestId = ethers.keccak256(ethers.toUtf8Bytes("req-1"));

    // Operator can execute
    await expect(vault.connect(operator).payout(recipient.address, 500n, requestId)).to.not.be.reverted;

    // Non-operator cannot execute
    const requestId2 = ethers.keccak256(ethers.toUtf8Bytes("req-2"));
    await expect(vault.connect(nonOperator).payout(recipient.address, 500n, requestId2)).to.be.reverted;
  });

  it("admin can add and remove operators", async function () {
    const [admin, operator, recipient] = await ethers.getSigners();

    const tokenFactory = await ethers.getContractFactory("MockERC20", admin);
    const token = await tokenFactory.deploy("Mock USD", "mUSD");
    await token.waitForDeployment();

    const vaultFactory = await ethers.getContractFactory("SettlementVault", admin);
    const vault = await vaultFactory.deploy(await token.getAddress(), admin.address);
    await vault.waitForDeployment();

    await token.mint(await vault.getAddress(), 10_000n);

    // Add operator
    await vault.connect(admin).setOperator(operator.address, true);
    expect(await vault.hasRole(await vault.OPERATOR_ROLE(), operator.address)).to.be.true;

    // Remove operator
    await vault.connect(admin).setOperator(operator.address, false);
    expect(await vault.hasRole(await vault.OPERATOR_ROLE(), operator.address)).to.be.false;
  });

  it("emits PayoutExecuted event with correct parameters", async function () {
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
    const amount = 500n;

    await expect(vault.connect(operator).payout(recipient.address, amount, requestId))
      .to.emit(vault, "PayoutExecuted")
      .withArgs(requestId, operator.address, recipient.address, amount);
  });

  it("rejects payout with zero address", async function () {
    const [admin, operator] = await ethers.getSigners();

    const tokenFactory = await ethers.getContractFactory("MockERC20", admin);
    const token = await tokenFactory.deploy("Mock USD", "mUSD");
    await token.waitForDeployment();

    const vaultFactory = await ethers.getContractFactory("SettlementVault", admin);
    const vault = await vaultFactory.deploy(await token.getAddress(), admin.address);
    await vault.waitForDeployment();

    await token.mint(await vault.getAddress(), 10_000n);
    await vault.connect(admin).setOperator(operator.address, true);

    const requestId = ethers.keccak256(ethers.toUtf8Bytes("req-1"));

    await expect(
      vault.connect(operator).payout(ethers.ZeroAddress, 500n, requestId)
    ).to.be.revertedWith("to=0");
  });

  it("rejects payout with zero amount", async function () {
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

    await expect(vault.connect(operator).payout(recipient.address, 0n, requestId)).to.be.revertedWith("amount=0");
  });

  it("admin can pause and unpause", async function () {
    const [admin, operator, recipient] = await ethers.getSigners();

    const tokenFactory = await ethers.getContractFactory("MockERC20", admin);
    const token = await tokenFactory.deploy("Mock USD", "mUSD");
    await token.waitForDeployment();

    const vaultFactory = await ethers.getContractFactory("SettlementVault", admin);
    const vault = await vaultFactory.deploy(await token.getAddress(), admin.address);
    await vault.waitForDeployment();

    await token.mint(await vault.getAddress(), 10_000n);
    await vault.connect(admin).setOperator(operator.address, true);

    // Pause
    await vault.connect(admin).pause();
    expect(await vault.paused()).to.be.true;

    // Cannot execute while paused
    const requestId = ethers.keccak256(ethers.toUtf8Bytes("req-1"));
    await expect(vault.connect(operator).payout(recipient.address, 500n, requestId)).to.be.revertedWithCustomError(
      vault,
      "EnforcedPause"
    );

    // Unpause
    await vault.connect(admin).unpause();
    expect(await vault.paused()).to.be.false;

    // Can execute after unpause
    await expect(vault.connect(operator).payout(recipient.address, 500n, requestId)).to.not.be.reverted;
  });

  it("transfers correct amount to recipient", async function () {
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
    const amount = 500n;

    const balanceBefore = await token.balanceOf(recipient.address);
    await vault.connect(operator).payout(recipient.address, amount, requestId);
    const balanceAfter = await token.balanceOf(recipient.address);

    expect(balanceAfter - balanceBefore).to.equal(amount);
  });

  it("rejects constructor with zero asset address", async function () {
    const [admin] = await ethers.getSigners();

    const vaultFactory = await ethers.getContractFactory("SettlementVault", admin);

    await expect(vaultFactory.deploy(ethers.ZeroAddress, admin.address)).to.be.revertedWith("asset=0");
  });

  it("rejects constructor with zero admin address", async function () {
    const [admin] = await ethers.getSigners();

    const tokenFactory = await ethers.getContractFactory("MockERC20", admin);
    const token = await tokenFactory.deploy("Mock USD", "mUSD");
    await token.waitForDeployment();

    const vaultFactory = await ethers.getContractFactory("SettlementVault", admin);

    await expect(vaultFactory.deploy(await token.getAddress(), ethers.ZeroAddress)).to.be.revertedWith("admin=0");
  });
});
