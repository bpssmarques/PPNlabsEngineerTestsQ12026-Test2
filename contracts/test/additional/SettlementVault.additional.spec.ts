import { expect } from "chai";
import { ethers } from "hardhat";

// Helper: deploys token + vault, returns both + admin signer
async function deployVault() {
  const [admin, operator, recipient, riskSignerWallet] = await ethers.getSigners();
  const tokenFactory = await ethers.getContractFactory("MockERC20", admin);
  const token = await tokenFactory.deploy("Mock USD", "mUSD");
  await token.waitForDeployment();

  const vaultFactory = await ethers.getContractFactory("SettlementVault", admin);
  const vault = await vaultFactory.deploy(await token.getAddress(), admin.address);
  await vault.waitForDeployment();

  return { admin, operator, recipient, riskSignerWallet, token, vault };
}

// Helper: produces an EIP-712 risk approval signature
async function signRiskApproval(
  signer: Awaited<ReturnType<typeof ethers.getSigners>>[number],
  vaultAddress: string,
  chainId: bigint,
  requestId: string,
  to: string,
  amount: bigint
): Promise<string> {
  const domain = {
    name: "SettlementVault",
    version: "1",
    chainId,
    verifyingContract: vaultAddress,
  };
  const types = {
    PayoutApproval: [
      { name: "requestId", type: "bytes32" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
  };
  const value = { requestId, to, amount };
  return signer.signTypedData(domain, types, value);
}

describe("SettlementVault additional", function () {
  it("blocks non-admin from granting ADMIN_ROLE", async function () {
    const { operator, recipient, vault } = await deployVault();
    const adminRole = await vault.ADMIN_ROLE();

    await expect(
      vault.connect(operator).grantRole(adminRole, recipient.address)
    ).to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
  });

  it("allows ADMIN_ROLE holder to grant ADMIN_ROLE", async function () {
    const { admin, operator, recipient, vault } = await deployVault();
    const adminRole = await vault.ADMIN_ROLE();

    await expect(vault.connect(admin).grantRole(adminRole, operator.address))
      .to.emit(vault, "RoleGranted")
      .withArgs(adminRole, operator.address, admin.address);

    expect(await vault.hasRole(adminRole, operator.address)).to.equal(true);

    await expect(vault.connect(operator).setOperator(recipient.address, true))
      .to.emit(vault, "OperatorUpdated")
      .withArgs(recipient.address, true, operator.address);
  });

  it("emits admin events for operator updates and pause toggles", async function () {
    const { admin, operator, vault } = await deployVault();

    await expect(vault.connect(admin).setOperator(operator.address, true))
      .to.emit(vault, "OperatorUpdated")
      .withArgs(operator.address, true, admin.address);

    await expect(vault.connect(admin).pause())
      .to.emit(vault, "VaultPaused")
      .withArgs(admin.address);

    await expect(vault.connect(admin).unpause())
      .to.emit(vault, "VaultUnpaused")
      .withArgs(admin.address);
  });

  it("rejects zero operator in setOperator", async function () {
    const { admin, vault } = await deployVault();
    await expect(vault.connect(admin).setOperator(ethers.ZeroAddress, true)).to.be.revertedWith("operator=0");
  });

  it("allows admin to sweep non-primary tokens", async function () {
    const { admin, recipient, vault } = await deployVault();

    const tokenFactory = await ethers.getContractFactory("MockERC20", admin);
    const secondaryToken = await tokenFactory.deploy("Secondary USD", "sUSD");
    await secondaryToken.waitForDeployment();

    await secondaryToken.mint(await vault.getAddress(), 1_000n);

    await expect(vault.connect(admin).sweepToken(await secondaryToken.getAddress(), recipient.address, 400n))
      .to.emit(vault, "TokenSwept")
      .withArgs(await secondaryToken.getAddress(), recipient.address, 400n, admin.address);

    expect(await secondaryToken.balanceOf(recipient.address)).to.equal(400n);
    expect(await secondaryToken.balanceOf(await vault.getAddress())).to.equal(600n);
  });

  it("blocks sweeping the primary asset", async function () {
    const { admin, recipient, token, vault } = await deployVault();
    await token.mint(await vault.getAddress(), 1_000n);

    await expect(
      vault.connect(admin).sweepToken(await token.getAddress(), recipient.address, 100n)
    ).to.be.revertedWith("cannot-sweep-asset");
  });

  it("blocks sweeping with zero token address", async function () {
    const { admin, recipient, vault } = await deployVault();

    await expect(
      vault.connect(admin).sweepToken(ethers.ZeroAddress, recipient.address, 100n)
    ).to.be.revertedWith("token=0");
  });

  // ════════════════════════════════════════════════════════════════════
  //  Risk Oracle (EIP-712 signature) tests
  // ════════════════════════════════════════════════════════════════════

  it("payoutWithApproval succeeds with valid risk signature", async function () {
    const { admin, operator, recipient, riskSignerWallet, token, vault } = await deployVault();

    await token.mint(await vault.getAddress(), 100_000n);
    await vault.connect(admin).setOperator(operator.address, true);
    await vault.connect(admin).setRiskSigner(riskSignerWallet.address);

    const requestId = ethers.keccak256(ethers.toUtf8Bytes("risk-oracle-req-1"));
    const amount = 500n;
    const chainId = (await ethers.provider.getNetwork()).chainId;

    const sig = await signRiskApproval(
      riskSignerWallet,
      await vault.getAddress(),
      chainId,
      requestId,
      recipient.address,
      amount
    );

    await expect(
      vault.connect(operator).payoutWithApproval(recipient.address, amount, requestId, sig)
    )
      .to.emit(vault, "PayoutExecuted")
      .withArgs(requestId, operator.address, recipient.address, amount);

    expect(await token.balanceOf(recipient.address)).to.equal(amount);
  });

  it("payoutWithApproval rejects invalid signature (wrong signer)", async function () {
    const signers = await ethers.getSigners();
    const admin = signers[0];
    const operator = signers[1];
    const recipient = signers[2];
    const riskSigner = signers[3];
    const imposter = signers[4];

    const { token, vault } = await deployVault();
    await token.mint(await vault.getAddress(), 100_000n);
    await vault.connect(admin).setOperator(operator.address, true);
    await vault.connect(admin).setRiskSigner(riskSigner.address);

    const requestId = ethers.keccak256(ethers.toUtf8Bytes("risk-oracle-req-2"));
    const amount = 500n;
    const chainId = (await ethers.provider.getNetwork()).chainId;

    // Sign with wrong key (imposter instead of riskSigner)
    const badSig = await signRiskApproval(
      imposter,
      await vault.getAddress(),
      chainId,
      requestId,
      recipient.address,
      amount
    );

    await expect(
      vault.connect(operator).payoutWithApproval(recipient.address, amount, requestId, badSig)
    ).to.be.revertedWith("invalid-risk-signature");
  });

  it("payoutWithApproval rejects tampered amount", async function () {
    const { admin, operator, recipient, riskSignerWallet, token, vault } = await deployVault();

    await token.mint(await vault.getAddress(), 100_000n);
    await vault.connect(admin).setOperator(operator.address, true);
    await vault.connect(admin).setRiskSigner(riskSignerWallet.address);

    const requestId = ethers.keccak256(ethers.toUtf8Bytes("risk-oracle-req-3"));
    const chainId = (await ethers.provider.getNetwork()).chainId;

    // Sign for 500, but try to payout 5000
    const sig = await signRiskApproval(
      riskSignerWallet,
      await vault.getAddress(),
      chainId,
      requestId,
      recipient.address,
      500n
    );

    await expect(
      vault.connect(operator).payoutWithApproval(recipient.address, 5000n, requestId, sig)
    ).to.be.revertedWith("invalid-risk-signature");
  });

  it("payout() blocked when riskSigner is set", async function () {
    const { admin, operator, recipient, riskSignerWallet, token, vault } = await deployVault();

    await token.mint(await vault.getAddress(), 100_000n);
    await vault.connect(admin).setOperator(operator.address, true);
    await vault.connect(admin).setRiskSigner(riskSignerWallet.address);

    const requestId = ethers.keccak256(ethers.toUtf8Bytes("risk-oracle-req-4"));

    // Without riskSigner set, payout() would work. With it, must fail.
    await expect(
      vault.connect(operator).payout(recipient.address, 500n, requestId)
    ).to.be.revertedWith("risk-signature-required");
  });

  it("payoutWithApproval() blocked when riskSigner is not set", async function () {
    const { admin, operator, recipient, token, vault } = await deployVault();

    await token.mint(await vault.getAddress(), 100_000n);
    await vault.connect(admin).setOperator(operator.address, true);
    // riskSigner not set — remains address(0)

    const requestId = ethers.keccak256(ethers.toUtf8Bytes("risk-oracle-req-5"));

    await expect(
      vault.connect(operator).payoutWithApproval(recipient.address, 500n, requestId, "0x")
    ).to.be.revertedWith("risk-signer-not-set");
  });

  it("admin can rotate risk signer", async function () {
    const signers = await ethers.getSigners();
    const admin = signers[0];
    const signer1 = signers[3];
    const signer2 = signers[4];

    const { vault } = await deployVault();

    await expect(vault.connect(admin).setRiskSigner(signer1.address))
      .to.emit(vault, "RiskSignerUpdated")
      .withArgs(ethers.ZeroAddress, signer1.address, admin.address);

    await expect(vault.connect(admin).setRiskSigner(signer2.address))
      .to.emit(vault, "RiskSignerUpdated")
      .withArgs(signer1.address, signer2.address, admin.address);
  });

  it("replay protection works with payoutWithApproval", async function () {
    const { admin, operator, recipient, riskSignerWallet, token, vault } = await deployVault();

    await token.mint(await vault.getAddress(), 100_000n);
    await vault.connect(admin).setOperator(operator.address, true);
    await vault.connect(admin).setRiskSigner(riskSignerWallet.address);

    const requestId = ethers.keccak256(ethers.toUtf8Bytes("risk-oracle-req-replay"));
    const amount = 500n;
    const chainId = (await ethers.provider.getNetwork()).chainId;

    const sig = await signRiskApproval(
      riskSignerWallet,
      await vault.getAddress(),
      chainId,
      requestId,
      recipient.address,
      amount
    );

    await vault.connect(operator).payoutWithApproval(recipient.address, amount, requestId, sig);

    // Replay must fail
    await expect(
      vault.connect(operator).payoutWithApproval(recipient.address, amount, requestId, sig)
    ).to.be.revertedWith("already-executed");
  });

  // ════════════════════════════════════════════════════════════════════
  //  On-chain limits tests
  // ════════════════════════════════════════════════════════════════════

  it("enforces maxPerPayout limit", async function () {
    const { admin, operator, recipient, token, vault } = await deployVault();

    await token.mint(await vault.getAddress(), 100_000n);
    await vault.connect(admin).setOperator(operator.address, true);
    await vault.connect(admin).setMaxPerPayout(1000n);

    const reqOk = ethers.keccak256(ethers.toUtf8Bytes("limit-ok"));
    await vault.connect(operator).payout(recipient.address, 1000n, reqOk);

    const reqOver = ethers.keccak256(ethers.toUtf8Bytes("limit-over"));
    await expect(
      vault.connect(operator).payout(recipient.address, 1001n, reqOver)
    ).to.be.revertedWith("exceeds-max-per-payout");
  });

  it("enforces dailyLimit", async function () {
    const { admin, operator, recipient, token, vault } = await deployVault();

    await token.mint(await vault.getAddress(), 100_000n);
    await vault.connect(admin).setOperator(operator.address, true);
    await vault.connect(admin).setDailyLimit(2000n);

    const req1 = ethers.keccak256(ethers.toUtf8Bytes("daily-1"));
    await vault.connect(operator).payout(recipient.address, 1500n, req1);

    const req2 = ethers.keccak256(ethers.toUtf8Bytes("daily-2"));
    await expect(
      vault.connect(operator).payout(recipient.address, 501n, req2)
    ).to.be.revertedWith("exceeds-daily-limit");

    // Exactly the remaining should work
    const req3 = ethers.keccak256(ethers.toUtf8Bytes("daily-3"));
    await vault.connect(operator).payout(recipient.address, 500n, req3);
  });

  it("enforces on-chain denylist", async function () {
    const { admin, operator, recipient, token, vault } = await deployVault();

    await token.mint(await vault.getAddress(), 100_000n);
    await vault.connect(admin).setOperator(operator.address, true);
    await vault.connect(admin).setDenied(recipient.address, true);

    const reqId = ethers.keccak256(ethers.toUtf8Bytes("deny-test"));
    await expect(
      vault.connect(operator).payout(recipient.address, 500n, reqId)
    ).to.be.revertedWith("recipient-denied");

    // Un-deny and succeed
    await vault.connect(admin).setDenied(recipient.address, false);
    await vault.connect(operator).payout(recipient.address, 500n, reqId);
  });

  it("admin can cancel a requestId", async function () {
    const { admin, operator, recipient, token, vault } = await deployVault();

    await token.mint(await vault.getAddress(), 100_000n);
    await vault.connect(admin).setOperator(operator.address, true);

    const reqId = ethers.keccak256(ethers.toUtf8Bytes("cancel-test"));

    await expect(vault.connect(admin).cancelRequest(reqId))
      .to.emit(vault, "RequestCancelled")
      .withArgs(reqId, admin.address);

    await expect(
      vault.connect(operator).payout(recipient.address, 500n, reqId)
    ).to.be.revertedWith("request-cancelled");
  });

  it("admin can emergency withdraw primary asset", async function () {
    const { admin, recipient, token, vault } = await deployVault();

    await token.mint(await vault.getAddress(), 5_000n);

    await expect(vault.connect(admin).emergencyWithdraw(recipient.address, 3_000n))
      .to.emit(vault, "EmergencyWithdraw")
      .withArgs(recipient.address, 3_000n, admin.address);

    expect(await token.balanceOf(recipient.address)).to.equal(3_000n);
    expect(await token.balanceOf(await vault.getAddress())).to.equal(2_000n);
  });
});
