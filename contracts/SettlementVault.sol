// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SettlementVault is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    IERC20 public immutable asset;
    mapping(bytes32 => bool) public requestExecuted;

    event PayoutExecuted(bytes32 requestId, address operator, address to, uint256 amount);

    constructor(address asset_, address admin_) {
        require(asset_ != address(0), "asset=0");
        require(admin_ != address(0), "admin=0");
        asset = IERC20(asset_);

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(ADMIN_ROLE, admin_);
    }

    function setOperator(address operator, bool enabled) external onlyRole(ADMIN_ROLE) {
        if (enabled) {
            _grantRole(OPERATOR_ROLE, operator);
        } else {
            _revokeRole(OPERATOR_ROLE, operator);
        }
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    function payout(address to, uint256 amount, bytes32 requestId) external onlyRole(OPERATOR_ROLE) whenNotPaused nonReentrant {
        require(to != address(0), "to=0");
        require(amount > 0, "amount=0");
        require(!requestExecuted[requestId], "already-executed");

        requestExecuted[requestId] = true;

        asset.safeTransfer(to, amount);
        emit PayoutExecuted(requestId, msg.sender, to, amount);
    }
}
