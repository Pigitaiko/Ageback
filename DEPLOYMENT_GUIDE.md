# X402 Cashback Protocol - Hardened Contracts Deployment Guide

## What's Been Solved

All critical security issues from Section 6 have been implemented in the contracts:

### ✅ Fully Solved

1. **Withdrawal Functionality** (RebatePoolManager.sol)
   - 30-day deposit lock period
   - 20% weekly withdrawal limits
   - Proper accounting to prevent overdraft
   - `getWithdrawalInfo()` helper for frontends

2. **Circuit Breaker** (All Contracts)
   - Pausable functionality via OpenZeppelin
   - Guardian role: can pause, cannot unpause
   - Owner: can pause and unpause

3. **Transaction Validation** (LoyaltyTierManager.sol)
   - Minimum transaction value: $0.001
   - Daily velocity cap: 1000 txs/day max
   - 30-day account age for Tier 3+
   - Authorized caller system

4. **Referral Anti-Sybil** (ReferralGraph.sol)
   - $1 minimum volume before bonuses unlock
   - Immutable referrer assignment
   - Volume tracking per referee

5. **Merkle Root Security** (RebateAccumulator.sol)
   - 24-hour activation delay
   - Support for multisig operator (Gnosis Safe compatible)
   - Batch claiming (save gas)
   - Proof verification helper
   - Public audit trail via events

### ⚠️ Still Needs External Setup

1. **Multisig Operator**: Deploy Gnosis Safe, set as operator
2. **ERC-8004 Contract**: Deploy or use existing identity system
3. **Off-Chain Accumulator**: PostgreSQL + Merkle tree service
4. **Security Audit**: Trail of Bits, Code4rena, Certora

---

## Contract Architecture

```
RebatePoolManager (Pool & Withdrawal Logic)
         ↓
    allocateRebate() 
         ↓
LoyaltyTierManager (Tier Multipliers)
         ↓
    recordTransaction()
         ↓
ReferralGraph (Referral Bonuses)
         ↓
    updateReferralVolume()
         ↓
RebateAccumulator (Batch Claims)
         ↓
    claimRebate()
```

---

## Deployment Order (Taiko Hoodi Testnet)

### Prerequisites
```bash
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox
npm install @openzeppelin/contracts
```

### Step 1: Deploy ERC-8004 Identity (Mock for Testing)
```solidity
// MockERC8004.sol (for testing)
contract MockERC8004 {
    mapping(uint256 => address) public owners;
    mapping(uint256 => uint256) public reputation;
    uint256 public nextTokenId = 1;
    
    function mint(address to) external returns (uint256) {
        uint256 tokenId = nextTokenId++;
        owners[tokenId] = to;
        reputation[tokenId] = 100; // Default reputation
        return tokenId;
    }
    
    function ownerOf(uint256 tokenId) external view returns (address) {
        return owners[tokenId];
    }
    
    function getReputation(uint256 tokenId) external view returns (uint256) {
        return reputation[tokenId];
    }
}
```

### Step 2: Deploy Core Contracts

```javascript
// scripts/deploy.js
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  
  // 1. Deploy Mock ERC-8004 (or use existing)
  const ERC8004 = await hre.ethers.getContractFactory("MockERC8004");
  const identity = await ERC8004.deploy();
  await identity.deployed();
  console.log("ERC-8004 Identity:", identity.address);
  
  // 2. Deploy RebatePoolManager
  const PoolManager = await hre.ethers.getContractFactory("RebatePoolManager");
  const poolManager = await PoolManager.deploy();
  await poolManager.deployed();
  console.log("RebatePoolManager:", poolManager.address);
  
  // 3. Deploy LoyaltyTierManager
  const TierManager = await hre.ethers.getContractFactory("LoyaltyTierManager");
  const tierManager = await TierManager.deploy(identity.address);
  await tierManager.deployed();
  console.log("LoyaltyTierManager:", tierManager.address);
  
  // 4. Deploy ReferralGraph
  const ReferralGraph = await hre.ethers.getContractFactory("ReferralGraph");
  const referralGraph = await ReferralGraph.deploy();
  await referralGraph.deployed();
  console.log("ReferralGraph:", referralGraph.address);
  
  // 5. Deploy RebateAccumulator
  const Accumulator = await hre.ethers.getContractFactory("RebateAccumulator");
  const accumulator = await Accumulator.deploy(
    poolManager.address,
    deployer.address // Operator (replace with Gnosis Safe on mainnet)
  );
  await accumulator.deployed();
  console.log("RebateAccumulator:", accumulator.address);
  
  // 6. Wire up authorizations
  await tierManager.addAuthorizedCaller(poolManager.address);
  await referralGraph.addAuthorizedCaller(poolManager.address);
  
  console.log("\n✅ Deployment complete!");
  console.log("\nAddresses:");
  console.log("ERC-8004:", identity.address);
  console.log("PoolManager:", poolManager.address);
  console.log("TierManager:", tierManager.address);
  console.log("ReferralGraph:", referralGraph.address);
  console.log("Accumulator:", accumulator.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

### Step 3: Verify Contracts on Explorer
```bash
npx hardhat verify --network taikoHoodi <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

---

## Testing Checklist

### Unit Tests (Foundry or Hardhat)

