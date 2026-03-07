// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

interface IERC8004 {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getReputation(uint256 tokenId) external view returns (uint256);
}

/**
 * @title LoyaltyTierManager
 * @notice ERC-8004 identity-based tiered rebate multipliers with anti-gaming protections:
 *         - Minimum transaction value ($0.001)
 *         - Daily velocity caps (1000 txs/day max)
 *         - Account age requirements for Tier 3+
 */
contract LoyaltyTierManager is Ownable, Pausable {
    IERC8004 public identityContract;
    
    struct Tier {
        uint256 minTransactions;
        uint256 multiplierBps; // basis points (10000 = 1x, 15000 = 1.5x)
        uint256 minAccountAge;  // Minimum age in seconds (0 = no requirement)
    }
    
    Tier[] public tiers;
    mapping(uint256 => uint256) public agentTransactionCount;
    mapping(uint256 => uint256) public agentCreationTime;
    mapping(uint256 => mapping(uint256 => uint256)) public dailyTxCount; // agentId => day => count
    mapping(address => bool) public authorizedCallers; // Contracts that can record transactions
    
    // Anti-gaming constants
    uint256 public constant MIN_TX_VALUE = 0.001 ether; // $0.001 minimum
    uint256 public constant MAX_DAILY_TXS = 1000;
    uint256 public constant TIER_3_MIN_AGE = 30 days;
    
    address public guardian;
    
    event TierAchieved(uint256 indexed agentId, uint256 tierLevel, uint256 multiplier);
    event TransactionRecorded(uint256 indexed agentId, uint256 txValue, uint256 newCount);
    event AuthorizedCallerAdded(address indexed caller);
    event AuthorizedCallerRemoved(address indexed caller);
    event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);
    
    modifier onlyAuthorized() {
        require(authorizedCallers[msg.sender], "Not authorized");
        _;
    }
    
    modifier onlyGuardianOrOwner() {
        require(msg.sender == guardian || msg.sender == owner(), "Not authorized");
        _;
    }
    
    constructor(address _identityContract) {
        identityContract = IERC8004(_identityContract);
        guardian = msg.sender;
        
        // Initialize default tiers
        tiers.push(Tier({
            minTransactions: 0,
            multiplierBps: 10000,  // 1.0x
            minAccountAge: 0
        }));
        
        tiers.push(Tier({
            minTransactions: 10,
            multiplierBps: 11000,  // 1.1x
            minAccountAge: 0
        }));
        
        tiers.push(Tier({
            minTransactions: 100,
            multiplierBps: 13000,  // 1.3x
            minAccountAge: 0
        }));
        
        tiers.push(Tier({
            minTransactions: 1000,
            multiplierBps: 15000,  // 1.5x
            minAccountAge: TIER_3_MIN_AGE  // 30 days minimum
        }));
    }
    
    /**
     * @notice Record a transaction for tier progression (with anti-gaming checks)
     * @param agentId Agent's ERC-8004 token ID
     * @param txValue Transaction value in wei
     */
    function recordTransaction(uint256 agentId, uint256 txValue) 
        external 
        onlyAuthorized 
        whenNotPaused 
    {
        require(txValue >= MIN_TX_VALUE, "Transaction value too small");
        
        // Get current day (blocks are ~12 seconds, so day = timestamp / 86400)
        uint256 today = block.timestamp / 1 days;
        
        // Check daily velocity limit
        require(
            dailyTxCount[agentId][today] < MAX_DAILY_TXS,
            "Daily transaction limit reached"
        );
        
        // Initialize creation time on first transaction
        if (agentCreationTime[agentId] == 0) {
            agentCreationTime[agentId] = block.timestamp;
        }
        
        // Update counters
        agentTransactionCount[agentId]++;
        dailyTxCount[agentId][today]++;
        
        emit TransactionRecorded(agentId, txValue, agentTransactionCount[agentId]);
        
        // Check if new tier achieved
        uint256 newTier = _getCurrentTierLevel(agentId);
        if (newTier > 0) {
            emit TierAchieved(agentId, newTier, tiers[newTier].multiplierBps);
        }
    }
    
    /**
     * @notice Get tier multiplier for an agent
     * @param agentId Agent's ERC-8004 token ID
     * @return Multiplier in basis points (10000 = 1x)
     */
    function getTierMultiplier(uint256 agentId) public view returns (uint256) {
        uint256 txCount = agentTransactionCount[agentId];
        uint256 accountAge = agentCreationTime[agentId] > 0 
            ? block.timestamp - agentCreationTime[agentId] 
            : 0;
        
        // Check tiers from highest to lowest
        for (uint256 i = tiers.length; i > 0; i--) {
            Tier memory tier = tiers[i - 1];
            
            if (txCount >= tier.minTransactions && accountAge >= tier.minAccountAge) {
                return tier.multiplierBps;
            }
        }
        
        return 10000; // Default 1x
    }
    
    /**
     * @notice Calculate boosted rebate amount
     * @param agentId Agent's ERC-8004 token ID
     * @param baseRebate Base rebate amount before multiplier
     * @return Boosted rebate amount
     */
    function calculateBoostedRebate(uint256 agentId, uint256 baseRebate) 
        external 
        view 
        returns (uint256) 
    {
        uint256 multiplier = getTierMultiplier(agentId);
        return (baseRebate * multiplier) / 10000;
    }
    
    /**
     * @notice Get current tier level (0-3)
     */
    function _getCurrentTierLevel(uint256 agentId) internal view returns (uint256) {
        uint256 txCount = agentTransactionCount[agentId];
        uint256 accountAge = agentCreationTime[agentId] > 0 
            ? block.timestamp - agentCreationTime[agentId] 
            : 0;
        
        for (uint256 i = tiers.length; i > 0; i--) {
            Tier memory tier = tiers[i - 1];
            if (txCount >= tier.minTransactions && accountAge >= tier.minAccountAge) {
                return i - 1;
            }
        }
        return 0;
    }
    
    /**
     * @notice Get agent stats
     */
    function getAgentStats(uint256 agentId) 
        external 
        view 
        returns (
            uint256 totalTransactions,
            uint256 currentTier,
            uint256 currentMultiplier,
            uint256 accountAge,
            uint256 transactionsToNextTier,
            uint256 daysUntilNextTier
        ) 
    {
        totalTransactions = agentTransactionCount[agentId];
        currentTier = _getCurrentTierLevel(agentId);
        currentMultiplier = getTierMultiplier(agentId);
        accountAge = agentCreationTime[agentId] > 0 
            ? block.timestamp - agentCreationTime[agentId] 
            : 0;
        
        // Calculate progress to next tier
        if (currentTier < tiers.length - 1) {
            Tier memory nextTier = tiers[currentTier + 1];
            
            transactionsToNextTier = nextTier.minTransactions > totalTransactions
                ? nextTier.minTransactions - totalTransactions
                : 0;
            
            if (nextTier.minAccountAge > accountAge) {
                daysUntilNextTier = (nextTier.minAccountAge - accountAge) / 1 days;
            }
        }
    }
    
    /**
     * @notice Check daily transaction count for rate limiting
     */
    function getDailyTransactionCount(uint256 agentId) external view returns (uint256) {
        uint256 today = block.timestamp / 1 days;
        return dailyTxCount[agentId][today];
    }
    
    /**
     * @notice Add authorized caller (e.g., RebatePoolManager)
     */
    function addAuthorizedCaller(address caller) external onlyOwner {
        require(caller != address(0), "Invalid address");
        authorizedCallers[caller] = true;
        emit AuthorizedCallerAdded(caller);
    }
    
    /**
     * @notice Remove authorized caller
     */
    function removeAuthorizedCaller(address caller) external onlyOwner {
        authorizedCallers[caller] = false;
        emit AuthorizedCallerRemoved(caller);
    }
    
    /**
     * @notice Add or update tier (owner only)
     */
    function updateTier(
        uint256 tierIndex,
        uint256 minTransactions,
        uint256 multiplierBps,
        uint256 minAccountAge
    ) external onlyOwner {
        require(tierIndex < tiers.length, "Invalid tier");
        require(multiplierBps >= 10000 && multiplierBps <= 20000, "Invalid multiplier");
        
        tiers[tierIndex] = Tier({
            minTransactions: minTransactions,
            multiplierBps: multiplierBps,
            minAccountAge: minAccountAge
        });
    }
    
    /**
     * @notice Update guardian
     */
    function updateGuardian(address newGuardian) external onlyOwner {
        require(newGuardian != address(0), "Invalid guardian");
        emit GuardianUpdated(guardian, newGuardian);
        guardian = newGuardian;
    }
    
    /**
     * @notice Emergency pause
     */
    function pause() external onlyGuardianOrOwner {
        _pause();
    }
    
    /**
     * @notice Unpause
     */
    function unpause() external onlyOwner {
        _unpause();
    }
}
