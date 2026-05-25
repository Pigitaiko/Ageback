// Ageback drop-in toolkit for x402 Express servers.
//
// Lets any x402-gated API add on-chain cashback in a few lines:
//
//   import express from "express";
//   import { attachAgeback } from "./middleware/ageback.js";
//   const app = express();
//   const ageback = attachAgeback(app, {
//     rpc: process.env.TAIKO_RPC,
//     providerPrivateKey: process.env.PROVIDER_PRIVATE_KEY,
//     rebatePoolManager: process.env.REBATE_POOL_MANAGER,
//     network: { chainId: 167013, caip2: "eip155:167013", name: "taiko-hoodi" },
//     service: { name: "My API", category: "data", description: "..." },
//   });
//   // ...register your x402 paymentMiddleware as usual, but use
//   //   ageback.buildAccepts({ price, payTo }) for accepts entries so 402
//   //   responses self-advertise cashback.
//   app.post("/your-paid-route", async (req, res) => {
//     await ageback.allocateForRequest(req, res, { paymentAmountUsd: "0.01" });
//     // ...your handler...
//   });
//
// What `attachAgeback` mounts for free:
//   GET /.well-known/ageback.json   machine-readable service manifest
//   GET /.well-known/x402           pointer to the ageback manifest
//   GET /providers                  on-chain provider directory (cached)
//   GET /feed/cashback              recent RebateAllocated events (cached)
//
// Headers set on paid responses when a payer is identified:
//   X-Cashback-Enabled, X-Cashback-Network, X-Cashback-Contract,
//   X-Cashback-Agent, X-Cashback-Bps, X-Cashback-Tx (after settle)

import { ethers } from "ethers";

const REBATE_POOL_ABI = [
  "function allocateRebate(address agent, uint256 transactionAmount) external returns (uint256)",
  "function providers(address) external view returns (uint256 depositedAmount, uint256 allocatedRewards, uint256 rebatePercentage, bool isActive, uint256 registrationTime, uint256 pendingRebatePercentage, uint256 rebateUpdateEpoch, uint256 lastWithdrawalTime, uint256 weeklyWithdrawnAmount)",
  "function providerMetadata(address) external view returns (string name, string description, string apiEndpoint, string category)",
  "function getProviderBalance(address provider) external view returns (uint256)",
  "function getActiveRebatePercentage(address provider) external view returns (uint256)",
  "function totalVolumeProcessed(address) external view returns (uint256)",
  "event ProviderRegistered(address indexed provider, uint256 initialDeposit, uint256 rebatePercentage, string name)",
  "event RebateAllocated(address indexed provider, address indexed agent, uint256 amount)",
  "event MetadataUpdated(address indexed provider)",
];

const LOYALTY_TIER_ABI = [
  "function recordTransaction(uint256 agentId, uint256 txValue) external",
  "function getAgentStats(uint256 agentId) external view returns (uint256 totalTransactions, uint256 currentTier, uint256 currentMultiplier, uint256 accountAge, uint256 transactionsToNextTier, uint256 daysUntilNextTier)",
];

const REFERRAL_GRAPH_ABI = [
  "function updateReferralVolume(address referee, uint256 volume) external",
  "function getReferralInfo(address agent) external view returns (address referrer, uint256 totalVolume, bool bonusUnlocked, uint256 volumeUntilBonus, uint256 referralCount)",
];

const DEFAULT_NETWORK = {
  chainId: 167013,
  caip2: "eip155:167013",
  name: "taiko-hoodi",
  rpc: "https://rpc.hoodi.taiko.xyz",
  explorer: "https://hoodi.taikoscan.io",
};

const PROVIDERS_TTL_MS = 60_000;
const FEED_TTL_MS = 15_000;
// Recent-event scan window for /feed/cashback when no fromBlock is given.
const FEED_MAX_BLOCKS = 25_000;
// Public Taiko Hoodi RPC caps eth_getLogs at 30k blocks/request; stay under.
const QUERY_CHUNK_BLOCKS = 25_000;