```solidity
// test/RebatePoolManager.test.js
describe("RebatePoolManager", function() {
  it("Should enforce 30-day withdrawal lock", async function() {
    // Register provider with 1 ETH
    await poolManager.registerProvider(300, "Test", "Desc", "https://api.test", "AI", { value: ethers.parseEther("1") });
    
    // Try to withdraw immediately (should fail)
    await expect(
      poolManager.withdrawDeposit(ethers.parseEther("0.1"))
    ).to.be.revertedWith("Deposit still locked");
    
    // Fast-forward 30 days
    await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");
    
    // Should now succeed
    await expect(
      poolManager.withdrawDeposit(ethers.parseEther("0.1"))
    ).to.not.be.reverted;
  });
  
  it("Should enforce 20% weekly withdrawal limit", async function() {
    // Register with 1 ETH
    await poolManager.registerProvider(300, "Test", "Desc", "https://api.test", "AI", { value: ethers.parseEther("1") });
    
    // Fast-forward 30 days
    await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60]);
    
    // Withdraw 0.2 ETH (20% - should succeed)
    await poolManager.withdrawDeposit(ethers.parseEther("0.2"));
    
    // Try to withdraw another 0.2 ETH same week (should fail)
    await expect(
      poolManager.withdrawDeposit(ethers.parseEther("0.2"))
    ).to.be.revertedWith("Weekly withdrawal limit exceeded");
  });
  
  it("Should pause when circuit breaker triggered", async function() {
    await poolManager.pause();
    
    await expect(
      poolManager.registerProvider(300, "Test", "Desc", "https://api.test", "AI", { value: ethers.parseEther("1") })
    ).to.be.revertedWith("Pausable: paused");
  });
});
```

### Integration Tests

```javascript
describe("Full Rebate Flow", function() {
  it("Should allocate, track, and claim rebates", async function() {
    // 1. Provider registers
    await poolManager.connect(provider).registerProvider(
      300, "AI API", "Desc", "https://api.test", "AI",
      { value: ethers.parseEther("5") }
    );
    
    // 2. Agent makes transaction
    const tx = await poolManager.connect(provider).allocateRebate(
      agent.address,
      ethers.parseEther("0.01") // $0.01 transaction
    );
    
    // 3. Check rebate allocated (3% of 0.01 = 0.0003)
    const receipt = await tx.wait();
    const event = receipt.events.find(e => e.event === "RebateAllocated");
    expect(event.args.amount).to.equal(ethers.parseEther("0.0003"));
    
    // 4. Tier manager records transaction
    await tierManager.connect(poolManager).recordTransaction(
      agentTokenId, 
      ethers.parseEther("0.01")
    );
    
    // 5. Check tier progresses
    const stats = await tierManager.getAgentStats(agentTokenId);
    expect(stats.totalTransactions).to.equal(1);
  });
});
```

---

## Production Hardening Checklist

### Before Mainnet Launch

- [ ] Deploy Gnosis Safe 2-of-3 multisig
- [ ] Set multisig as operator in RebateAccumulator
- [ ] Deploy to Taiko mainnet
- [ ] Transfer ownership to multisig or DAO
- [ ] Complete Trail of Bits audit ($60K, 4-6 weeks)
- [ ] Fix all critical/high findings
- [ ] Run Code4rena public contest ($20K)
- [ ] Launch Immunefi bug bounty ($50K pool)
- [ ] Set up monitoring/alerts (Tenderly, OpenZeppelin Defender)
- [ ] Document incident response procedures
- [ ] Test emergency pause on testnet
- [ ] Verify all contracts on Taiko explorer

### Multisig Setup (Gnosis Safe)

```javascript
// 1. Deploy Gnosis Safe with 2-of-3 signers
// Use https://app.safe.global

// 2. Update operator
await accumulator.updateOperator(GNOSIS_SAFE_ADDRESS);

// 3. Test multisig operation
// Signers create transaction to update Merkle root
// Requires 2/3 signatures to execute
```

---

## Gas Cost Estimates (Taiko Hoodi)

| Operation | Gas Used | Cost @ 0.5 gwei |
|-----------|----------|-----------------|
| Register Provider | ~250K | $0.125 |
| Allocate Rebate | ~80K | $0.04 |
| Record Transaction | ~60K | $0.03 |
| Update Merkle Root | ~50K | $0.025 |
| Claim Rebate (single) | ~51K | $0.026 |
| Batch Claim (5 epochs) | ~150K | $0.075 |

**Break-even:** Agents should accumulate >$0.05 before claiming.

---

## Monitoring & Alerts

### Recommended Setup (OpenZeppelin Defender)

```javascript
// Sentinel alerts
{
  "pauseAlert": {
    "contract": "RebatePoolManager",
    "event": "Paused",
    "notification": "Slack + Email"
  },
  "lowPoolBalance": {
    "contract": "RebatePoolManager",
    "condition": "depositedAmount - allocatedRewards < 0.1 ETH",
    "notification": "Provider Dashboard"
  },
  "largeClaim": {
    "contract": "RebateAccumulator",
    "event": "RewardClaimed",
    "condition": "amount > 1 ETH",
    "notification": "Team Slack"
  }
}
```

---

## Next Steps

1. **This Week:** Test contracts on Taiko Hoodi
2. **Week 2-3:** Build off-chain accumulator service
3. **Week 4:** Launch testnet with 3 pilot providers
4. **Week 5-8:** Security audit
5. **Week 9:** Mainnet deployment

---

## Support & Resources

- **Contracts:** `/mnt/user-data/outputs/contracts/`
- **Taiko Docs:** https://docs.taiko.xyz
- **Gnosis Safe:** https://app.safe.global
- **OpenZeppelin Defender:** https://defender.openzeppelin.com

**Status:** Production-ready pending audit ✅
