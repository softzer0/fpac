// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Treasury
 * @dev Manages protocol funds, revenue distribution, and treasury operations
 * Handles fee collection, reward distribution, and protocol sustainability
 */
contract Treasury is AccessControl, Pausable, ReentrancyGuard {
    
    using SafeERC20 for IERC20;

    bytes32 public constant TREASURY_MANAGER_ROLE = keccak256("TREASURY_MANAGER_ROLE");
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    struct RevenueStream {
        string name;
        address source; // Contract that generates revenue
        uint256 totalCollected;
        uint256 lastCollection;
        bool isActive;
    }

    struct Distribution {
        address recipient;
        uint256 percentage; // Basis points (10000 = 100%)
        string purpose;
        bool isActive;
    }

    // Revenue tracking
    mapping(bytes32 => RevenueStream) public revenueStreams;
    bytes32[] public revenueStreamIds;

    // Distribution configuration
    Distribution[] public distributions;
    uint256 public totalDistributionPercentage;

    // Asset management
    mapping(address => uint256) public treasuryBalances;
    address[] public managedAssets;

    // Revenue allocation
    uint256 public constant RESERVE_PERCENTAGE = 2000; // 20% to reserves
    uint256 public constant DEVELOPMENT_PERCENTAGE = 1500; // 15% to development
    uint256 public constant GOVERNANCE_PERCENTAGE = 500; // 5% to governance rewards
    uint256 public constant OPERATIONAL_PERCENTAGE = 6000; // 60% to operations

    // Events
    event RevenueCollected(bytes32 indexed streamId, address indexed token, uint256 amount);
    event FundsDistributed(address indexed recipient, address indexed token, uint256 amount, string purpose);
    event RevenueStreamAdded(bytes32 indexed streamId, string name, address source);
    event RevenueStreamUpdated(bytes32 indexed streamId, bool isActive);
    event DistributionAdded(address indexed recipient, uint256 percentage, string purpose);
    event DistributionUpdated(uint256 indexed index, address recipient, uint256 percentage, bool isActive);
    event EmergencyWithdrawal(address indexed token, uint256 amount, address indexed to, string reason);

    constructor(
        address admin,
        address treasuryManager
    ) {
        require(admin != address(0), "Treasury: invalid admin");
        require(treasuryManager != address(0), "Treasury: invalid treasury manager");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(TREASURY_MANAGER_ROLE, treasuryManager);
        _grantRole(DISTRIBUTOR_ROLE, treasuryManager);
        _grantRole(EMERGENCY_ROLE, admin);

        // Initialize default distributions
        _addDistribution(admin, RESERVE_PERCENTAGE, "Protocol Reserves");
        _addDistribution(admin, DEVELOPMENT_PERCENTAGE, "Development Fund");
        _addDistribution(admin, GOVERNANCE_PERCENTAGE, "Governance Rewards");
        _addDistribution(admin, OPERATIONAL_PERCENTAGE, "Operational Expenses");
    }

    /**
     * @dev Add a new revenue stream
     */
    function addRevenueStream(
        string calldata name,
        address source
    ) external onlyRole(TREASURY_MANAGER_ROLE) {
        require(bytes(name).length > 0, "Treasury: invalid name");
        require(source != address(0), "Treasury: invalid source");

        bytes32 streamId = keccak256(abi.encodePacked(name, source, block.timestamp));
        
        revenueStreams[streamId] = RevenueStream({
            name: name,
            source: source,
            totalCollected: 0,
            lastCollection: block.timestamp,
            isActive: true
        });

        revenueStreamIds.push(streamId);

        emit RevenueStreamAdded(streamId, name, source);
    }

    /**
     * @dev Update revenue stream status
     */
    function updateRevenueStream(bytes32 streamId, bool isActive)
        external
        onlyRole(TREASURY_MANAGER_ROLE)
    {
        require(revenueStreams[streamId].source != address(0), "Treasury: stream does not exist");
        
        revenueStreams[streamId].isActive = isActive;
        
        emit RevenueStreamUpdated(streamId, isActive);
    }

    /**
     * @dev Collect revenue from a source
     */
    function collectRevenue(
        bytes32 streamId,
        address token,
        uint256 amount
    ) external onlyRole(DISTRIBUTOR_ROLE) whenNotPaused nonReentrant {
        require(revenueStreams[streamId].isActive, "Treasury: stream not active");
        require(token != address(0), "Treasury: invalid token");
        require(amount > 0, "Treasury: invalid amount");

        RevenueStream storage stream = revenueStreams[streamId];
        
        // Transfer tokens to treasury
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        
        // Update tracking
        stream.totalCollected = stream.totalCollected + (amount);
        stream.lastCollection = block.timestamp;
        
        _updateTreasuryBalance(token, amount);

        emit RevenueCollected(streamId, token, amount);
        
        // Auto-distribute if configured
        _distributeRevenue(token, amount);
    }

    /**
     * @dev Manually distribute funds
     */
    function distributeFunds(
        address token,
        address recipient,
        uint256 amount,
        string calldata purpose
    ) external onlyRole(DISTRIBUTOR_ROLE) whenNotPaused nonReentrant {
        require(token != address(0), "Treasury: invalid token");
        require(recipient != address(0), "Treasury: invalid recipient");
        require(amount > 0, "Treasury: invalid amount");
        require(treasuryBalances[token] >= amount, "Treasury: insufficient balance");

        treasuryBalances[token] = treasuryBalances[token] - (amount);
        IERC20(token).safeTransfer(recipient, amount);

        emit FundsDistributed(recipient, token, amount, purpose);
    }

    /**
     * @dev Add distribution recipient
     */
    function addDistribution(
        address recipient,
        uint256 percentage,
        string calldata purpose
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _addDistribution(recipient, percentage, purpose);
    }

    /**
     * @dev Update distribution
     */
    function updateDistribution(
        uint256 index,
        address recipient,
        uint256 percentage,
        bool isActive
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(index < distributions.length, "Treasury: invalid index");
        require(recipient != address(0), "Treasury: invalid recipient");

        Distribution storage dist = distributions[index];
        
        // Update total percentage
        if (dist.isActive && !isActive) {
            totalDistributionPercentage = totalDistributionPercentage - (dist.percentage);
        } else if (!dist.isActive && isActive) {
            totalDistributionPercentage = totalDistributionPercentage + (percentage);
        } else if (isActive) {
            totalDistributionPercentage = totalDistributionPercentage - (dist.percentage) + (percentage);
        }

        require(totalDistributionPercentage <= 10000, "Treasury: total percentage exceeds 100%");

        dist.recipient = recipient;
        dist.percentage = percentage;
        dist.isActive = isActive;

        emit DistributionUpdated(index, recipient, percentage, isActive);
    }

    /**
     * @dev Emergency withdrawal
     */
    function emergencyWithdraw(
        address token,
        uint256 amount,
        address to,
        string calldata reason
    ) external onlyRole(EMERGENCY_ROLE) nonReentrant {
        require(token != address(0), "Treasury: invalid token");
        require(to != address(0), "Treasury: invalid recipient");
        require(amount > 0, "Treasury: invalid amount");
        require(bytes(reason).length > 0, "Treasury: reason required");

        IERC20 tokenContract = IERC20(token);
        uint256 balance = tokenContract.balanceOf(address(this));
        require(balance >= amount, "Treasury: insufficient balance");

        if (treasuryBalances[token] >= amount) {
            treasuryBalances[token] = treasuryBalances[token] - (amount);
        } else {
            treasuryBalances[token] = 0;
        }

        tokenContract.safeTransfer(to, amount);

        emit EmergencyWithdrawal(token, amount, to, reason);
    }

    /**
     * @dev Get treasury balance for a token
     */
    function getTreasuryBalance(address token) external view returns (uint256) {
        return treasuryBalances[token];
    }

    /**
     * @dev Get all managed assets
     */
    function getManagedAssets() external view returns (address[] memory) {
        return managedAssets;
    }

    /**
     * @dev Get revenue stream information
     */
    function getRevenueStream(bytes32 streamId)
        external
        view
        returns (
            string memory name,
            address source,
            uint256 totalCollected,
            uint256 lastCollection,
            bool isActive
        )
    {
        RevenueStream memory stream = revenueStreams[streamId];
        return (
            stream.name,
            stream.source,
            stream.totalCollected,
            stream.lastCollection,
            stream.isActive
        );
    }

    /**
     * @dev Get all revenue stream IDs
     */
    function getRevenueStreamIds() external view returns (bytes32[] memory) {
        return revenueStreamIds;
    }

    /**
     * @dev Get distribution information
     */
    function getDistribution(uint256 index)
        external
        view
        returns (
            address recipient,
            uint256 percentage,
            string memory purpose,
            bool isActive
        )
    {
        require(index < distributions.length, "Treasury: invalid index");
        Distribution memory dist = distributions[index];
        return (dist.recipient, dist.percentage, dist.purpose, dist.isActive);
    }

    /**
     * @dev Get total number of distributions
     */
    function getDistributionCount() external view returns (uint256) {
        return distributions.length;
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
    function _addDistribution(
        address recipient,
        uint256 percentage,
        string memory purpose
    ) internal {
        require(recipient != address(0), "Treasury: invalid recipient");
        require(percentage > 0, "Treasury: invalid percentage");
        require(totalDistributionPercentage + (percentage) <= 10000, "Treasury: total percentage exceeds 100%");

        distributions.push(Distribution({
            recipient: recipient,
            percentage: percentage,
            purpose: purpose,
            isActive: true
        }));

        totalDistributionPercentage = totalDistributionPercentage + (percentage);

        emit DistributionAdded(recipient, percentage, purpose);
    }

    function _distributeRevenue(address token, uint256 amount) internal {
        for (uint256 i = 0; i < distributions.length; i++) {
            Distribution memory dist = distributions[i];
            
            if (!dist.isActive) continue;

            uint256 distributionAmount = amount * (dist.percentage) / (10000);
            
            if (distributionAmount > 0 && treasuryBalances[token] >= distributionAmount) {
                treasuryBalances[token] = treasuryBalances[token] - (distributionAmount);
                IERC20(token).safeTransfer(dist.recipient, distributionAmount);
                
                emit FundsDistributed(dist.recipient, token, distributionAmount, dist.purpose);
            }
        }
    }

    function _updateTreasuryBalance(address token, uint256 amount) internal {
        if (treasuryBalances[token] == 0) {
            // First time seeing this token, add to managed assets
            managedAssets.push(token);
        }
        
        treasuryBalances[token] = treasuryBalances[token] + (amount);
    }
}
