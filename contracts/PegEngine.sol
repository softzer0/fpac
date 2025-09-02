// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./FPAC.sol";
import "./OracleHub.sol";

/**
 * @title PegEngine
 * @dev Core contract responsible for maintaining FPAC peg to FAIT
 * Implements algorithmic monetary policy through automated mint/burn operations
 */
contract PegEngine is AccessControl, Pausable, ReentrancyGuard {

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    FPAC public immutable fpacToken;
    OracleHub public immutable oracleHub;

    // Peg parameters
    uint256 public targetPrice; // Target price in wei (18 decimals)
    uint256 public pegTolerance; // Allowed deviation in basis points (100 = 1%)
    uint256 public minOperationAmount; // Minimum mint/burn amount
    uint256 public maxOperationAmount; // Maximum mint/burn amount per operation
    uint256 public operationCooldown; // Cooldown between operations in seconds

    // Operation tracking
    uint256 public lastOperationTimestamp;
    uint256 public totalMinted;
    uint256 public totalBurned;
    uint256 public operationCount;

    // Control parameters
    bool public autoOperationsEnabled;
    uint256 public maxDailyOperations;
    mapping(uint256 => uint256) public dailyOperations; // day => count

    // Events
    event PegMaintenance(
        uint256 indexed operationId,
        string action, // "mint" or "burn"
        uint256 amount,
        uint256 currentPrice,
        uint256 targetPrice,
        uint256 deviation
    );
    
    event ParametersUpdated(
        uint256 targetPrice,
        uint256 pegTolerance,
        uint256 minOperationAmount,
        uint256 maxOperationAmount,
        uint256 operationCooldown
    );
    
    event AutoOperationsToggled(bool enabled);
    event EmergencyIntervention(string action, uint256 amount, string reason);

    constructor(
        address admin,
        address operator,
        address fpacAddress,
        address oracleHubAddress,
        uint256 initialTargetPrice
    ) {
        require(admin != address(0), "PegEngine: invalid admin");
        require(operator != address(0), "PegEngine: invalid operator");
        require(fpacAddress != address(0), "PegEngine: invalid FPAC address");
        require(oracleHubAddress != address(0), "PegEngine: invalid oracle address");
        require(initialTargetPrice > 0, "PegEngine: invalid target price");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, operator);
        _grantRole(EMERGENCY_ROLE, admin);

        fpacToken = FPAC(fpacAddress);
        oracleHub = OracleHub(oracleHubAddress);

        // Initialize parameters
        targetPrice = initialTargetPrice;
        pegTolerance = 100; // 1%
        minOperationAmount = 1000 * 10**18; // 1,000 FPAC
        maxOperationAmount = 100000 * 10**18; // 100,000 FPAC
        operationCooldown = 300; // 5 minutes
        maxDailyOperations = 48; // Max 48 operations per day (every 30 minutes)
        autoOperationsEnabled = true;
    }

    /**
     * @dev Check and execute peg maintenance if needed
     */
    function maintainPeg() external onlyRole(OPERATOR_ROLE) whenNotPaused nonReentrant {
        require(autoOperationsEnabled, "PegEngine: auto operations disabled");
        require(_canOperate(), "PegEngine: operation conditions not met");

        (uint256 currentPrice, bool isValid) = _getCurrentPrice();
        require(isValid, "PegEngine: invalid price data");

        uint256 deviation = _calculateDeviation(currentPrice, targetPrice);
        
        if (deviation <= pegTolerance) {
            return; // Peg is maintained, no action needed
        }

        uint256 operationAmount = _calculateOperationAmount(deviation);
        
        if (currentPrice > targetPrice) {
            // Price too high, mint tokens to increase supply
            _executeMint(operationAmount, currentPrice, deviation);
        } else {
            // Price too low, burn tokens to decrease supply
            _executeBurn(operationAmount, currentPrice, deviation);
        }

        _updateOperationTracking();
    }

    /**
     * @dev Manual peg intervention (emergency use)
     */
    function manualIntervention(
        string calldata action,
        uint256 amount,
        string calldata reason
    ) external onlyRole(EMERGENCY_ROLE) nonReentrant {
        require(bytes(action).length > 0, "PegEngine: invalid action");
        require(amount > 0, "PegEngine: invalid amount");
        require(bytes(reason).length > 0, "PegEngine: reason required");

        if (keccak256(bytes(action)) == keccak256(bytes("mint"))) {
            fpacToken.mint(address(this), amount);
            totalMinted = totalMinted + (amount);
        } else if (keccak256(bytes(action)) == keccak256(bytes("burn"))) {
            fpacToken.burnFrom(address(this), amount);
            totalBurned = totalBurned + (amount);
        } else {
            revert("PegEngine: invalid action type");
        }

        emit EmergencyIntervention(action, amount, reason);
    }

    /**
     * @dev Update peg parameters
     */
    function updateParameters(
        uint256 newTargetPrice,
        uint256 newPegTolerance,
        uint256 newMinOperationAmount,
        uint256 newMaxOperationAmount,
        uint256 newOperationCooldown
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newTargetPrice > 0, "PegEngine: invalid target price");
        require(newPegTolerance <= 1000, "PegEngine: tolerance too high"); // Max 10%
        require(newMinOperationAmount > 0, "PegEngine: invalid min amount");
        require(newMaxOperationAmount >= newMinOperationAmount, "PegEngine: invalid max amount");
        require(newOperationCooldown >= 60, "PegEngine: cooldown too short"); // Min 1 minute

        targetPrice = newTargetPrice;
        pegTolerance = newPegTolerance;
        minOperationAmount = newMinOperationAmount;
        maxOperationAmount = newMaxOperationAmount;
        operationCooldown = newOperationCooldown;

        // Update FPAC target price
        fpacToken.updatePegParameters(newTargetPrice, newPegTolerance);

        emit ParametersUpdated(
            newTargetPrice,
            newPegTolerance,
            newMinOperationAmount,
            newMaxOperationAmount,
            newOperationCooldown
        );
    }

    /**
     * @dev Toggle automatic operations
     */
    function toggleAutoOperations(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        autoOperationsEnabled = enabled;
        emit AutoOperationsToggled(enabled);
    }

    /**
     * @dev Get current peg status
     */
    function getPegStatus() external view returns (
        uint256 currentPrice,
        uint256 currentTargetPrice,
        uint256 deviation,
        bool pegMaintained,
        bool canOperate
    ) {
        bool isValid;
        (currentPrice, isValid) = _getCurrentPrice();
        currentTargetPrice = targetPrice;
        
        if (isValid) {
            deviation = _calculateDeviation(currentPrice, targetPrice);
            pegMaintained = deviation <= pegTolerance;
        }
        
        canOperate = _canOperate() && isValid && autoOperationsEnabled;
    }

    /**
     * @dev Get operation statistics
     */
    function getOperationStats() external view returns (
        uint256 total,
        uint256 minted,
        uint256 burned,
        uint256 lastOperation,
        uint256 dailyOps
    ) {
        return (
            operationCount,
            totalMinted,
            totalBurned,
            lastOperationTimestamp,
            dailyOperations[_getCurrentDay()]
        );
    }

    /**
     * @dev Pause contract
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause contract
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // Internal functions
    function _getCurrentPrice() internal view returns (uint256 price, bool isValid) {
        (price, , , isValid) = oracleHub.getLatestData("FAIT_USD");
    }

    function _calculateDeviation(uint256 current, uint256 target) internal pure returns (uint256) {
        if (target == 0) return 0;
        
        uint256 diff = current > target ? current - (target) : target - (current);
        return diff * (10000) / (target); // Return in basis points
    }

    function _calculateOperationAmount(uint256 deviation) internal view returns (uint256) {
        // Simple linear scaling based on deviation
        uint256 scaleFactor = deviation > pegTolerance ? deviation - (pegTolerance) : 0;
        uint256 amount = minOperationAmount + (
            scaleFactor * (maxOperationAmount - (minOperationAmount)) / (1000)
        );
        
        return amount > maxOperationAmount ? maxOperationAmount : amount;
    }

    function _executeMint(uint256 amount, uint256 currentPrice, uint256 deviation) internal {
        fpacToken.mint(address(this), amount);
        totalMinted = totalMinted + (amount);
        
        operationCount = operationCount + (1);
        
        emit PegMaintenance(
            operationCount,
            "mint",
            amount,
            currentPrice,
            targetPrice,
            deviation
        );
    }

    function _executeBurn(uint256 amount, uint256 currentPrice, uint256 deviation) internal {
        // Ensure we have enough tokens to burn
        uint256 balance = fpacToken.balanceOf(address(this));
        if (balance < amount) {
            amount = balance;
        }
        
        if (amount > 0) {
            fpacToken.burn(amount);
            totalBurned = totalBurned + (amount);
        }
        
        operationCount = operationCount + (1);
        
        emit PegMaintenance(
            operationCount,
            "burn",
            amount,
            currentPrice,
            targetPrice,
            deviation
        );
    }

    function _canOperate() internal view returns (bool) {
        // Check cooldown
        if (block.timestamp < lastOperationTimestamp + (operationCooldown)) {
            return false;
        }
        
        // Check daily limit
        uint256 today = _getCurrentDay();
        if (dailyOperations[today] >= maxDailyOperations) {
            return false;
        }
        
        return true;
    }

    function _updateOperationTracking() internal {
        lastOperationTimestamp = block.timestamp;
        uint256 today = _getCurrentDay();
        dailyOperations[today] = dailyOperations[today] + (1);
    }

    function _getCurrentDay() internal view returns (uint256) {
        return block.timestamp / 86400; // Seconds in a day
    }
}