async function queryFilterChunked(contract, filter, fromBlock, toBlock) {
  const from = Number(fromBlock);
  const to = Number(toBlock);
  if (to - from <= QUERY_CHUNK_BLOCKS) {
    return await contract.queryFilter(filter, from, to);
  }
  const out = [];
  for (let start = from; start <= to; start += QUERY_CHUNK_BLOCKS + 1) {
    const end = Math.min(start + QUERY_CHUNK_BLOCKS, to);
    try {
      const evs = await contract.queryFilter(filter, start, end);
      if (evs.length) out.push(...evs);
    } catch {
      // skip the chunk on transient RPC errors; partial results are better than none
    }
  }
  return out;
}

export function parsePayerFromHeader(paymentHeader) {
  if (!paymentHeader) return null;
  const tryParse = (s) => {
    try {
      const o = JSON.parse(s);
      return o?.payload?.authorization?.from || o?.from || o?.payer || null;
    } catch {
      return null;
    }
  };
  let decoded = null;
  try {
    decoded = Buffer.from(paymentHeader, "base64").toString();
  } catch {
    decoded = null;
  }
  return (decoded && tryParse(decoded)) || tryParse(paymentHeader);
}

function readPayerFromReq(req) {
  const h = req.headers["x-payment"] || req.headers["payment-signature"];
  return parsePayerFromHeader(h);
}

