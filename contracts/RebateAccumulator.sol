// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RebateAccumulator
 * @notice Batch settlement system with Merkle proofs and security features:
 *         - 24-hour activation delay for new Merkle roots
 *         - Multisig operator support (via Gnosis Safe)
 *         - Emergency pause functionality
 *         - Public audit trail via events
 */
contract RebateAccumulator is ReentrancyGuard, Pausable, Ownable {
    address public rebatePoolManager;
    address public operator; // Can be EOA or multisig (Gnosis Safe)
    
    bytes32 public currentMerkleRoot;
    uint256 public currentEpoch;
    
    // Security features
    uint256 public constant ROOT_ACTIVATION_DELAY = 24 hours;
    mapping(uint256 => bytes32) public epochRoots;
    mapping(uint256 => uint256) public epochActivationTime;
    mapping(uint256 => mapping(address => bool)) public hasClaimed; // epoch => agent => claimed
    mapping(uint256 => uint256) public epochTotalClaimed; // Total ETH claimed per epoch
    
    address public guardian; // Can pause, cannot unpause
    
    event MerkleRootUpdated(
        uint256 indexed epoch, 
        bytes32 root, 
        uint256 activationTime,
        address indexed updatedBy
    );
    event RewardClaimed(
        address indexed agent, 
        uint256 amount, 
        uint256 indexed epoch
    );
    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);
    event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);
    event RootActivationDelayUpdated(uint256 oldDelay, uint256 newDelay);
    
    modifier onlyOperator() {
        require(msg.sender == operator, "Only operator");
        _;
    }
    
    modifier onlyGuardianOrOwner() {
        require(msg.sender == guardian || msg.sender == owner(), "Not authorized");
        _;
    }
    
    constructor(address _poolManager, address _operator) {
        require(_poolManager != address(0), "Invalid pool manager");
        require(_operator != address(0), "Invalid operator");
        
        rebatePoolManager = _poolManager;
        operator = _operator;
        guardian = msg.sender;
    }
    
    /**
     * @notice Update Merkle root for new epoch (operator only)
     * @dev Root activates after 24hr delay to allow challenge period
     * @param newRoot New Merkle root for rebate claims
     */
    function updateMerkleRoot(bytes32 newRoot) external onlyOperator whenNotPaused {
        require(newRoot != bytes32(0), "Invalid root");
        
        currentEpoch++;
        currentMerkleRoot = newRoot;
        epochRoots[currentEpoch] = newRoot;
        epochActivationTime[currentEpoch] = block.timestamp + ROOT_ACTIVATION_DELAY;
        
        emit MerkleRootUpdated(
            currentEpoch, 
            newRoot, 
            epochActivationTime[currentEpoch],
            msg.sender
        );
    }
    
    /**
     * @notice Claim rebate for a specific epoch
     * @param epoch Epoch to claim from
     * @param amount Rebate amount in wei
     * @param merkleProof Merkle proof of inclusion
     */
    function claimRebate(
        uint256 epoch,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external nonReentrant whenNotPaused {
        require(epoch > 0 && epoch <= currentEpoch, "Invalid epoch");
        require(!hasClaimed[epoch][msg.sender], "Already claimed");
        require(amount > 0, "Invalid amount");
        
        // Check activation delay has passed
        require(
            block.timestamp >= epochActivationTime[epoch],
            "Root not activated yet (24hr delay)"
        );
        
        // Verify Merkle proof
        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, amount));
        require(
            MerkleProof.verify(merkleProof, epochRoots[epoch], leaf),
            "Invalid Merkle proof"
        );
        
        // Mark as claimed BEFORE transfer (reentrancy protection)
        hasClaimed[epoch][msg.sender] = true;
        epochTotalClaimed[epoch] += amount;
        
        // Transfer rebate
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
        
        emit RewardClaimed(msg.sender, amount, epoch);
    }
    
    /**
     * @notice Batch claim rebates from multiple epochs
     * @param epochs Array of epochs to claim
     * @param amounts Array of amounts per epoch
     * @param merkleProofs Array of Merkle proofs (flattened)
     * @param proofLengths Array of proof lengths per epoch
     */
    function claimMultipleEpochs(
        uint256[] calldata epochs,
        uint256[] calldata amounts,
        bytes32[] calldata merkleProofs,
        uint256[] calldata proofLengths
    ) external nonReentrant whenNotPaused {
        require(
            epochs.length == amounts.length && 
            epochs.length == proofLengths.length,
            "Array length mismatch"
        );
        require(epochs.length <= 10, "Max 10 epochs per batch");
        
        uint256 totalAmount = 0;
        uint256 proofIndex = 0;
        
        for (uint256 i = 0; i < epochs.length; i++) {
            uint256 epoch = epochs[i];
            uint256 amount = amounts[i];
            uint256 proofLength = proofLengths[i];
            
            require(epoch > 0 && epoch <= currentEpoch, "Invalid epoch");
            require(!hasClaimed[epoch][msg.sender], "Already claimed");
            require(amount > 0, "Invalid amount");
            require(
                block.timestamp >= epochActivationTime[epoch],
                "Root not activated"
            );
            
            // Extract proof for this epoch
            bytes32[] memory proof = new bytes32[](proofLength);
            for (uint256 j = 0; j < proofLength; j++) {
                proof[j] = merkleProofs[proofIndex + j];
            }
            proofIndex += proofLength;
            
            // Verify proof
            bytes32 leaf = keccak256(abi.encodePacked(msg.sender, amount));
            require(
                MerkleProof.verify(proof, epochRoots[epoch], leaf),
                "Invalid proof"
            );
            
            hasClaimed[epoch][msg.sender] = true;
            epochTotalClaimed[epoch] += amount;
            totalAmount += amount;
            
            emit RewardClaimed(msg.sender, amount, epoch);
        }
        
        // Single transfer for all epochs
        (bool success, ) = msg.sender.call{value: totalAmount}("");
        require(success, "Transfer failed");
    }
    
    /**
     * @notice Check if an agent has claimed for a specific epoch
     */
    function hasClaimedEpoch(uint256 epoch, address agent) external view returns (bool) {
        return hasClaimed[epoch][agent];
    }
    
    /**
     * @notice Get epoch info
     */
    function getEpochInfo(uint256 epoch) 
        external 
        view 
        returns (
            bytes32 root,
            uint256 activationTime,
            bool isActive,
            uint256 totalClaimed
        ) 
    {
        root = epochRoots[epoch];
        activationTime = epochActivationTime[epoch];
        isActive = block.timestamp >= activationTime;
        totalClaimed = epochTotalClaimed[epoch];
    }
    
    /**
     * @notice Verify a Merkle proof without claiming
     * @dev Useful for frontends to validate before submitting tx
     */
    function verifyProof(
        uint256 epoch,
        address agent,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external view returns (bool) {
        if (epoch == 0 || epoch > currentEpoch) return false;
        
        bytes32 leaf = keccak256(abi.encodePacked(agent, amount));
        return MerkleProof.verify(merkleProof, epochRoots[epoch], leaf);
    }
    
    /**
     * @notice Update operator address (can be Gnosis Safe multisig)
     */
    function updateOperator(address newOperator) external onlyOwner {
        require(newOperator != address(0), "Invalid operator");
        emit OperatorUpdated(operator, newOperator);
        operator = newOperator;
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
    
    /**
     * @notice Receive ETH from RebatePoolManager
     */
    receive() external payable {}
    
    /**
     * @notice Emergency withdrawal (only owner, when paused)
     * @dev Safety measure if contract needs migration
     */
    function emergencyWithdraw() external onlyOwner {
        require(paused(), "Must be paused");
        (bool success, ) = owner().call{value: address(this).balance}("");
        require(success, "Withdrawal failed");
    }
}
