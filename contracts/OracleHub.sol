// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title OracleHub
 * @dev Manages multiple oracle feeds for economic data
 * Aggregates data from various sources with consensus mechanisms
 */
contract OracleHub is AccessControl, Pausable, ReentrancyGuard {

    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant ORACLE_MANAGER_ROLE = keccak256("ORACLE_MANAGER_ROLE");

    struct OracleData {
        uint256 value;
        uint256 timestamp;
        uint256 confidence; // 0-100 scale
        bool isActive;
    }

    struct AggregatedData {
        uint256 value;
        uint256 timestamp;
        uint256 confidence;
        uint256 sourceCount;
    }

    // Data feeds
    mapping(string => mapping(address => OracleData)) public oracleFeeds;
    mapping(string => address[]) public activeSources;
    mapping(string => AggregatedData) public aggregatedData;
    
    // Configuration
    uint256 public constant MAX_STALENESS = 3600; // 1 hour
    uint256 public constant MIN_CONFIDENCE = 70; // 70%
    uint256 public constant MIN_SOURCES = 2;
    uint256 public constant MAX_DEVIATION = 500; // 5% in basis points

    // Events
    event DataUpdated(
        string indexed feedName,
        address indexed oracle,
        uint256 value,
        uint256 confidence,
        uint256 timestamp
    );
    
    event AggregatedDataUpdated(
        string indexed feedName,
        uint256 value,
        uint256 confidence,
        uint256 sourceCount,
        uint256 timestamp
    );
    
    event OracleAdded(string indexed feedName, address indexed oracle);
    event OracleRemoved(string indexed feedName, address indexed oracle);

    constructor(address admin, address oracleManager) {
        require(admin != address(0), "OracleHub: invalid admin");
        require(oracleManager != address(0), "OracleHub: invalid oracle manager");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ORACLE_MANAGER_ROLE, oracleManager);
        _grantRole(ORACLE_ROLE, oracleManager);
    }

    /**
     * @dev Submit data from an oracle source
     */
    function submitData(
        string calldata feedName,
        uint256 value,
        uint256 confidence
    ) external onlyRole(ORACLE_ROLE) whenNotPaused nonReentrant {
        require(bytes(feedName).length > 0, "OracleHub: empty feed name");
        require(value > 0, "OracleHub: invalid value");
        require(confidence >= MIN_CONFIDENCE && confidence <= 100, "OracleHub: invalid confidence");

        // Check if oracle is registered for this feed
        require(_isOracleActive(feedName, msg.sender), "OracleHub: oracle not active for feed");

        // Update oracle data
        oracleFeeds[feedName][msg.sender] = OracleData({
            value: value,
            timestamp: block.timestamp,
            confidence: confidence,
            isActive: true
        });

        emit DataUpdated(feedName, msg.sender, value, confidence, block.timestamp);

        // Update aggregated data
        _updateAggregatedData(feedName);
    }

    /**
     * @dev Add oracle to a feed
     */
    function addOracle(string calldata feedName, address oracle)
        external
        onlyRole(ORACLE_MANAGER_ROLE)
    {
        require(bytes(feedName).length > 0, "OracleHub: empty feed name");
        require(oracle != address(0), "OracleHub: invalid oracle address");
        require(!_isOracleActive(feedName, oracle), "OracleHub: oracle already active");

        activeSources[feedName].push(oracle);
        oracleFeeds[feedName][oracle].isActive = true;

        emit OracleAdded(feedName, oracle);
    }

    /**
     * @dev Remove oracle from a feed
     */
    function removeOracle(string calldata feedName, address oracle)
        external
        onlyRole(ORACLE_MANAGER_ROLE)
    {
        require(bytes(feedName).length > 0, "OracleHub: empty feed name");
        require(oracle != address(0), "OracleHub: invalid oracle address");
        require(_isOracleActive(feedName, oracle), "OracleHub: oracle not active");

        // Remove from active sources
        address[] storage sources = activeSources[feedName];
        for (uint256 i = 0; i < sources.length; i++) {
            if (sources[i] == oracle) {
                sources[i] = sources[sources.length - 1];
                sources.pop();
                break;
            }
        }

        // Deactivate oracle data
        oracleFeeds[feedName][oracle].isActive = false;

        emit OracleRemoved(feedName, oracle);

        // Update aggregated data
        _updateAggregatedData(feedName);
    }

    /**
     * @dev Get latest aggregated data for a feed
     */
    function getLatestData(string calldata feedName)
        external
        view
        returns (
            uint256 value,
            uint256 timestamp,
            uint256 confidence,
            bool isValid
        )
    {
        AggregatedData memory data = aggregatedData[feedName];
        
        bool valid = data.timestamp > 0 &&
                    block.timestamp - data.timestamp <= MAX_STALENESS &&
                    data.confidence >= MIN_CONFIDENCE &&
                    data.sourceCount >= MIN_SOURCES;

        return (data.value, data.timestamp, data.confidence, valid);
    }

    /**
     * @dev Get data from specific oracle
     */
    function getOracleData(string calldata feedName, address oracle)
        external
        view
        returns (
            uint256 value,
            uint256 timestamp,
            uint256 confidence,
            bool isActive
        )
    {
        OracleData memory data = oracleFeeds[feedName][oracle];
        return (data.value, data.timestamp, data.confidence, data.isActive);
    }

    /**
     * @dev Get all active sources for a feed
     */
    function getActiveSources(string calldata feedName)
        external
        view
        returns (address[] memory)
    {
        return activeSources[feedName];
    }

    /**
     * @dev Check if data is stale
     */
    function isDataStale(string calldata feedName) external view returns (bool) {
        AggregatedData memory data = aggregatedData[feedName];
        return data.timestamp == 0 || 
               block.timestamp - (data.timestamp) > MAX_STALENESS;
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
    function _isOracleActive(string calldata feedName, address oracle)
        internal
        view
        returns (bool)
    {
        return oracleFeeds[feedName][oracle].isActive;
    }

    function _updateAggregatedData(string calldata feedName) internal {
        address[] memory sources = activeSources[feedName];
        
        if (sources.length == 0) {
            return;
        }

        uint256[] memory values;
        uint256[] memory confidences;
        uint256[] memory timestamps;
        uint256 validCount = 0;

        // Collect valid data points
        for (uint256 i = 0; i < sources.length; i++) {
            OracleData memory data = oracleFeeds[feedName][sources[i]];
            
            if (data.isActive && 
                data.timestamp > 0 && 
                block.timestamp - (data.timestamp) <= MAX_STALENESS &&
                data.confidence >= MIN_CONFIDENCE) {
                
                validCount++;
            }
        }

        if (validCount < MIN_SOURCES) {
            return;
        }

        values = new uint256[](validCount);
        confidences = new uint256[](validCount);
        timestamps = new uint256[](validCount);
        
        uint256 index = 0;
        for (uint256 i = 0; i < sources.length; i++) {
            OracleData memory data = oracleFeeds[feedName][sources[i]];
            
            if (data.isActive && 
                data.timestamp > 0 && 
                block.timestamp - (data.timestamp) <= MAX_STALENESS &&
                data.confidence >= MIN_CONFIDENCE) {
                
                values[index] = data.value;
                confidences[index] = data.confidence;
                timestamps[index] = data.timestamp;
                index++;
            }
        }

        // Calculate weighted median
        uint256 aggregatedValue = _calculateWeightedMedian(values, confidences);
        uint256 aggregatedConfidence = _calculateAverageConfidence(confidences);
        uint256 latestTimestamp = _getLatestTimestamp(timestamps);

        // Update aggregated data
        aggregatedData[feedName] = AggregatedData({
            value: aggregatedValue,
            timestamp: latestTimestamp,
            confidence: aggregatedConfidence,
            sourceCount: validCount
        });

        emit AggregatedDataUpdated(
            feedName,
            aggregatedValue,
            aggregatedConfidence,
            validCount,
            latestTimestamp
        );
    }

    function _calculateWeightedMedian(
        uint256[] memory values,
        uint256[] memory weights
    ) internal pure returns (uint256) {
        if (values.length == 0) return 0;
        if (values.length == 1) return values[0];

        // Simple weighted average for now (can be enhanced to true weighted median)
        uint256 weightedSum = 0;
        uint256 totalWeight = 0;

        for (uint256 i = 0; i < values.length; i++) {
            weightedSum = weightedSum + (values[i] * (weights[i]));
            totalWeight = totalWeight + (weights[i]);
        }

        return totalWeight > 0 ? weightedSum / (totalWeight) : 0;
    }

    function _calculateAverageConfidence(uint256[] memory confidences)
        internal
        pure
        returns (uint256)
    {
        if (confidences.length == 0) return 0;

        uint256 sum = 0;
        for (uint256 i = 0; i < confidences.length; i++) {
            sum = sum + (confidences[i]);
        }

        return sum / (confidences.length);
    }

    function _getLatestTimestamp(uint256[] memory timestamps)
        internal
        pure
        returns (uint256)
    {
        uint256 latest = 0;
        for (uint256 i = 0; i < timestamps.length; i++) {
            if (timestamps[i] > latest) {
                latest = timestamps[i];
            }
        }
        return latest;
    }
}
