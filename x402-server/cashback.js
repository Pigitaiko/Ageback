import { ethers } from "ethers";

const REBATE_POOL_ABI = [
  "function allocateRebate(address agent, uint256 transactionAmount) external returns (uint256)",
  "function providers(address) external view returns (uint256 depositedAmount, uint256 allocatedRewards, uint256 rebatePercentage, bool isActive, uint256 registrationTime, uint256 pendingRebatePercentage, uint256 rebateUpdateEpoch, uint256 lastWithdrawalTime, uint256 weeklyWithdrawnAmount)",
  "function getProviderBalance(address provider) external view returns (uint256)",
  "function getActiveRebatePercentage(address provider) external view returns (uint256)",
  "event RebateAllocated(address indexed provider, address indexed agent, uint256 amount)",
];

const LOYALTY_TIER_ABI = [
  "function recordTransaction(uint256 agentId, uint256 txValue) external",
  "function calculateBoostedRebate(uint256 agentId, uint256 baseRebate) external view returns (uint256)",
  "function getTierMultiplier(uint256 agentId) external view returns (uint256)",
  "function getAgentStats(uint256 agentId) external view returns (uint256 totalTransactions, uint256 currentTier, uint256 currentMultiplier, uint256 accountAge, uint256 transactionsToNextTier, uint256 daysUntilNextTier)",
];

const REFERRAL_GRAPH_ABI = [
  "function updateReferralVolume(address referee, uint256 volume) external",
  "function getReferralBonus(address agent, uint256 baseRebate) external view returns (uint256 referrerBonus, uint256 refereeBonus)",
  "function getReferralInfo(address agent) external view returns (address referrer, uint256 totalVolume, bool bonusUnlocked, uint256 volumeUntilBonus, uint256 referralCount)",
];

let provider;
let signer;
let poolManager;
let tierManager;
let referralGraph;

export function initCashback(config) {
  provider = new ethers.JsonRpcProvider(config.taikoRpc);
  signer = new ethers.Wallet(config.providerPrivateKey, provider);
  poolManager = new ethers.Contract(
    config.rebatePoolManager,
    REBATE_POOL_ABI,
    signer
  );

  if (config.loyaltyTierManager) {
    tierManager = new ethers.Contract(
      config.loyaltyTierManager,
      LOYALTY_TIER_ABI,
      signer
    );
    console.log("[cashback] LoyaltyTierManager:", config.loyaltyTierManager);
  }

  if (config.referralGraph) {
    referralGraph = new ethers.Contract(
      config.referralGraph,
      REFERRAL_GRAPH_ABI,
      signer
    );
    console.log("[cashback] ReferralGraph:", config.referralGraph);
  }

  console.log("[cashback] Initialized");
  console.log("[cashback] Provider wallet:", signer.address);
  console.log("[cashback] RebatePoolManager:", config.rebatePoolManager);
}

/**
 * Trigger cashback allocation after a successful x402 payment.
 * Also records transaction for loyalty tiers and updates referral volume.
 */
export async function allocateCashback(agentAddress, paymentAmountUsd, agentId) {
  try {
    const txAmount = ethers.parseEther(paymentAmountUsd);

    // 1. Allocate rebate on-chain
    const tx = await poolManager.allocateRebate(agentAddress, txAmount);
    const receipt = await tx.wait();

    const event = receipt.logs
      .map((log) => {
        try { return poolManager.interface.parseLog(log); } catch { return null; }
      })
      .find((e) => e?.name === "RebateAllocated");

    const rebateAmount = event
      ? ethers.formatEther(event.args.amount)
      : "unknown";

    console.log(
      `[cashback] Allocated rebate: ${rebateAmount} ETH to ${agentAddress}`
    );

    // 2. Record transaction for loyalty tier progression (if agentId provided)
    if (tierManager && agentId) {
      try {
        const tierTx = await tierManager.recordTransaction(agentId, txAmount);
        await tierTx.wait();
        console.log(`[cashback] Recorded tier transaction for agent #${agentId}`);
      } catch (err) {
        console.warn(`[cashback] Tier recording failed (non-fatal): ${err.message}`);
      }
    }

    // 3. Update referral volume
    if (referralGraph) {
      try {
        const refTx = await referralGraph.updateReferralVolume(agentAddress, txAmount);
        await refTx.wait();
        console.log(`[cashback] Updated referral volume for ${agentAddress}`);
      } catch (err) {
        // This is expected to fail silently if agent has no referrer
        if (!err.message.includes("revert")) {
          console.warn(`[cashback] Referral volume update failed (non-fatal): ${err.message}`);
        }
      }
    }

    return {
      success: true,
      rebateAmount,
      txHash: receipt.hash,
      agent: agentAddress,
    };
  } catch (err) {
    console.error("[cashback] Failed to allocate:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Check provider's pool status.
 */
export async function getPoolStatus() {
  const providerAddr = signer.address;
  const info = await poolManager.providers(providerAddr);
  const balance = await poolManager.getProviderBalance(providerAddr);

  return {
    address: providerAddr,
    isActive: info.isActive,
    deposited: ethers.formatEther(info.depositedAmount),
    allocated: ethers.formatEther(info.allocatedRewards),
    available: ethers.formatEther(balance),
    rebatePercent: (Number(info.rebatePercentage) / 100).toFixed(1) + "%",
  };
}

/**
 * Get loyalty tier info for an agent.
 */
export async function getAgentTierInfo(agentId) {
  if (!tierManager) return null;
  try {
    const stats = await tierManager.getAgentStats(agentId);
    const tierNames = ["Bronze", "Silver", "Gold", "Platinum"];
    return {
      totalTransactions: Number(stats.totalTransactions),
      tier: tierNames[Number(stats.currentTier)] || `Tier ${stats.currentTier}`,
      multiplier: (Number(stats.currentMultiplier) / 10000).toFixed(1) + "x",
      accountAgeDays: Math.floor(Number(stats.accountAge) / 86400),
      transactionsToNextTier: Number(stats.transactionsToNextTier),
      daysUntilNextTier: Number(stats.daysUntilNextTier),
    };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Get referral info for an agent.
 */
export async function getAgentReferralInfo(agentAddress) {
  if (!referralGraph) return null;
  try {
    const info = await referralGraph.getReferralInfo(agentAddress);
    return {
      referrer: info.referrer === ethers.ZeroAddress ? null : info.referrer,
      totalVolume: ethers.formatEther(info.totalVolume),
      bonusUnlocked: info.bonusUnlocked,
      volumeUntilBonus: ethers.formatEther(info.volumeUntilBonus),
      referralCount: Number(info.referralCount),
    };
  } catch (err) {
    return { error: err.message };
  }
}