export function createAgeback(opts) {
  const network = { ...DEFAULT_NETWORK, ...(opts.network || {}) };
  const rpc = opts.rpc || network.rpc;
  const service = opts.service || {};
  const fromBlock = Number(opts.fromBlock || 0);

  if (!opts.rebatePoolManager) {
    throw new Error("[ageback] rebatePoolManager address required");
  }

  // Read-only provider is always available.
  const readProvider = new ethers.JsonRpcProvider(rpc, {
    name: network.name,
    chainId: network.chainId,
    ensAddress: null,
  });

  const poolRead = new ethers.Contract(
    ethers.getAddress(opts.rebatePoolManager),
    REBATE_POOL_ABI,
    readProvider
  );

  // Signing provider only if a private key is supplied (read-only mode is supported).
  let signer = null;
  let poolWrite = null;
  let tierWrite = null;
  let referralWrite = null;

  if (opts.providerPrivateKey) {
    signer = new ethers.Wallet(opts.providerPrivateKey, readProvider);
    poolWrite = poolRead.connect(signer);
    if (opts.loyaltyTierManager) {
      tierWrite = new ethers.Contract(
        ethers.getAddress(opts.loyaltyTierManager),
        LOYALTY_TIER_ABI,
        signer
      );
    }
    if (opts.referralGraph) {
      referralWrite = new ethers.Contract(
        ethers.getAddress(opts.referralGraph),
        REFERRAL_GRAPH_ABI,
        signer
      );
    }
  }

  let providersCache = { at: 0, data: null };
  let feedCache = { at: 0, data: null };

  async function getRebateBps() {
    if (!signer) return null;
    try {
      const bps = await poolRead.getActiveRebatePercentage(signer.address);
      return Number(bps);
    } catch {
      return null;
    }
  }

  async function status() {
    if (!signer) return { mode: "read-only" };
    try {
      const info = await poolRead.providers(signer.address);
      const balance = await poolRead.getProviderBalance(signer.address);
      return {
        provider: signer.address,
        isActive: info.isActive,
        deposited: ethers.formatEther(info.depositedAmount),
        allocated: ethers.formatEther(info.allocatedRewards),
        available: ethers.formatEther(balance),
        rebateBps: Number(info.rebatePercentage),
        rebatePercent: (Number(info.rebatePercentage) / 100).toFixed(2) + "%",
      };
    } catch (err) {
      return { error: err.message };
    }
  }

  function manifest() {
    return {
      name: service.name || "Ageback service",
      description: service.description || "x402-gated API with on-chain cashback",
      category: service.category || null,
      icon: service.icon || null,
      website: service.website || null,
      x402: {
        version: "v2",
        facilitator: opts.facilitator || null,
        network: network.caip2,
      },
      cashback: {
        protocol: "ageback.v1",
        chain: {
          chainId: network.chainId,
          caip2: network.caip2,
          name: network.name,
          explorer: network.explorer,
        },
        contracts: {
          rebatePoolManager: opts.rebatePoolManager,
          loyaltyTierManager: opts.loyaltyTierManager || null,
          referralGraph: opts.referralGraph || null,
          rebateAccumulator: opts.rebateAccumulator || null,
        },
        provider: signer ? signer.address : null,
        feeds: {
          providers: "/providers",
          cashback: "/feed/cashback",
        },
      },
    };
  }

  function buildAccepts({ scheme = "exact", price, network: net, payTo, extra, model, rebateBpsHint }) {
    const caip2 = net || network.caip2;
    return {
      scheme,
      price,
      network: caip2,
      payTo,
      ...(extra ? { extra } : {}),
      extensions: {
        "ageback.v1": {
          rebatePoolManager: opts.rebatePoolManager,
          loyaltyTierManager: opts.loyaltyTierManager || undefined,
          referralGraph: opts.referralGraph || undefined,
          rebateBps: typeof rebateBpsHint === "number" ? rebateBpsHint : undefined,
          provider: signer ? signer.address : undefined,
          manifest: "/.well-known/ageback.json",
          model: model || undefined,
        },
      },
    };
  }

  async function allocateForRequest(req, res, { paymentAmountUsd, agentId } = {}) {
    const agentAddress = readPayerFromReq(req);
    const bps = await getRebateBps();

    if (res && agentAddress) {
      res.set("X-Cashback-Enabled", "true");
      res.set("X-Cashback-Network", network.name);
      res.set("X-Cashback-Contract", opts.rebatePoolManager);
      res.set("X-Cashback-Agent", agentAddress);
      if (bps != null) res.set("X-Cashback-Bps", String(bps));
    } else if (res) {
      res.set("X-Cashback-Enabled", signer ? "true" : "false");
      if (bps != null) res.set("X-Cashback-Bps", String(bps));
    }

    if (!signer || !poolWrite || !agentAddress) {
      return { success: false, reason: signer ? "no-payer" : "read-only" };
    }

    try {
      const txAmount = ethers.parseEther(String(paymentAmountUsd || "0"));
      const tx = await poolWrite.allocateRebate(agentAddress, txAmount);
      const receipt = await tx.wait();
      const event = receipt.logs
        .map((log) => {
          try { return poolWrite.interface.parseLog(log); } catch { return null; }
        })
        .find((e) => e?.name === "RebateAllocated");
      const rebateAmount = event ? ethers.formatEther(event.args.amount) : "unknown";
      if (res) res.set("X-Cashback-Tx", receipt.hash);

      if (tierWrite && agentId) {
        tierWrite.recordTransaction(agentId, txAmount).then((t) => t.wait()).catch(() => {});
      }
      if (referralWrite) {
        referralWrite.updateReferralVolume(agentAddress, txAmount).then((t) => t.wait()).catch(() => {});
      }

      return { success: true, rebateAmount, txHash: receipt.hash, agent: agentAddress };
    } catch (err) {
      return { success: false, error: err.message, agent: agentAddress };
    }
  }

  async function listProviders({ activeOnly = false } = {}) {
    const now = Date.now();
    if (providersCache.data && now - providersCache.at < PROVIDERS_TTL_MS) {
      return filterProviders(providersCache.data, activeOnly);
    }
    const latest = await readProvider.getBlockNumber();
    const start = fromBlock || 0;
    const events = await queryFilterChunked(
      poolRead,
      poolRead.filters.ProviderRegistered(),
      start,
      latest
    );
    const seen = new Set();
    const out = [];
    for (const ev of events) {
      const addr = ev.args.provider;
      if (seen.has(addr.toLowerCase())) continue;
      seen.add(addr.toLowerCase());
      try {
        const [p, md, bal] = await Promise.all([
          poolRead.providers(addr),
          poolRead.providerMetadata(addr),
          poolRead.getProviderBalance(addr),
        ]);
        out.push({
          address: addr,
          name: md.name,
          description: md.description,
          apiEndpoint: md.apiEndpoint,
          category: md.category,
          rebateBps: Number(p.rebatePercentage),
          rebatePercent: (Number(p.rebatePercentage) / 100).toFixed(2) + "%",
          isActive: p.isActive,
          registeredAt: Number(p.registrationTime),
          deposited: ethers.formatEther(p.depositedAmount),
          allocated: ethers.formatEther(p.allocatedRewards),
          available: ethers.formatEther(bal),
        });
      } catch {
        // skip if any read fails
      }
    }
    providersCache = { at: now, data: out };
    return filterProviders(out, activeOnly);
  }

  function filterProviders(list, activeOnly) {
    return activeOnly ? list.filter((p) => p.isActive) : list;
  }

  async function cashbackFeed({ limit = 100, fromBlock: fb } = {}) {
    const now = Date.now();
    const cacheKey = `${limit}:${fb || ""}`;
    if (feedCache.data && feedCache.key === cacheKey && now - feedCache.at < FEED_TTL_MS) {
      return feedCache.data;
    }
    const latest = await readProvider.getBlockNumber();
    const start = fb != null ? Number(fb) : Math.max(fromBlock || 0, latest - FEED_MAX_BLOCKS);
    const events = await queryFilterChunked(
      poolRead,
      poolRead.filters.RebateAllocated(),
      start,
      latest
    );
    const items = events.slice(-limit).map((ev) => ({
      provider: ev.args.provider,
      agent: ev.args.agent,
      amount: ethers.formatEther(ev.args.amount),
      amountWei: ev.args.amount.toString(),
      txHash: ev.transactionHash,
      blockNumber: ev.blockNumber,
      logIndex: ev.index,
      explorerUrl: `${network.explorer}/tx/${ev.transactionHash}`,
    })).reverse();
    const payload = {
      network: network.caip2,
      contract: opts.rebatePoolManager,
      fromBlock: start,
      toBlock: latest,
      count: items.length,
      items,
    };
    feedCache = { at: now, key: cacheKey, data: payload };
    return payload;
  }

  return {
    network,
    service,
    manifest,
    buildAccepts,
    allocateForRequest,
    parsePayer: readPayerFromReq,
    status,
    listProviders,
    cashbackFeed,
    _contracts: { poolRead, poolWrite, tierWrite, referralWrite },
  };
}

export function attachAgeback(app, opts) {
  const ag = createAgeback(opts);

  app.get("/.well-known/ageback.json", (req, res) => {
    res.set("Cache-Control", "public, max-age=60");
    res.json(ag.manifest());
  });

  app.get("/.well-known/x402", (req, res) => {
    res.set("Cache-Control", "public, max-age=60");
    res.json({
      version: "v2",
      network: ag.network.caip2,
      facilitator: opts.facilitator || null,
      extensions: {
        "ageback.v1": { manifest: "/.well-known/ageback.json" },
      },
    });
  });

  app.get("/providers", async (req, res) => {
    try {
      const activeOnly = req.query.active === "true" || req.query.active === "1";
      const list = await ag.listProviders({ activeOnly });
      res.set("Cache-Control", "public, max-age=60");
      res.json({
        network: ag.network.caip2,
        contract: opts.rebatePoolManager,
        count: list.length,
        providers: list,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/feed/cashback", async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const fb = req.query.fromBlock != null ? Number(req.query.fromBlock) : undefined;
      const data = await ag.cashbackFeed({ limit, fromBlock: fb });
      res.set("Cache-Control", "public, max-age=15");
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return ag;
}
