// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {
    MessageHashUtils
} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract SettlementVault is AccessControl, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // EIP-712 domain separator components
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );
    bytes32 private constant PAYOUT_TYPEHASH =
        keccak256(
            "PayoutApproval(bytes32 requestId,address to,uint256 amount)"
        );
    bytes32 private immutable DOMAIN_SEPARATOR;

    IERC20 public immutable asset;
    mapping(bytes32 => bool) public requestExecuted;
    mapping(bytes32 => bool) public requestCancelled;

    // --- Risk oracle signer (address(0) = signature not required) ---
    address public riskSigner;

    // --- On-chain limits (0 = no limit enforced) ---
    uint256 public maxPerPayout;
    uint256 public dailyLimit;

    // --- Daily spend tracking (UTC-day epoch => total spent) ---
    mapping(uint256 => uint256) public dailySpent;

    // --- On-chain denylist ---
    mapping(address => bool) public isDenied;

    event PayoutExecuted(
        bytes32 requestId,
        address operator,
        address to,
        uint256 amount
    );
    event OperatorUpdated(
        address indexed operator,
        bool enabled,
        address indexed admin
    );
    event VaultPaused(address indexed admin);
    event VaultUnpaused(address indexed admin);
    event TokenSwept(
        address indexed token,
        address indexed to,
        uint256 amount,
        address indexed admin
    );
    event RequestCancelled(bytes32 indexed requestId, address indexed admin);
    event MaxPerPayoutUpdated(
        uint256 oldValue,
        uint256 newValue,
        address indexed admin
    );
    event DailyLimitUpdated(
        uint256 oldValue,
        uint256 newValue,
        address indexed admin
    );
    event DenylistUpdated(
        address indexed account,
        bool denied,
        address indexed admin
    );
    event EmergencyWithdraw(
        address indexed to,
        uint256 amount,
        address indexed admin
    );
    event RiskSignerUpdated(
        address indexed oldSigner,
        address indexed newSigner,
        address indexed admin
    );

    constructor(address asset_, address admin_) {
        require(asset_ != address(0), "asset=0");
        require(admin_ != address(0), "admin=0");
        asset = IERC20(asset_);

        _grantRole(ADMIN_ROLE, admin_);

        // Role administration (including managing ADMIN_ROLE and OPERATOR_ROLE)
        // is restricted so that only accounts with ADMIN_ROLE can administer these roles,
        // via the standard AccessControl functions (grantRole, revokeRole, renounceRole).
        // Application-level usage MUST NOT call those functions directly to manage
        // operators; instead, operator changes are expected to go through setOperator().

        // Harden role hierarchy: ADMIN_ROLE manages itself and operators.
        _setRoleAdmin(ADMIN_ROLE, ADMIN_ROLE);

        // Restrict granting/revoking OPERATOR_ROLE to ADMIN_ROLE
        // to prevent bypassing setOperator() via inherited grantRole()
        _setRoleAdmin(OPERATOR_ROLE, ADMIN_ROLE);

        // EIP-712 domain separator (computed once at deploy)
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256("SettlementVault"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    // ──────── Admin: operator management ────────

    function setOperator(
        address operator,
        bool enabled
    ) external onlyRole(ADMIN_ROLE) {
        require(operator != address(0), "operator=0");

        if (enabled) {
            _grantRole(OPERATOR_ROLE, operator);
        } else {
            _revokeRole(OPERATOR_ROLE, operator);
        }

        emit OperatorUpdated(operator, enabled, msg.sender);
    }

    // ──────── Admin: pause ────────

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
        emit VaultPaused(msg.sender);
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
        emit VaultUnpaused(msg.sender);
    }

    // ──────── Admin: on-chain limits ────────

    function setMaxPerPayout(
        uint256 maxPerPayout_
    ) external onlyRole(ADMIN_ROLE) {
        uint256 old = maxPerPayout;
        maxPerPayout = maxPerPayout_;
        emit MaxPerPayoutUpdated(old, maxPerPayout_, msg.sender);
    }

    function setDailyLimit(uint256 dailyLimit_) external onlyRole(ADMIN_ROLE) {
        uint256 old = dailyLimit;
        dailyLimit = dailyLimit_;
        emit DailyLimitUpdated(old, dailyLimit_, msg.sender);
    }

    // ──────── Admin: on-chain denylist ────────

    function setDenied(
        address account,
        bool denied
    ) external onlyRole(ADMIN_ROLE) {
        require(account != address(0), "account=0");
        isDenied[account] = denied;
        emit DenylistUpdated(account, denied, msg.sender);
    }

    // ──────── Admin: risk oracle signer ────────

    function setRiskSigner(address signer_) external onlyRole(ADMIN_ROLE) {
        address old = riskSigner;
        riskSigner = signer_;
        emit RiskSignerUpdated(old, signer_, msg.sender);
    }

    // ──────── Admin: cancel a requestId preventively ────────

    function cancelRequest(bytes32 requestId) external onlyRole(ADMIN_ROLE) {
        require(requestId != bytes32(0), "requestId=0");
        require(!requestExecuted[requestId], "already-executed");
        requestCancelled[requestId] = true;
        emit RequestCancelled(requestId, msg.sender);
    }

    // ──────── Admin: sweep non-primary tokens ────────

    function sweepToken(
        address token,
        address to,
        uint256 amount
    ) external onlyRole(ADMIN_ROLE) {
        require(token != address(0), "token=0");
        require(token != address(asset), "cannot-sweep-asset");
        require(to != address(0), "to=0");

        IERC20(token).safeTransfer(to, amount);
        emit TokenSwept(token, to, amount, msg.sender);
    }

    // ──────── Admin: emergency withdraw primary asset ────────

    function emergencyWithdraw(
        address to,
        uint256 amount
    ) external onlyRole(ADMIN_ROLE) {
        require(to != address(0), "to=0");
        require(amount > 0, "amount=0");

        asset.safeTransfer(to, amount);
        emit EmergencyWithdraw(to, amount, msg.sender);
    }

    // ──────── Operator: payout (no signature — only allowed if riskSigner is not set) ────────

    function payout(
        address to,
        uint256 amount,
        bytes32 requestId
    ) external onlyRole(OPERATOR_ROLE) whenNotPaused {
        require(riskSigner == address(0), "risk-signature-required");
        _executePayout(to, amount, requestId);
    }

    // ──────── Operator: payout with risk oracle signature ────────

    function payoutWithApproval(
        address to,
        uint256 amount,
        bytes32 requestId,
        bytes calldata riskSignature
    ) external onlyRole(OPERATOR_ROLE) whenNotPaused {
        require(riskSigner != address(0), "risk-signer-not-set");
        _verifyRiskSignature(requestId, to, amount, riskSignature);
        _executePayout(to, amount, requestId);
    }

    // ──────── Internal: shared payout logic ────────

    function _executePayout(
        address to,
        uint256 amount,
        bytes32 requestId
    ) internal {
        require(to != address(0), "to=0");
        require(amount > 0, "amount=0");
        require(requestId != bytes32(0), "requestId=0");
        require(!requestExecuted[requestId], "already-executed");
        require(!requestCancelled[requestId], "request-cancelled");
        require(!isDenied[to], "recipient-denied");

        // On-chain per-payout limit (0 = no limit)
        if (maxPerPayout > 0) {
            require(amount <= maxPerPayout, "exceeds-max-per-payout");
        }

        // On-chain daily limit (0 = no limit)
        if (dailyLimit > 0) {
            // Bucket payouts into 24-hour periods using integer division of the Unix timestamp.
            // This creates 86,400-second, epoch-based "UTC day" buckets aligned to the Unix epoch (1970-01-01 00:00:00 UTC).
            uint256 epochDayBucket = block.timestamp / 1 days;
            uint256 newDaily = dailySpent[epochDayBucket] + amount;
            require(newDaily <= dailyLimit, "exceeds-daily-limit");
            dailySpent[epochDayBucket] = newDaily;
        }

        requestExecuted[requestId] = true;

        asset.safeTransfer(to, amount);
        emit PayoutExecuted(requestId, msg.sender, to, amount);
    }

    // ──────── Internal: EIP-712 signature verification ────────

    function _verifyRiskSignature(
        bytes32 requestId,
        address to,
        uint256 amount,
        bytes calldata signature
    ) internal view {
        bytes32 structHash = keccak256(
            abi.encode(PAYOUT_TYPEHASH, requestId, to, amount)
        );
        bytes32 digest = MessageHashUtils.toTypedDataHash(
            DOMAIN_SEPARATOR,
            structHash
        );
        address recovered = ECDSA.recover(digest, signature);
        require(recovered == riskSigner, "invalid-risk-signature");
    }

    // ──────── View: get EIP-712 domain separator ────────

    function domainSeparator() external view returns (bytes32) {
        return DOMAIN_SEPARATOR;
    }
}
