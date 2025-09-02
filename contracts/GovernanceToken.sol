// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/Nonces.sol";

/**
 * @title GovernanceToken
 * @dev ERC20 token with voting capabilities for FPAC protocol governance
 * Features:
 * - Vote delegation and tracking
 * - Permit functionality for gasless approvals
 * - Role-based minting for initial distribution and rewards
 * - Pausable for emergency situations
 */
contract GovernanceToken is ERC20, ERC20Permit, ERC20Votes, AccessControl, Pausable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 public constant INITIAL_SUPPLY = 10_000_000 * 10**18; // 10M tokens
    uint256 public constant MAX_SUPPLY = 100_000_000 * 10**18; // 100M tokens max

    // Vesting and distribution tracking
    mapping(address => uint256) public vestedTokens;
    mapping(address => uint256) public vestingStart;
    mapping(address => uint256) public vestingDuration;
    
    uint256 public totalVested;
    uint256 public totalReleased;

    // Events
    event TokensVested(address indexed beneficiary, uint256 amount, uint256 duration);
    event TokensReleased(address indexed beneficiary, uint256 amount);
    event VestingRevoked(address indexed beneficiary, uint256 amount);

    constructor(
        address defaultAdmin,
        address minter
    ) ERC20("FPAC Governance Token", "FPGOV") ERC20Permit("FPAC Governance Token") {
        require(defaultAdmin != address(0), "GovernanceToken: invalid admin");
        require(minter != address(0), "GovernanceToken: invalid minter");

        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(MINTER_ROLE, minter);
        _grantRole(PAUSER_ROLE, defaultAdmin);

        // Mint initial supply to admin for distribution
        _mint(defaultAdmin, INITIAL_SUPPLY);
    }

    /**
     * @dev Mint new tokens (for rewards, etc.)
     */
    function mint(address to, uint256 amount) 
        public 
        onlyRole(MINTER_ROLE) 
        whenNotPaused 
    {
        require(to != address(0), "GovernanceToken: mint to zero address");
        require(totalSupply() + amount <= MAX_SUPPLY, "GovernanceToken: max supply exceeded");
        _mint(to, amount);
    }

    /**
     * @dev Create a vesting schedule for tokens
     */
    function vestTokens(
        address beneficiary,
        uint256 amount,
        uint256 duration
    ) external onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused {
        require(beneficiary != address(0), "GovernanceToken: invalid beneficiary");
        require(amount > 0, "GovernanceToken: invalid amount");
        require(duration > 0, "GovernanceToken: invalid duration");
        require(vestedTokens[beneficiary] == 0, "GovernanceToken: beneficiary already has vesting");
        require(balanceOf(msg.sender) >= amount, "GovernanceToken: insufficient balance");

        // Transfer tokens to this contract for vesting
        _transfer(msg.sender, address(this), amount);

        vestedTokens[beneficiary] = amount;
        vestingStart[beneficiary] = block.timestamp;
        vestingDuration[beneficiary] = duration;
        totalVested += amount;

        emit TokensVested(beneficiary, amount, duration);
    }

    /**
     * @dev Release vested tokens to beneficiary
     */
    function releaseVestedTokens(address beneficiary) external whenNotPaused {
        require(beneficiary != address(0), "GovernanceToken: invalid beneficiary");
        
        uint256 releasableAmount = getReleasableAmount(beneficiary);
        require(releasableAmount > 0, "GovernanceToken: no tokens to release");

        vestedTokens[beneficiary] -= releasableAmount;
        totalReleased += releasableAmount;

        _transfer(address(this), beneficiary, releasableAmount);

        emit TokensReleased(beneficiary, releasableAmount);
    }

    /**
     * @dev Get amount of tokens that can be released for a beneficiary
     */
    function getReleasableAmount(address beneficiary) public view returns (uint256) {
        if (vestedTokens[beneficiary] == 0) return 0;

        uint256 elapsedTime = block.timestamp - vestingStart[beneficiary];
        uint256 totalVestedAmount = vestedTokens[beneficiary];

        if (elapsedTime >= vestingDuration[beneficiary]) {
            // Full vesting period completed
            return totalVestedAmount;
        }

        // Calculate proportional amount based on elapsed time
        uint256 vestedAmount = (totalVestedAmount * elapsedTime) / vestingDuration[beneficiary];
        
        // Subtract already released amount
        uint256 contractBalance = balanceOf(address(this));
        uint256 alreadyReleased = totalVestedAmount - contractBalance;
        
        return vestedAmount > alreadyReleased ? vestedAmount - alreadyReleased : 0;
    }

    /**
     * @dev Revoke vesting (emergency use only)
     */
    function revokeVesting(address beneficiary) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        require(beneficiary != address(0), "GovernanceToken: invalid beneficiary");
        require(vestedTokens[beneficiary] > 0, "GovernanceToken: no vesting to revoke");

        uint256 revokedAmount = vestedTokens[beneficiary];
        
        // Release any already vested tokens first
        uint256 releasableAmount = getReleasableAmount(beneficiary);
        if (releasableAmount > 0) {
            vestedTokens[beneficiary] -= releasableAmount;
            _transfer(address(this), beneficiary, releasableAmount);
            emit TokensReleased(beneficiary, releasableAmount);
        }

        // Return remaining tokens to admin
        uint256 remainingAmount = vestedTokens[beneficiary];
        if (remainingAmount > 0) {
            _transfer(address(this), msg.sender, remainingAmount);
            totalVested -= remainingAmount;
        }

        // Clear vesting data
        vestedTokens[beneficiary] = 0;
        vestingStart[beneficiary] = 0;
        vestingDuration[beneficiary] = 0;

        emit VestingRevoked(beneficiary, revokedAmount);
    }

    /**
     * @dev Get vesting information for a beneficiary
     */
    function getVestingInfo(address beneficiary) 
        external 
        view 
        returns (
            uint256 totalVestedAmount,
            uint256 releasedAmount,
            uint256 releasableAmount,
            uint256 startTime,
            uint256 duration,
            uint256 endTime
        ) 
    {
        totalVestedAmount = vestedTokens[beneficiary];
        startTime = vestingStart[beneficiary];
        duration = vestingDuration[beneficiary];
        endTime = startTime + duration;
        releasableAmount = getReleasableAmount(beneficiary);
        
        if (totalVestedAmount > 0) {
            uint256 contractBalance = balanceOf(address(this));
            releasedAmount = totalVestedAmount - contractBalance;
        }
    }

    /**
     * @dev Pause all token operations
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause token operations
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // Required overrides for OpenZeppelin v5
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal override(ERC20, ERC20Votes) whenNotPaused {
        super._update(from, to, amount);
    }

    function nonces(address owner) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
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
