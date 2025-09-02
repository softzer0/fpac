// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title FPAC - FAIT-Pegged Autonomous Currency
 * @dev ERC20 token pegged to the Federal Asset Index Token (FAIT)
 * Main features:
 * - Algorithmic peg maintenance through mint/burn operations
 * - Role-based access control for minting and burning
 * - Emergency pause functionality
 * - Integration with PegEngine for automated operations
 */
contract FPAC is ERC20, ERC20Burnable, AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant PEG_ENGINE_ROLE = keccak256("PEG_ENGINE_ROLE");

    uint256 public constant INITIAL_SUPPLY = 1_000_000 * 10**18; // 1M FPAC
    uint256 public constant MAX_SUPPLY = 100_000_000 * 10**18; // 100M FPAC max

    // Peg tracking
    uint256 private _targetPrice; // Target price in wei (18 decimals)
    uint256 private _currentPrice; // Current market price in wei
    uint256 private _pegTolerance; // Allowed deviation from peg (basis points)

    // Events
    event PegParametersUpdated(uint256 targetPrice, uint256 pegTolerance);
    event PriceUpdated(uint256 newPrice, uint256 timestamp);
    event EmergencyMint(address indexed to, uint256 amount, string reason);
    event EmergencyBurn(address indexed from, uint256 amount, string reason);

    constructor(
        address defaultAdmin,
        address pegEngine,
        uint256 initialTargetPrice
    ) ERC20("FAIT-Pegged Autonomous Currency", "FPAC") {
        require(defaultAdmin != address(0), "FPAC: invalid admin address");
        require(pegEngine != address(0), "FPAC: invalid peg engine address");
        require(initialTargetPrice > 0, "FPAC: invalid target price");

        // Set up roles
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(MINTER_ROLE, pegEngine);
        _grantRole(BURNER_ROLE, pegEngine);
        _grantRole(PEG_ENGINE_ROLE, pegEngine);
        _grantRole(PAUSER_ROLE, defaultAdmin);

        // Initialize peg parameters
        _targetPrice = initialTargetPrice;
        _currentPrice = initialTargetPrice;
        _pegTolerance = 100; // 1% tolerance (100 basis points)

        // Mint initial supply to admin
        _mint(defaultAdmin, INITIAL_SUPPLY);
    }

    /**
     * @dev Mint tokens (only by authorized minters)
     */
    function mint(address to, uint256 amount) 
        public 
        onlyRole(MINTER_ROLE) 
        whenNotPaused 
        nonReentrant 
    {
        require(to != address(0), "FPAC: mint to zero address");
        require(totalSupply() + amount <= MAX_SUPPLY, "FPAC: max supply exceeded");
        _mint(to, amount);
    }

    /**
     * @dev Burn tokens from a specific account (only by authorized burners)
     */
    function burnFrom(address account, uint256 amount) 
        public 
        override 
        onlyRole(BURNER_ROLE) 
        whenNotPaused 
        nonReentrant 
    {
        require(account != address(0), "FPAC: burn from zero address");
        _spendAllowance(account, _msgSender(), amount);
        _burn(account, amount);
    }

    /**
     * @dev Emergency mint for critical situations
     */
    function emergencyMint(address to, uint256 amount, string calldata reason)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        require(to != address(0), "FPAC: emergency mint to zero address");
        require(totalSupply() + amount <= MAX_SUPPLY, "FPAC: max supply exceeded");
        require(bytes(reason).length > 0, "FPAC: emergency reason required");
        
        _mint(to, amount);
        emit EmergencyMint(to, amount, reason);
    }

    /**
     * @dev Emergency burn for critical situations
     */
    function emergencyBurn(address from, uint256 amount, string calldata reason)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        require(from != address(0), "FPAC: emergency burn from zero address");
        require(bytes(reason).length > 0, "FPAC: emergency reason required");
        
        _burn(from, amount);
        emit EmergencyBurn(from, amount, reason);
    }

    /**
     * @dev Update current market price (only by PegEngine)
     */
    function updatePrice(uint256 newPrice) 
        external 
        onlyRole(PEG_ENGINE_ROLE) 
    {
        require(newPrice > 0, "FPAC: invalid price");
        _currentPrice = newPrice;
        emit PriceUpdated(newPrice, block.timestamp);
    }

    /**
     * @dev Update peg parameters
     */
    function updatePegParameters(uint256 targetPrice, uint256 pegTolerance)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(targetPrice > 0, "FPAC: invalid target price");
        require(pegTolerance <= 1000, "FPAC: tolerance too high"); // Max 10%

        _targetPrice = targetPrice;
        _pegTolerance = pegTolerance;
        
        emit PegParametersUpdated(targetPrice, pegTolerance);
    }

    /**
     * @dev Pause contract (emergency use)
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause contract
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // View functions
    function getTargetPrice() external view returns (uint256) {
        return _targetPrice;
    }

    function getCurrentPrice() external view returns (uint256) {
        return _currentPrice;
    }

    function getPegTolerance() external view returns (uint256) {
        return _pegTolerance;
    }

    function isPegMaintained() external view returns (bool) {
        if (_targetPrice == 0) return false;
        
        uint256 deviation = _currentPrice > _targetPrice 
            ? _currentPrice - _targetPrice 
            : _targetPrice - _currentPrice;
            
        uint256 maxDeviation = (_targetPrice * _pegTolerance) / 10000;
        return deviation <= maxDeviation;
    }

    function getPegDeviation() external view returns (uint256) {
        if (_targetPrice == 0) return 0;
        
        uint256 deviation = _currentPrice > _targetPrice 
            ? _currentPrice - _targetPrice 
            : _targetPrice - _currentPrice;
            
        return (deviation * 10000) / _targetPrice; // Return in basis points
    }

    // Override required by Solidity
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal override whenNotPaused {
        super._update(from, to, amount);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
