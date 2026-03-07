// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title RebatePoolManager
 * @notice Manages service provider rebate pools with security features:
 *         - 30-day deposit lock period
 *         - 20% weekly withdrawal limits
 *         - Pausable emergency circuit breaker
 *         - Delayed rebate percentage updates
 */
contract RebatePoolManager is Ownable, ReentrancyGuard, Pausable {
    struct ServiceProvider {
        uint256 depositedAmount;      // Total deposited (including locked)
        uint256 allocatedRewards;     // Rebates allocated but not yet claimed
        uint256 rebatePercentage;     // Current rebate in basis points
        bool isActive;
        uint256 registrationTime;
        uint256 pendingRebatePercentage;  // New rebate % waiting to take effect
        uint256 rebateUpdateEpoch;        // When pending rebate becomes active
        uint256 lastWithdrawalTime;       // For weekly limit tracking
        uint256 weeklyWithdrawnAmount;    // Amount withdrawn this week
    }
    
    struct ProviderMetadata {
        string name;
        string description;
        string apiEndpoint;
        string category;
    }
    
    mapping(address => ServiceProvider) public providers;
    mapping(address => ProviderMetadata) public providerMetadata;
    mapping(address => uint256) public totalVolumeProcessed;
    
    // Security constants
    uint256 public constant MIN_DEPOSIT = 0.1 ether;
    uint256 public constant MAX_REBATE_BPS = 1000; // 10%
    uint256 public constant WITHDRAWAL_LOCK_PERIOD = 30 days;
    uint256 public constant MAX_WEEKLY_WITHDRAWAL_BPS = 2000; // 20% of deposit
    uint256 public constant WEEK = 7 days;
    
    uint256 public currentEpoch;
    address public guardian; // Can pause, cannot unpause
    
    event ProviderRegistered(
        address indexed provider, 
        uint256 initialDeposit,
        uint256 rebatePercentage,
        string name
    );
    event RebateAllocated(
        address indexed provider, 
        address indexed agent, 
        uint256 amount
    );
    event ProviderFunded(address indexed provider, uint256 amount);
    event ProviderDeactivated(address indexed provider);
    event RebatePercentageUpdated(
        address indexed provider, 
        uint256 oldPercentage, 
        uint256 newPercentage,
        uint256 effectiveEpoch
    );
    event MetadataUpdated(address indexed provider);
    event WithdrawalMade(
        address indexed provider,
        uint256 amount,
        uint256 remainingBalance
    );
    event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);
    
    modifier onlyGuardianOrOwner() {
        require(msg.sender == guardian || msg.sender == owner(), "Not authorized");
        _;
    }
    
    constructor() {
        guardian = msg.sender;
    }
    
    /**
     * @notice Register as a service provider with initial deposit
     * @param rebatePercentage Rebate % in basis points (300 = 3%)
     * @param name Service name (required)
     * @param description Service description
     * @param apiEndpoint API URL
     * @param category Service category
     */
    function registerProvider(
        uint256 rebatePercentage,
        string calldata name,
        string calldata description,
        string calldata apiEndpoint,
        string calldata category
    ) external payable whenNotPaused {
        require(msg.value >= MIN_DEPOSIT, "Insufficient deposit");
        require(rebatePercentage <= MAX_REBATE_BPS, "Rebate too high");
        require(!providers[msg.sender].isActive, "Already registered");
        require(bytes(name).length > 0, "Name required");
        require(bytes(name).length <= 100, "Name too long");
        
        providers[msg.sender] = ServiceProvider({
            depositedAmount: msg.value,
            allocatedRewards: 0,
            rebatePercentage: rebatePercentage,
            isActive: true,
            registrationTime: block.timestamp,
            pendingRebatePercentage: 0,
            rebateUpdateEpoch: 0,
            lastWithdrawalTime: 0,
            weeklyWithdrawnAmount: 0
        });
        
        providerMetadata[msg.sender] = ProviderMetadata({
            name: name,
            description: description,
            apiEndpoint: apiEndpoint,
            category: category
        });
        
        emit ProviderRegistered(msg.sender, msg.value, rebatePercentage, name);
        emit MetadataUpdated(msg.sender);
    }
    
    /**
     * @notice Update service metadata (can be called anytime)
     */
    function updateMetadata(
        string calldata name,
        string calldata description,
        string calldata apiEndpoint,
        string calldata category
    ) external {
        require(providers[msg.sender].isActive, "Not registered");
        require(bytes(name).length > 0 && bytes(name).length <= 100, "Invalid name");
        
        providerMetadata[msg.sender] = ProviderMetadata({
            name: name,
            description: description,
            apiEndpoint: apiEndpoint,
            category: category
        });
        
        emit MetadataUpdated(msg.sender);
    }
    
    /**
     * @notice Update rebate percentage (takes effect next epoch to prevent gaming)
     */
    function updateRebatePercentage(uint256 newPercentage) external {
        require(providers[msg.sender].isActive, "Not registered");
        require(newPercentage <= MAX_REBATE_BPS, "Rebate too high");
        
        uint256 effectiveEpoch = currentEpoch + 1;
        
        emit RebatePercentageUpdated(
            msg.sender,
            providers[msg.sender].rebatePercentage,
            newPercentage,
            effectiveEpoch
        );
        
        providers[msg.sender].pendingRebatePercentage = newPercentage;
        providers[msg.sender].rebateUpdateEpoch = effectiveEpoch;
    }
    
    /**
     * @notice Add more funds to rebate pool
     */
    function fundPool() external payable whenNotPaused {
        require(providers[msg.sender].isActive, "Provider not registered");
        require(msg.value > 0, "Must send ETH");
        
        providers[msg.sender].depositedAmount += msg.value;
        emit ProviderFunded(msg.sender, msg.value);
    }
    
    /**
     * @notice Allocate rebate to an agent (called by provider service)
     * @param agent Agent address receiving rebate
     * @param transactionAmount Transaction value in wei
     * @return rebateAmount Amount of rebate allocated
     */
    function allocateRebate(address agent, uint256 transactionAmount) 
        external 
        nonReentrant 
        whenNotPaused
        returns (uint256 rebateAmount) 
    {
        require(agent != address(0), "Invalid agent");
        
        ServiceProvider storage provider = providers[msg.sender];
        require(provider.isActive, "Provider not active");
        
        // Apply pending rebate % if epoch reached
        if (provider.rebateUpdateEpoch > 0 && currentEpoch >= provider.rebateUpdateEpoch) {
            provider.rebatePercentage = provider.pendingRebatePercentage;
            provider.pendingRebatePercentage = 0;
            provider.rebateUpdateEpoch = 0;
        }
        
        rebateAmount = (transactionAmount * provider.rebatePercentage) / 10000;
        
        uint256 availableBalance = provider.depositedAmount - provider.allocatedRewards;
        require(availableBalance >= rebateAmount, "Insufficient pool balance");
        
        provider.allocatedRewards += rebateAmount;
        totalVolumeProcessed[msg.sender] += transactionAmount;
        
        emit RebateAllocated(msg.sender, agent, rebateAmount);
    }
    
    /**
     * @notice Withdraw funds from pool (30-day lock + 20% weekly limit)
     * @param amount Amount to withdraw in wei
     */
    function withdrawDeposit(uint256 amount) external nonReentrant whenNotPaused {
        ServiceProvider storage provider = providers[msg.sender];
        require(provider.isActive, "Not active");
        require(amount > 0, "Invalid amount");
        
        // Check 30-day lock period
        require(
            block.timestamp >= provider.registrationTime + WITHDRAWAL_LOCK_PERIOD,
            "Deposit still locked (30 days)"
        );
        
        // Calculate available balance (deposited - allocated)
        uint256 availableBalance = provider.depositedAmount - provider.allocatedRewards;
        require(amount <= availableBalance, "Insufficient available balance");
        
        // Reset weekly counter if a week has passed
        if (block.timestamp >= provider.lastWithdrawalTime + WEEK) {
            provider.weeklyWithdrawnAmount = 0;
            provider.lastWithdrawalTime = block.timestamp;
        }
        
        // Check weekly limit (20% of original deposit per week)
        uint256 maxWeekly = (provider.depositedAmount * MAX_WEEKLY_WITHDRAWAL_BPS) / 10000;
        require(
            provider.weeklyWithdrawnAmount + amount <= maxWeekly,
            "Weekly withdrawal limit exceeded (20%)"
        );
        
        // Update state
        provider.depositedAmount -= amount;
        provider.weeklyWithdrawnAmount += amount;
        
        // Transfer funds
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
        
        emit WithdrawalMade(msg.sender, amount, provider.depositedAmount);
    }
    
    /**
     * @notice Get provider's available balance (deposited - allocated)
     */
    function getProviderBalance(address provider) external view returns (uint256) {
        ServiceProvider memory p = providers[provider];
        return p.depositedAmount - p.allocatedRewards;
    }
    
    /**
     * @notice Get current active rebate percentage
     */
    function getActiveRebatePercentage(address provider) external view returns (uint256) {
        ServiceProvider memory p = providers[provider];
        if (p.rebateUpdateEpoch > 0 && currentEpoch >= p.rebateUpdateEpoch) {
            return p.pendingRebatePercentage;
        }
        return p.rebatePercentage;
    }
    
    /**
     * @notice Check if provider can withdraw and how much
     */
    function getWithdrawalInfo(address provider) 
        external 
        view 
        returns (
            bool canWithdraw,
            uint256 availableBalance,
            uint256 weeklyLimit,
            uint256 weeklyRemaining,
            uint256 unlockTime
        ) 
    {
        ServiceProvider memory p = providers[provider];
        
        unlockTime = p.registrationTime + WITHDRAWAL_LOCK_PERIOD;
        canWithdraw = block.timestamp >= unlockTime;
        availableBalance = p.depositedAmount - p.allocatedRewards;
        weeklyLimit = (p.depositedAmount * MAX_WEEKLY_WITHDRAWAL_BPS) / 10000;
        
        // Calculate remaining weekly allowance
        if (block.timestamp >= p.lastWithdrawalTime + WEEK) {
            weeklyRemaining = weeklyLimit; // New week, full allowance
        } else {
            weeklyRemaining = weeklyLimit > p.weeklyWithdrawnAmount 
                ? weeklyLimit - p.weeklyWithdrawnAmount 
                : 0;
        }
    }
    
    /**
     * @notice Deactivate provider (can reactivate later by owner)
     */
    function deactivateProvider() external {
        require(providers[msg.sender].isActive, "Not active");
        providers[msg.sender].isActive = false;
        emit ProviderDeactivated(msg.sender);
    }
    
    /**
     * @notice Advance epoch (affects pending rebate % updates)
     */
    function advanceEpoch() external onlyOwner {
        currentEpoch++;
    }
    
    /**
     * @notice Update guardian address
     */
    function updateGuardian(address newGuardian) external onlyOwner {
        require(newGuardian != address(0), "Invalid guardian");
        emit GuardianUpdated(guardian, newGuardian);
        guardian = newGuardian;
    }
    
    /**
     * @notice Emergency pause (guardian or owner)
     */
    function pause() external onlyGuardianOrOwner {
        _pause();
    }
    
    /**
     * @notice Unpause (only owner)
     */
    function unpause() external onlyOwner {
        _unpause();
    }
}
