// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title ReferralGraph
 * @notice Agent-to-agent referral system with anti-Sybil protections:
 *         - Minimum $1 transaction volume before referral bonuses unlock
 *         - One-time referrer assignment (immutable)
 *         - Pausable for emergency situations
 */
contract ReferralGraph is Ownable, Pausable {
    struct Referral {
        address referrer;
        uint256 timestamp;
        uint256 totalReferredVolume;
        bool bonusUnlocked; // True once MIN_VOLUME_FOR_BONUS reached
    }
    
    mapping(address => Referral) public referrals;
    mapping(address => address[]) public referredAgents;
    mapping(address => bool) public authorizedCallers; // Contracts that can update volume
    
    // Bonus rates in basis points
    uint256 public referrerBonusBps = 500; // 5% bonus to referrer
    uint256 public refereeBonusBps = 300;  // 3% bonus to referee
    
    // Anti-Sybil protection
    uint256 public constant MIN_VOLUME_FOR_BONUS = 1 ether; // $1 equivalent in wei
    
    address public guardian;
    
    event ReferralRecorded(
        address indexed referee, 
        address indexed referrer,
        uint256 timestamp
    );
    event ReferralRewardAllocated(
        address indexed referrer, 
        address indexed referee,
        uint256 referrerBonus,
        uint256 refereeBonus
    );
    event ReferralVolumeUpdated(
        address indexed referee,
        uint256 addedVolume,
        uint256 totalVolume,
        bool bonusUnlocked
    );
    event BonusRatesUpdated(uint256 referrerBps, uint256 refereeBps);
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
    
    constructor() {
        guardian = msg.sender;
    }
    
    /**
     * @notice Record a referral relationship (one-time, immutable)
     * @param referrer Address of the referrer
     */
    function recordReferral(address referrer) external whenNotPaused {
        require(referrals[msg.sender].referrer == address(0), "Already referred");
        require(referrer != msg.sender, "Cannot self-refer");
        require(referrer != address(0), "Invalid referrer");
        
        referrals[msg.sender] = Referral({
            referrer: referrer,
            timestamp: block.timestamp,
            totalReferredVolume: 0,
            bonusUnlocked: false
        });
        
        referredAgents[referrer].push(msg.sender);
        
        emit ReferralRecorded(msg.sender, referrer, block.timestamp);
    }
    
    /**
     * @notice Update transaction volume for a referred agent
     * @dev Called by authorized contracts (e.g., RebatePoolManager)
     * @param referee Address of the referred agent
     * @param volume Transaction volume to add
     */
    function updateReferralVolume(address referee, uint256 volume) 
        external 
        onlyAuthorized 
        whenNotPaused 
    {
        Referral storage referral = referrals[referee];
        
        if (referral.referrer != address(0)) {
            referral.totalReferredVolume += volume;
            
            // Check if bonus threshold reached
            if (!referral.bonusUnlocked && 
                referral.totalReferredVolume >= MIN_VOLUME_FOR_BONUS) {
                referral.bonusUnlocked = true;
            }
            
            emit ReferralVolumeUpdated(
                referee,
                volume,
                referral.totalReferredVolume,
                referral.bonusUnlocked
            );
        }
    }
    
    /**
     * @notice Calculate referral bonuses (returns 0 if volume threshold not met)
     * @param agent Address to check
     * @param baseRebate Base rebate amount before bonuses
     * @return referrerBonus Bonus for the referrer
     * @return refereeBonus Bonus for the referee
     */
    function getReferralBonus(address agent, uint256 baseRebate) 
        external 
        view 
        returns (uint256 referrerBonus, uint256 refereeBonus) 
    {
        Referral memory referral = referrals[agent];
        
        // Only award bonuses if minimum volume reached
        if (referral.referrer != address(0) && referral.bonusUnlocked) {
            referrerBonus = (baseRebate * referrerBonusBps) / 10000;
            refereeBonus = (baseRebate * refereeBonusBps) / 10000;
        }
    }
    
    /**
     * @notice Get referral info for an agent
     */
    function getReferralInfo(address agent) 
        external 
        view 
        returns (
            address referrer,
            uint256 totalVolume,
            bool bonusUnlocked,
            uint256 volumeUntilBonus,
            uint256 referralCount
        ) 
    {
        Referral memory referral = referrals[agent];
        
        referrer = referral.referrer;
        totalVolume = referral.totalReferredVolume;
        bonusUnlocked = referral.bonusUnlocked;
        
        if (totalVolume < MIN_VOLUME_FOR_BONUS) {
            volumeUntilBonus = MIN_VOLUME_FOR_BONUS - totalVolume;
        }
        
        referralCount = referredAgents[agent].length;
    }
    
    /**
     * @notice Get all agents referred by a specific referrer
     */
    function getReferredAgents(address referrer) 
        external 
        view 
        returns (address[] memory) 
    {
        return referredAgents[referrer];
    }
    
    /**
     * @notice Get referrer statistics
     */
    function getReferrerStats(address referrer) 
        external 
        view 
        returns (
            uint256 totalReferrals,
            uint256 activeReferrals, // Referrals with bonus unlocked
            uint256 totalVolume
        ) 
    {
        address[] memory referred = referredAgents[referrer];
        totalReferrals = referred.length;
        
        for (uint256 i = 0; i < referred.length; i++) {
            Referral memory ref = referrals[referred[i]];
            totalVolume += ref.totalReferredVolume;
            if (ref.bonusUnlocked) {
                activeReferrals++;
            }
        }
    }
    
    /**
     * @notice Update bonus rates (owner only)
     * @param newReferrerBps New referrer bonus in basis points
     * @param newRefereeBps New referee bonus in basis points
     */
    function updateBonusRates(uint256 newReferrerBps, uint256 newRefereeBps) 
        external 
        onlyOwner 
    {
        require(newReferrerBps <= 1000, "Referrer bonus too high (max 10%)");
        require(newRefereeBps <= 500, "Referee bonus too high (max 5%)");
        
        referrerBonusBps = newReferrerBps;
        refereeBonusBps = newRefereeBps;
        
        emit BonusRatesUpdated(newReferrerBps, newRefereeBps);
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
