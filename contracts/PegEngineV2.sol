// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./FPAC.sol";
import "./OracleHub.sol";

/**
 * @title PegEngineV2
 * @dev Enhanced PegEngine implementing Flexible Average Targeting and NGDP Level Targeting
 * Features path-dependent adjustments to maintain long-term peg trajectory
 */
contract PegEngineV2 is AccessControl, Pausable, ReentrancyGuard {

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public constant MIGRATION_ROLE = keccak256("MIGRATION_ROLE");

    FPAC public immutable fpacToken;
    OracleHub public immutable oracleHub;

    // Targeting Modes
    enum TargetingMode {
        FAIT,     // Standard FAIT targeting
        PLT,      // Price Level Targeting  
        NGDPLT    // Nominal GDP Level Targeting
    }

    // Path Tracking Structures
    struct PathPoint {
        uint256 timestamp;
        uint256 targetValue;
        uint256 actualValue;
        uint256 cumulativeGap; // In basis points, signed (int256 cast)
    }

    // Configuration
    TargetingMode public targetingMode;
    uint256 public genesisTimestamp;
    uint256 public pathUpdateInterval; // Seconds between path updates
    uint256 public targetGrowthRate; // Annual growth rate in basis points
    uint256 public catchupAggressiveness; // Alpha parameter (scaled by 1000)
    uint256 public gapTolerance; // Tolerance for considering gap "closed" in basis points
    
    // Peg parameters (inherited from V1)
    uint256 public targetPrice;
    uint256 public pegTolerance;
    uint256 public minOperationAmount;
    uint256 public maxOperationAmount;
    uint256 public operationCooldown;

    // Path tracking state
    PathPoint[] public pricePath;
    mapping(uint256 => uint256) public actualPriceByPeriod; // period => actual price
    uint256 public currentPeriod;
    int256 public cumulativeGap; // Running total of all gaps in basis points
    bool public isGapClosed; // Flag when cumulative gap is within tolerance

    // Operation tracking (inherited from V1)
    uint256 public lastOperationTimestamp;
    uint256 public totalMinted;
    uint256 public totalBurned;
    uint256 public operationCount;

    // Control parameters
    bool public autoOperationsEnabled;
    uint256 public maxDailyOperations;
    mapping(uint256 => uint256) public dailyOperations;

    // Events
    event PathUpdated(
        uint256 indexed period,
        uint256 targetValue,
        uint256 actualValue,
        int256 cumulativeGap,
        bool gapClosed
    );
    
    event PegMaintenance(
        uint256 indexed operationId,
        string action,
        uint256 amount,
        uint256 currentPrice,
        uint256 targetPrice,
        uint256 deviation,
        uint256 gapRatio,
        uint256 adjustedTarget
    );
    
    event TargetingModeChanged(TargetingMode oldMode, TargetingMode newMode);
    event ParametersUpdated(uint256 targetPrice, uint256 pegTolerance, uint256 catchupAggressiveness);
    event PathParametersUpdated(uint256 growthRate, uint256 updateInterval, uint256 gapTolerance);
    event AutoOperationsToggled(bool enabled);
    event EmergencyIntervention(string action, uint256 amount, string reason);

    constructor(
        address admin,
        address operator,
        address fpacAddress,
        address oracleHubAddress,
        uint256 initialTargetPrice,
        TargetingMode initialMode,
        uint256 annualGrowthRate // in basis points, e.g., 200 = 2%
    ) {
        require(admin != address(0), "PegEngineV2: invalid admin");
        require(operator != address(0), "PegEngineV2: invalid operator");
        require(fpacAddress != address(0), "PegEngineV2: invalid FPAC address");
        require(oracleHubAddress != address(0), "PegEngineV2: invalid oracle address");
        require(initialTargetPrice > 0, "PegEngineV2: invalid target price");
        require(annualGrowthRate <= 1000, "PegEngineV2: growth rate too high"); // Max 10%

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, operator);
        _grantRole(EMERGENCY_ROLE, admin);
        _grantRole(MIGRATION_ROLE, admin);

        fpacToken = FPAC(fpacAddress);
        oracleHub = OracleHub(oracleHubAddress);

        // Initialize parameters
        targetPrice = initialTargetPrice;
        pegTolerance = 100; // 1%
        minOperationAmount = 1000 * 10**18;
        maxOperationAmount = 100000 * 10**18;
        operationCooldown = 300; // 5 minutes
        maxDailyOperations = 48;
        autoOperationsEnabled = true;

        // Initialize level targeting parameters
        targetingMode = initialMode;
        genesisTimestamp = block.timestamp;
        pathUpdateInterval = 86400; // Daily updates
        targetGrowthRate = annualGrowthRate;
        catchupAggressiveness = 500; // 0.5 (scaled by 1000)
        gapTolerance = 10; // 0.1%
        currentPeriod = 0;
        cumulativeGap = 0;
        isGapClosed = true;

        // Initialize first path point
        pricePath.push(PathPoint({
            timestamp: block.timestamp,
            targetValue: initialTargetPrice,
            actualValue: initialTargetPrice,
            cumulativeGap: 0
        }));
    }

    /**
     * @dev Enhanced peg maintenance with level targeting
     */
    function maintainPeg() external onlyRole(OPERATOR_ROLE) whenNotPaused nonReentrant {
        require(autoOperationsEnabled, "PegEngineV2: auto operations disabled");
        require(_canOperate(), "PegEngineV2: operation conditions not met");

        // Update path if needed
        _updatePathIfNeeded();

        // Get current price data
        (uint256 currentPrice, bool isValid) = _getCurrentPrice();
        require(isValid, "PegEngineV2: invalid price data");

        // Calculate target price with path adjustment
        uint256 adjustedTarget = _calculateAdjustedTarget(currentPrice);
        
        // Calculate deviation from adjusted target
        uint256 deviation = _calculateDeviation(currentPrice, adjustedTarget);
        
        if (deviation <= pegTolerance) {
            return; // Peg is maintained, no action needed
        }

        uint256 operationAmount = _calculateOperationAmount(deviation);
        uint256 gapRatio = _calculateGapRatio();
        
        if (currentPrice > adjustedTarget) {
            // Price too high, mint tokens to increase supply
            _executeMint(operationAmount, currentPrice, adjustedTarget, deviation, gapRatio);
        } else {
            // Price too low, burn tokens to decrease supply
            _executeBurn(operationAmount, currentPrice, adjustedTarget, deviation, gapRatio);
        }

        _updateOperationTracking();
    }

    /**
     * @dev Manual path update (for testing or emergency use)
     */
    function updatePath() external onlyRole(OPERATOR_ROLE) whenNotPaused {
        _updatePathIfNeeded();
    }

    /**
     * @dev Set targeting mode
     */
    function setTargetingMode(TargetingMode newMode) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        TargetingMode oldMode = targetingMode;
        targetingMode = newMode;
        emit TargetingModeChanged(oldMode, newMode);
    }

    /**
     * @dev Update level targeting parameters
     */
    function updatePathParameters(
        uint256 newGrowthRate,
        uint256 newUpdateInterval,
        uint256 newGapTolerance,
        uint256 newCatchupAggressiveness
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newGrowthRate <= 1000, "PegEngineV2: growth rate too high"); // Max 10%
        require(newUpdateInterval >= 3600, "PegEngineV2: update interval too short"); // Min 1 hour
        require(newGapTolerance <= 1000, "PegEngineV2: gap tolerance too high"); // Max 10%
        require(newCatchupAggressiveness <= 2000, "PegEngineV2: aggressiveness too high"); // Max 2.0

        targetGrowthRate = newGrowthRate;
        pathUpdateInterval = newUpdateInterval;
        gapTolerance = newGapTolerance;
        catchupAggressiveness = newCatchupAggressiveness;

        emit PathParametersUpdated(newGrowthRate, newUpdateInterval, newGapTolerance);
    }

    /**
     * @dev Update standard peg parameters
     */
    function updateParameters(
        uint256 newTargetPrice,
        uint256 newPegTolerance,
        uint256 newMinOperationAmount,
        uint256 newMaxOperationAmount,
        uint256 newOperationCooldown
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newTargetPrice > 0, "PegEngineV2: invalid target price");
        require(newPegTolerance <= 1000, "PegEngineV2: tolerance too high");
        require(newMinOperationAmount > 0, "PegEngineV2: invalid min amount");
        require(newMaxOperationAmount >= newMinOperationAmount, "PegEngineV2: invalid max amount");
        require(newOperationCooldown >= 60, "PegEngineV2: cooldown too short");

        targetPrice = newTargetPrice;
        pegTolerance = newPegTolerance;
        minOperationAmount = newMinOperationAmount;
        maxOperationAmount = newMaxOperationAmount;
        operationCooldown = newOperationCooldown;

        // Note: FPAC target price update removed to avoid permission issues
        // The adjusted target calculation handles path-dependent targeting

        emit ParametersUpdated(newTargetPrice, newPegTolerance, catchupAggressiveness);
    }

    /**
     * @dev Migration function to import state from PegEngineV1
     */
    function migrateFromV1(
        uint256 v1TotalMinted,
        uint256 v1TotalBurned,
        uint256 v1OperationCount,
        uint256 v1LastOperationTimestamp
    ) external onlyRole(MIGRATION_ROLE) {
        totalMinted = v1TotalMinted;
        totalBurned = v1TotalBurned;
        operationCount = v1OperationCount;
        lastOperationTimestamp = v1LastOperationTimestamp;
    }

    /**
     * @dev Manual emergency intervention
     */
    function manualIntervention(
        string calldata action,
        uint256 amount,
        string calldata reason
    ) external onlyRole(EMERGENCY_ROLE) nonReentrant {
        require(bytes(action).length > 0, "PegEngineV2: invalid action");
        require(amount > 0, "PegEngineV2: invalid amount");
        require(bytes(reason).length > 0, "PegEngineV2: reason required");

        if (keccak256(bytes(action)) == keccak256(bytes("mint"))) {
            fpacToken.mint(address(this), amount);
            totalMinted = totalMinted + amount;
        } else if (keccak256(bytes(action)) == keccak256(bytes("burn"))) {
            fpacToken.burnFrom(address(this), amount);
            totalBurned = totalBurned + amount;
        } else {
            revert("PegEngineV2: invalid action type");
        }

        emit EmergencyIntervention(action, amount, reason);
    }

    /**
     * @dev Toggle automatic operations
     */
    function toggleAutoOperations(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        autoOperationsEnabled = enabled;
        emit AutoOperationsToggled(enabled);
    }

    /**
     * @dev Get enhanced peg status with path information
     */
    function getPegStatus() external view returns (
        uint256 currentPrice,
        uint256 currentTargetPrice,
        uint256 adjustedTargetPrice,
        uint256 deviation,
        bool pegMaintained,
        bool canOperate,
        int256 currentGap,
        bool gapClosed,
        uint256 gapRatio
    ) {
        bool isValid;
        (currentPrice, isValid) = _getCurrentPrice();
        currentTargetPrice = targetPrice;
        adjustedTargetPrice = isValid ? _calculateAdjustedTarget(currentPrice) : targetPrice;
        
        if (isValid) {
            deviation = _calculateDeviation(currentPrice, adjustedTargetPrice);
            pegMaintained = deviation <= pegTolerance;
        }
        
        canOperate = _canOperate() && isValid && autoOperationsEnabled;
        currentGap = cumulativeGap;
        gapClosed = isGapClosed;
        gapRatio = _calculateGapRatio();
    }

    /**
     * @dev Get path information for a specific period
     */
    function getPathPoint(uint256 period) external view returns (
        uint256 timestamp,
        uint256 targetValue,
        uint256 actualValue,
        uint256 gap
    ) {
        require(period < pricePath.length, "PegEngineV2: invalid period");
        PathPoint memory point = pricePath[period];
        return (point.timestamp, point.targetValue, point.actualValue, uint256(point.cumulativeGap));
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
     * @dev Get current path statistics
     */
    function getPathStats() external view returns (
        uint256 totalPeriods,
        uint256 currentPeriodNumber,
        int256 totalGap,
        bool gapClosedStatus,
        TargetingMode mode
    ) {
        return (
            pricePath.length,
            currentPeriod,
            cumulativeGap,
            isGapClosed,
            targetingMode
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

    // Internal Functions

    function _updatePathIfNeeded() internal {
        uint256 timeSinceLastUpdate = block.timestamp - pricePath[pricePath.length - 1].timestamp;
        
        if (timeSinceLastUpdate >= pathUpdateInterval) {
            uint256 periodsToAdd = timeSinceLastUpdate / pathUpdateInterval;
            
            for (uint256 i = 0; i < periodsToAdd; i++) {
                _addPathPoint();
            }
        }
    }

    function _addPathPoint() internal {
        PathPoint memory lastPoint = pricePath[pricePath.length - 1];
        
        // Calculate new target value based on growth rate
        uint256 newTargetValue = _calculateTargetValueForPeriod(currentPeriod + 1);
        
        // Get actual current price
        (uint256 actualPrice, bool isValid) = _getCurrentPrice();
        if (!isValid) {
            actualPrice = lastPoint.actualValue; // Use last known value if invalid
        }
        
        // Calculate period gap
        int256 periodGap = _calculatePeriodGap(newTargetValue, actualPrice);
        
        // Update cumulative gap
        cumulativeGap += periodGap;
        
        // Check if gap is closed
        isGapClosed = _abs(cumulativeGap) <= int256(gapTolerance);
        
        // Add new path point
        pricePath.push(PathPoint({
            timestamp: lastPoint.timestamp + pathUpdateInterval,
            targetValue: newTargetValue,
            actualValue: actualPrice,
            cumulativeGap: uint256(cumulativeGap)
        }));
        
        currentPeriod++;
        
        emit PathUpdated(currentPeriod, newTargetValue, actualPrice, cumulativeGap, isGapClosed);
    }

    function _calculateTargetValueForPeriod(uint256 period) internal view returns (uint256) {
        PathPoint memory genesis = pricePath[0];
        
        // Calculate compound growth: target = genesis * (1 + rate)^(periods)
        // For daily updates with annual rate, daily rate = annual_rate / 365
        uint256 periodsPerYear = 365 * 86400 / pathUpdateInterval;
        uint256 dailyRateBps = targetGrowthRate / periodsPerYear; // Daily rate in basis points
        
        // Simple compound interest: (1 + rate)^periods ≈ 1 + rate*periods for small rates
        // target = genesis * (10000 + dailyRate * period) / 10000
        return genesis.targetValue * (10000 + dailyRateBps * period) / 10000;
    }

    function _calculatePeriodGap(uint256 targetValue, uint256 actualValue) internal pure returns (int256) {
        if (targetValue == 0) return 0;
        
        int256 diff = int256(actualValue) - int256(targetValue);
        return diff * 10000 / int256(targetValue); // Return in basis points
    }

    function _calculateAdjustedTarget(uint256 /* currentPrice */) internal view returns (uint256) {
        if (isGapClosed || cumulativeGap == 0) {
            return targetPrice;
        }
        
        // Calculate gap ratio and apply gap adjustment
        uint256 gapRatio = _calculateGapRatio();
        
        // Apply gap adjustment: peg_adjusted = peg_current * (gap_ratio ^ alpha)
        uint256 adjustmentFactor = _power(gapRatio, catchupAggressiveness, 1000);
        
        return targetPrice * adjustmentFactor / 1000;
    }

    function _calculateGapRatio() internal view returns (uint256) {
        if (pricePath.length == 0) return 1000; // 1.0 scaled by 1000
        
        PathPoint memory currentPath = pricePath[pricePath.length - 1];
        
        if (currentPath.actualValue == 0) return 1000;
        
        // Gap ratio = target / actual
        // If actual < target (undershoot), ratio > 1.0 (need to catch up)
        // If actual > target (overshoot), ratio < 1.0 (need to slow down)
        return currentPath.targetValue * 1000 / currentPath.actualValue;
    }

    function _getCurrentPrice() internal view returns (uint256 price, bool isValid) {
        string memory feedName = targetingMode == TargetingMode.NGDPLT ? "NGDP_USD" : "FAIT_USD";
        (price, , , isValid) = oracleHub.getLatestData(feedName);
    }

    function _calculateDeviation(uint256 current, uint256 target) internal pure returns (uint256) {
        if (target == 0) return 0;
        
        uint256 diff = current > target ? current - target : target - current;
        return diff * 10000 / target; // Return in basis points
    }

    function _calculateOperationAmount(uint256 deviation) internal view returns (uint256) {
        uint256 scaleFactor = deviation > pegTolerance ? deviation - pegTolerance : 0;
        uint256 amount = minOperationAmount + (
            scaleFactor * (maxOperationAmount - minOperationAmount) / 1000
        );
        
        return amount > maxOperationAmount ? maxOperationAmount : amount;
    }

    function _executeMint(
        uint256 amount, 
        uint256 currentPrice, 
        uint256 adjustedTarget, 
        uint256 deviation,
        uint256 gapRatio
    ) internal {
        fpacToken.mint(address(this), amount);
        totalMinted = totalMinted + amount;
        operationCount = operationCount + 1;
        
        emit PegMaintenance(
            operationCount,
            "mint",
            amount,
            currentPrice,
            adjustedTarget,
            deviation,
            gapRatio,
            adjustedTarget
        );
    }

    function _executeBurn(
        uint256 amount, 
        uint256 currentPrice, 
        uint256 adjustedTarget, 
        uint256 deviation,
        uint256 gapRatio
    ) internal {
        uint256 balance = fpacToken.balanceOf(address(this));
        if (balance < amount) {
            amount = balance;
        }
        
        if (amount > 0) {
            fpacToken.burn(amount);
            totalBurned = totalBurned + amount;
        }
        
        operationCount = operationCount + 1;
        
        emit PegMaintenance(
            operationCount,
            "burn",
            amount,
            currentPrice,
            adjustedTarget,
            deviation,
            gapRatio,
            adjustedTarget
        );
    }

    function _canOperate() internal view returns (bool) {
        if (block.timestamp < lastOperationTimestamp + operationCooldown) {
            return false;
        }
        
        uint256 today = _getCurrentDay();
        if (dailyOperations[today] >= maxDailyOperations) {
            return false;
        }
        
        return true;
    }

    function _updateOperationTracking() internal {
        lastOperationTimestamp = block.timestamp;
        uint256 today = _getCurrentDay();
        dailyOperations[today] = dailyOperations[today] + 1;
    }

    function _getCurrentDay() internal view returns (uint256) {
        return block.timestamp / 86400;
    }

    function _abs(int256 x) internal pure returns (int256) {
        return x >= 0 ? x : -x;
    }

    function _power(uint256 base, uint256 exp, uint256 scale) internal pure returns (uint256) {
        // Simple power function for small exponents
        // base and result scaled by 'scale'
        if (exp == 0) return scale;
        if (exp == scale) return base; // exp = 1.0
        
        // For fractional exponents, use approximation
        // (base)^(exp/scale) ≈ 1 + (exp/scale) * (base - 1)
        if (base >= scale) {
            uint256 excess = base - scale;
            return scale + (excess * exp / scale);
        } else {
            uint256 deficit = scale - base;
            return scale - (deficit * exp / scale);
        }
    }
}
