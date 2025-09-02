// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ReserveManager
 * @dev Manages collateral and backing assets for the FPAC ecosystem
 * Handles deposits, withdrawals, and collateralization ratios
 */
contract ReserveManager is AccessControl, Pausable, ReentrancyGuard {
    
    using SafeERC20 for IERC20;

    bytes32 public constant RESERVE_MANAGER_ROLE = keccak256("RESERVE_MANAGER_ROLE");
    bytes32 public constant LIQUIDATOR_ROLE = keccak256("LIQUIDATOR_ROLE");

    struct Asset {
        address tokenAddress;
        uint256 balance;
        uint256 weight; // Basis points (10000 = 100%)
        uint256 minReserveRatio; // Minimum reserve ratio in basis points
        bool isActive;
    }

    struct ReserveData {
        uint256 totalValue; // Total USD value of reserves
        uint256 requiredReserves; // Required reserves based on FPAC supply
        uint256 excessReserves; // Excess reserves available
        uint256 collateralizationRatio; // Current collateralization ratio
    }

    mapping(address => Asset) public assets;
    address[] public assetList;
    
    // Reserve requirements
    uint256 public constant MIN_COLLATERAL_RATIO = 15000; // 150%
    uint256 public constant LIQUIDATION_THRESHOLD = 12000; // 120%
    uint256 public constant TARGET_COLLATERAL_RATIO = 20000; // 200%

    // Events
    event AssetAdded(address indexed token, uint256 weight, uint256 minReserveRatio);
    event AssetRemoved(address indexed token);
    event AssetWeightUpdated(address indexed token, uint256 oldWeight, uint256 newWeight);
    event Deposit(address indexed token, uint256 amount, address indexed from);
    event Withdrawal(address indexed token, uint256 amount, address indexed to);
    event RebalanceExecuted(address indexed token, uint256 amount, string action);
    event LiquidationTriggered(uint256 deficitAmount);

    constructor(address admin, address reserveManager) {
        require(admin != address(0), "ReserveManager: invalid admin");
        require(reserveManager != address(0), "ReserveManager: invalid reserve manager");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RESERVE_MANAGER_ROLE, reserveManager);
        _grantRole(LIQUIDATOR_ROLE, admin);
    }

    /**
     * @dev Add a new reserve asset
     */
    function addAsset(
        address tokenAddress,
        uint256 weight,
        uint256 minReserveRatio
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(tokenAddress != address(0), "ReserveManager: invalid token address");
        require(weight > 0 && weight <= 10000, "ReserveManager: invalid weight");
        require(minReserveRatio > 0, "ReserveManager: invalid reserve ratio");
        require(!assets[tokenAddress].isActive, "ReserveManager: asset already exists");

        assets[tokenAddress] = Asset({
            tokenAddress: tokenAddress,
            balance: 0,
            weight: weight,
            minReserveRatio: minReserveRatio,
            isActive: true
        });

        assetList.push(tokenAddress);

        emit AssetAdded(tokenAddress, weight, minReserveRatio);
    }

    /**
     * @dev Remove a reserve asset
     */
    function removeAsset(address tokenAddress) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        require(assets[tokenAddress].isActive, "ReserveManager: asset not active");
        require(assets[tokenAddress].balance == 0, "ReserveManager: asset has balance");

        assets[tokenAddress].isActive = false;

        // Remove from asset list
        for (uint256 i = 0; i < assetList.length; i++) {
            if (assetList[i] == tokenAddress) {
                assetList[i] = assetList[assetList.length - 1];
                assetList.pop();
                break;
            }
        }

        emit AssetRemoved(tokenAddress);
    }

    /**
     * @dev Update asset weight
     */
    function updateAssetWeight(address tokenAddress, uint256 newWeight)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(assets[tokenAddress].isActive, "ReserveManager: asset not active");
        require(newWeight > 0 && newWeight <= 10000, "ReserveManager: invalid weight");

        uint256 oldWeight = assets[tokenAddress].weight;
        assets[tokenAddress].weight = newWeight;

        emit AssetWeightUpdated(tokenAddress, oldWeight, newWeight);
    }

    /**
     * @dev Deposit reserve assets
     */
    function deposit(address tokenAddress, uint256 amount)
        external
        onlyRole(RESERVE_MANAGER_ROLE)
        whenNotPaused
        nonReentrant
    {
        require(assets[tokenAddress].isActive, "ReserveManager: asset not active");
        require(amount > 0, "ReserveManager: invalid amount");

        IERC20 token = IERC20(tokenAddress);
        uint256 balanceBefore = token.balanceOf(address(this));
        
        token.safeTransferFrom(msg.sender, address(this), amount);
        
        uint256 actualAmount = token.balanceOf(address(this)) - (balanceBefore);
        assets[tokenAddress].balance = assets[tokenAddress].balance + (actualAmount);

        emit Deposit(tokenAddress, actualAmount, msg.sender);
    }

    /**
     * @dev Withdraw reserve assets
     */
    function withdraw(address tokenAddress, uint256 amount, address to)
        external
        onlyRole(RESERVE_MANAGER_ROLE)
        whenNotPaused
        nonReentrant
    {
        require(assets[tokenAddress].isActive, "ReserveManager: asset not active");
        require(amount > 0, "ReserveManager: invalid amount");
        require(to != address(0), "ReserveManager: invalid recipient");
        require(assets[tokenAddress].balance >= amount, "ReserveManager: insufficient balance");

        // Check if withdrawal would violate collateral requirements
        require(_canWithdraw(tokenAddress, amount), "ReserveManager: would violate collateral ratio");

        assets[tokenAddress].balance = assets[tokenAddress].balance - (amount);
        IERC20(tokenAddress).safeTransfer(to, amount);

        emit Withdrawal(tokenAddress, amount, to);
    }

    /**
     * @dev Emergency withdrawal (only for admin)
     */
    function emergencyWithdraw(address tokenAddress, uint256 amount, address to)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        require(tokenAddress != address(0), "ReserveManager: invalid token");
        require(amount > 0, "ReserveManager: invalid amount");
        require(to != address(0), "ReserveManager: invalid recipient");

        IERC20 token = IERC20(tokenAddress);
        uint256 balance = token.balanceOf(address(this));
        require(balance >= amount, "ReserveManager: insufficient balance");

        if (assets[tokenAddress].isActive) {
            assets[tokenAddress].balance = assets[tokenAddress].balance >= amount 
                ? assets[tokenAddress].balance - (amount) 
                : 0;
        }

        token.safeTransfer(to, amount);
        emit Withdrawal(tokenAddress, amount, to);
    }

    /**
     * @dev Rebalance reserves to target weights
     */
    function rebalanceReserves() 
        external 
        onlyRole(RESERVE_MANAGER_ROLE) 
        whenNotPaused 
    {
        ReserveData memory reserveData = getReserveData();
        
        for (uint256 i = 0; i < assetList.length; i++) {
            address tokenAddress = assetList[i];
            Asset memory asset = assets[tokenAddress];
            
            if (!asset.isActive) continue;

            uint256 targetValue = reserveData.totalValue * (asset.weight) / (10000);
            uint256 currentValue = _getAssetValue(tokenAddress);

            if (currentValue < targetValue) {
                // Need to acquire more of this asset
                uint256 deficit = targetValue - (currentValue);
                emit RebalanceExecuted(tokenAddress, deficit, "acquire");
            } else if (currentValue > targetValue) {
                // Have excess of this asset
                uint256 excess = currentValue - (targetValue);
                emit RebalanceExecuted(tokenAddress, excess, "reduce");
            }
        }
    }

    /**
     * @dev Get comprehensive reserve data
     */
    function getReserveData() public view returns (ReserveData memory) {
        uint256 totalValue = 0;
        
        for (uint256 i = 0; i < assetList.length; i++) {
            if (assets[assetList[i]].isActive) {
                totalValue = totalValue + (_getAssetValue(assetList[i]));
            }
        }

        // For this example, we'll use a mock FPAC supply
        // In production, this would query the actual FPAC token
        uint256 fpacSupply = 1000000 * 10**18; // Mock: 1M FPAC
        uint256 requiredReserves = fpacSupply * (MIN_COLLATERAL_RATIO) / (10000);
        
        uint256 excessReserves = totalValue > requiredReserves 
            ? totalValue - (requiredReserves) 
            : 0;
            
        uint256 collateralizationRatio = fpacSupply > 0 
            ? totalValue * (10000) / (fpacSupply) 
            : 0;

        return ReserveData({
            totalValue: totalValue,
            requiredReserves: requiredReserves,
            excessReserves: excessReserves,
            collateralizationRatio: collateralizationRatio
        });
    }

    /**
     * @dev Get asset information
     */
    function getAssetInfo(address tokenAddress) 
        external 
        view 
        returns (
            uint256 balance,
            uint256 weight,
            uint256 minReserveRatio,
            uint256 currentValue,
            bool isActive
        ) 
    {
        Asset memory asset = assets[tokenAddress];
        return (
            asset.balance,
            asset.weight,
            asset.minReserveRatio,
            _getAssetValue(tokenAddress),
            asset.isActive
        );
    }

    /**
     * @dev Get all active assets
     */
    function getActiveAssets() external view returns (address[] memory) {
        uint256 activeCount = 0;
        
        // Count active assets
        for (uint256 i = 0; i < assetList.length; i++) {
            if (assets[assetList[i]].isActive) {
                activeCount++;
            }
        }

        // Create array of active assets
        address[] memory activeAssets = new address[](activeCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < assetList.length; i++) {
            if (assets[assetList[i]].isActive) {
                activeAssets[index] = assetList[i];
                index++;
            }
        }

        return activeAssets;
    }

    /**
     * @dev Check if reserves are adequate
     */
    function areReservesAdequate() external view returns (bool) {
        ReserveData memory data = getReserveData();
        return data.collateralizationRatio >= MIN_COLLATERAL_RATIO;
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
    function _getAssetValue(address tokenAddress) internal view returns (uint256) {
        // In a real implementation, this would use price oracles
        // For now, we'll return a mock value based on balance
        Asset memory asset = assets[tokenAddress];
        
        if (!asset.isActive) return 0;
        
        // Mock: assume 1:1 USD value for simplicity
        // In production, integrate with price feeds
        return asset.balance;
    }

    function _canWithdraw(address tokenAddress, uint256 amount) internal view returns (bool) {
        // Calculate what collateralization ratio would be after withdrawal
        uint256 currentValue = _getAssetValue(tokenAddress);
        
        if (currentValue < amount) return false;
        
        uint256 newValue = currentValue - (amount);
        ReserveData memory data = getReserveData();
        uint256 newTotalValue = data.totalValue - (currentValue) + (newValue);
        
        // Mock FPAC supply - in production, query actual supply
        uint256 fpacSupply = 1000000 * 10**18;
        
        if (fpacSupply == 0) return true;
        
        uint256 newRatio = newTotalValue * (10000) / (fpacSupply);
        return newRatio >= MIN_COLLATERAL_RATIO;
    }
}
