import {expect} from "chai";
import {ethers} from "hardhat";
import type {BaseContract, ContractRunner, ContractTransactionResponse} from "ethers";

export interface SettlementVaultContract extends BaseContract {
  connect(runner: ContractRunner | null): SettlementVaultContract;
  asset(): Promise<string>;
  ADMIN_ROLE(): Promise<string>;
  DEFAULT_ADMIN_ROLE(): Promise<string>;
  OPERATOR_ROLE(): Promise<string>;
  hasRole(role: string, account: string): Promise<boolean>;
  requestExecuted(requestId: string): Promise<boolean>;
  setOperator(operator: string, enabled: boolean): Promise<ContractTransactionResponse>;
  payout(to: string, amount: bigint, requestId: string): Promise<ContractTransactionResponse>;
  pause(): Promise<ContractTransactionResponse>;
  unpause(): Promise<ContractTransactionResponse>;
}

export interface MockERC20Contract extends BaseContract {
  connect(runner: ContractRunner | null): MockERC20Contract;
  mint(to: string, amount: bigint): Promise<ContractTransactionResponse>;
  balanceOf(account: string): Promise<bigint>;
}

describe("SettlementVault (additional)", function () {
  async function deployFixture() {
    const [admin, operator, operator2, recipient, stranger] = await ethers.getSigners();

    const tokenFactory = await ethers.getContractFactory("MockERC20", admin);
    const token = await tokenFactory.deploy("Mock USD", "mUSD") as unknown as MockERC20Contract;
    await token.waitForDeployment();

    const vaultFactory = await ethers.getContractFactory("SettlementVault", admin);
    const vault = await vaultFactory.deploy(await token.getAddress(), admin.address) as unknown as SettlementVaultContract;
    await vault.waitForDeployment();

    await token.mint(await vault.getAddress(), 1_000_000n);
    await vault.connect(admin).setOperator(operator.address, true);

    return {admin, operator, operator2, recipient, stranger, token, vault};
  }

  // ── Constructor ──

  describe("constructor", function () {
    it("reverts when asset is zero address", async function () {
      const [admin] = await ethers.getSigners();
      const factory = await ethers.getContractFactory("SettlementVault", admin);
      await expect(factory.deploy(ethers.ZeroAddress, admin.address)).to.be.revertedWith("asset=0");
    });

    it("reverts when admin is zero address", async function () {
      const [admin] = await ethers.getSigners();
      const tokenFactory = await ethers.getContractFactory("MockERC20", admin);
      const token = await tokenFactory.deploy("T", "T");
      await token.waitForDeployment();
      const factory = await ethers.getContractFactory("SettlementVault", admin);
      await expect(factory.deploy(await token.getAddress(), ethers.ZeroAddress)).to.be.revertedWith("admin=0");
    });

    it("sets asset correctly", async function () {
      const {token, vault} = await deployFixture();
      expect(await vault.asset()).to.equal(await token.getAddress());
    });

    it("grants ADMIN_ROLE and DEFAULT_ADMIN_ROLE to deployer", async function () {
      const {admin, vault} = await deployFixture();
      expect(await vault.hasRole(await vault.ADMIN_ROLE(), admin.address)).to.be.true;
      expect(await vault.hasRole(await vault.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
    });
  });

  describe("payout positive cases", function () {
    it("transfers correct ERC20 amount to recipient", async function () {
      const {operator, recipient, token, vault} = await deployFixture();
      const reqId = ethers.keccak256(ethers.toUtf8Bytes("p-1"));
      const before = await token.balanceOf(recipient.address);
      await vault.connect(operator).payout(recipient.address, 500n, reqId);
      expect(await token.balanceOf(recipient.address)).to.equal(before + 500n);
    });

    it("decreases vault balance accordingly", async function () {
      const {operator, recipient, token, vault} = await deployFixture();
      const reqId = ethers.keccak256(ethers.toUtf8Bytes("p-2"));
      const before = await token.balanceOf(await vault.getAddress());
      await vault.connect(operator).payout(recipient.address, 300n, reqId);
      expect(await token.balanceOf(await vault.getAddress())).to.equal(before - 300n);
    });

    it("emits PayoutExecuted with correct parameters", async function () {
      const {operator, recipient, vault} = await deployFixture();
      const reqId = ethers.keccak256(ethers.toUtf8Bytes("p-3"));
      await expect(vault.connect(operator).payout(recipient.address, 100n, reqId))
        .to.emit(vault, "PayoutExecuted")
        .withArgs(reqId, operator.address, recipient.address, 100n);
    });

    it("marks requestId as executed", async function () {
      const {operator, recipient, vault} = await deployFixture();
      const reqId = ethers.keccak256(ethers.toUtf8Bytes("p-4"));
      expect(await vault.requestExecuted(reqId)).to.be.false;
      await vault.connect(operator).payout(recipient.address, 100n, reqId);
      expect(await vault.requestExecuted(reqId)).to.be.true;
    });

    it("allows different requestIds to execute independently", async function () {
      const {operator, recipient, vault} = await deployFixture();
      const req1 = ethers.keccak256(ethers.toUtf8Bytes("multi-1"));
      const req2 = ethers.keccak256(ethers.toUtf8Bytes("multi-2"));
      await vault.connect(operator).payout(recipient.address, 100n, req1);
      await vault.connect(operator).payout(recipient.address, 200n, req2);
      expect(await vault.requestExecuted(req1)).to.be.true;
      expect(await vault.requestExecuted(req2)).to.be.true;
    });
  });


  describe("payout negative cases", function () {
    it("reverts when caller lacks OPERATOR_ROLE", async function () {
      const {stranger, recipient, vault} = await deployFixture();
      const reqId = ethers.keccak256(ethers.toUtf8Bytes("n-1"));
      await expect(vault.connect(stranger).payout(recipient.address, 100n, reqId)).to.be.revertedWithCustomError(
        vault,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("reverts when recipient is zero address", async function () {
      const {operator, vault} = await deployFixture();
      const reqId = ethers.keccak256(ethers.toUtf8Bytes("n-2"));
      await expect(vault.connect(operator).payout(ethers.ZeroAddress, 100n, reqId)).to.be.revertedWith("to=0");
    });

    it("reverts when amount is zero", async function () {
      const {operator, recipient, vault} = await deployFixture();
      const reqId = ethers.keccak256(ethers.toUtf8Bytes("n-3"));
      await expect(vault.connect(operator).payout(recipient.address, 0n, reqId)).to.be.revertedWith("amount=0");
    });

    it("reverts on replay of same requestId", async function () {
      const {operator, recipient, vault} = await deployFixture();
      const reqId = ethers.keccak256(ethers.toUtf8Bytes("n-4"));
      await vault.connect(operator).payout(recipient.address, 100n, reqId);
      await expect(vault.connect(operator).payout(recipient.address, 100n, reqId)).to.be.revertedWith(
        "already-executed"
      );
    });

    it("reverts when vault has insufficient balance", async function () {
      const {operator, recipient, vault} = await deployFixture();
      const reqId = ethers.keccak256(ethers.toUtf8Bytes("n-5"));
      await expect(vault.connect(operator).payout(recipient.address, 99_999_999n, reqId)).to.be.reverted;
    });
  });

  describe("operator management", function () {
    it("admin can add an operator", async function () {
      const {admin, operator2, vault} = await deployFixture();
      await vault.connect(admin).setOperator(operator2.address, true);
      expect(await vault.hasRole(await vault.OPERATOR_ROLE(), operator2.address)).to.be.true;
    });

    it("admin can remove an operator", async function () {
      const {admin, operator, vault} = await deployFixture();
      await vault.connect(admin).setOperator(operator.address, false);
      expect(await vault.hasRole(await vault.OPERATOR_ROLE(), operator.address)).to.be.false;
    });

    it("non-admin cannot set operators", async function () {
      const {stranger, operator2, vault} = await deployFixture();
      await expect(vault.connect(stranger).setOperator(operator2.address, true)).to.be.revertedWithCustomError(
        vault,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("multiple operators can execute payouts independently", async function () {
      const {admin, operator, operator2, recipient, vault} = await deployFixture();
      await vault.connect(admin).setOperator(operator2.address, true);
      const req1 = ethers.keccak256(ethers.toUtf8Bytes("op-1"));
      const req2 = ethers.keccak256(ethers.toUtf8Bytes("op-2"));
      await vault.connect(operator).payout(recipient.address, 100n, req1);
      await vault.connect(operator2).payout(recipient.address, 200n, req2);
    });

    it("removed operator cannot execute payouts", async function () {
      const {admin, operator, recipient, vault} = await deployFixture();
      await vault.connect(admin).setOperator(operator.address, false);
      const reqId = ethers.keccak256(ethers.toUtf8Bytes("removed-op"));
      await expect(vault.connect(operator).payout(recipient.address, 100n, reqId)).to.be.revertedWithCustomError(
        vault,
        "AccessControlUnauthorizedAccount"
      );
    });
  });

  describe("pause / unpause", function () {
    it("non-admin cannot pause", async function () {
      const {stranger, vault} = await deployFixture();
      await expect(vault.connect(stranger).pause()).to.be.revertedWithCustomError(
        vault,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("non-admin cannot unpause", async function () {
      const {admin, stranger, vault} = await deployFixture();
      await vault.connect(admin).pause();
      await expect(vault.connect(stranger).unpause()).to.be.revertedWithCustomError(
        vault,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("payouts resume after unpause", async function () {
      const {admin, operator, recipient, vault} = await deployFixture();
      await vault.connect(admin).pause();
      await vault.connect(admin).unpause();
      const reqId = ethers.keccak256(ethers.toUtf8Bytes("resume-1"));
      await expect(vault.connect(operator).payout(recipient.address, 100n, reqId)).to.not.be.reverted;
    });

    it("cannot pause when already paused", async function () {
      const {admin, vault} = await deployFixture();
      await vault.connect(admin).pause();
      await expect(vault.connect(admin).pause()).to.be.revertedWithCustomError(vault, "EnforcedPause");
    });

    it("cannot unpause when not paused", async function () {
      const {admin, vault} = await deployFixture();
      await expect(vault.connect(admin).unpause()).to.be.revertedWithCustomError(vault, "ExpectedPause");
    });
  });
});
