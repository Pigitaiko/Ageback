import "dotenv/config";

// Prevent unhandled rejections from crashing the server
process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err.message || err);
});

import express from "express";
import {
  paymentMiddleware,
  x402ResourceServer,
} from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { initCashback, allocateCashback, getPoolStatus, getAgentTierInfo, getAgentReferralInfo } from "./cashback.js";
// Installed as a local file: dependency (see x402-server/package.json).
// External consumers do the same via `npm install @ageback/middleware`.
import { attachAgeback, attachUsageApi } from "@ageback/middleware";

// Network configs keyed by CHAIN env var
const NETWORK_CONFIGS = {
  "taiko-hoodi": {
    chainId: 167013,
    caip2: "eip155:167013",
    facilitator: "https://facilitator.taiko.xyz",
    rpcDefault: "https://rpc.hoodi.taiko.xyz",
    explorer: "https://hoodi.taikoscan.io",
    usdc: { address: "0xB0b25E80D3a97526b50a73Cb7cEdBCFd4016882F", name: "USD Coin", version: "2", decimals: 6 },
  },
  "base": {
    chainId: 8453,
    caip2: "eip155:8453",
    facilitator: "https://x402.org/facilitator",
    rpcDefault: "https://mainnet.base.org",
    explorer: "https://basescan.org",
    usdc: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", name: "USD Coin", version: "2", decimals: 6 },
  },
  "base-sepolia": {
    chainId: 84532,
    caip2: "eip155:84532",
    facilitator: "https://x402.org/facilitator",
    rpcDefault: "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org",
    usdc: { address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", name: "USD Coin", version: "2", decimals: 6 },
  },
};

const CHAIN = process.env.CHAIN || "taiko-hoodi";
const NET = NETWORK_CONFIGS[CHAIN];
if (!NET) throw new Error(`Unknown CHAIN: ${CHAIN}. Use taiko-hoodi, base, or base-sepolia`);

class ConfiguredEvmScheme extends ExactEvmScheme {
  getDefaultAsset(network) {
    if (network === NET.caip2) return NET.usdc;
    return super.getDefaultAsset(network);
  }
}

const app = express();
app.use(express.json());

// CORS for frontend
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-Payment, Payment-Signature, X-API-Key, Authorization");
  res.set("Access-Control-Expose-Headers", "X-Cashback-Enabled, X-Cashback-Network, X-Cashback-Contract, X-Cashback-Agent");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// --- Config ---
const PORT = process.env.PORT || 4020;
const PAY_TO = process.env.PAY_TO_ADDRESS;
const ACTIVE_NETWORK = NET.caip2;
const FACILITATOR_URL = process.env.FACILITATOR_URL || NET.facilitator;

// --- Pricing per model (USD) ---
const MODEL_PRICING = {
  "claude-haiku-4-5-20251001": "$0.006",
  "claude-sonnet-4-5-20250929": "$0.025",
  "claude-sonnet-4-6-20260320": "$0.025",
  "claude-opus-4-6": "$0.12",
};
const DEFAULT_PRICE = "$0.01";

// --- Initialize cashback module ---
initCashback({
  rpc: process.env.CHAIN_RPC || NET.rpcDefault,
  chainId: NET.chainId,
  providerPrivateKey: process.env.PROVIDER_PRIVATE_KEY,
  rebatePoolManager: process.env.REBATE_POOL_MANAGER,
  loyaltyTierManager: process.env.LOYALTY_TIER_MANAGER,
  referralGraph: process.env.REFERRAL_GRAPH,
});

// --- Usage tracking ---
// Mounts: /usage/{summary,revenue,requests,wallets,cashback} (auth-gated).
// Also installs a request recorder so every response is classified
// (paid / rejected_402 / free) and rolled up per UTC day.
const usage = await attachUsageApi(app, {
  storePath: process.env.USAGE_DB_PATH || null,
  keysPath: process.env.USAGE_KEYS_PATH || null,
  envKeys: process.env.AGEBACK_USAGE_API_KEYS || "",
});

// --- Ageback discovery + feeds (drop-in for any x402 server) ---
// Mounts: /.well-known/ageback.json, /.well-known/x402, /providers, /feed/cashback
// Allocation continues to flow through cashback.js so we don't double-pay.
const ageback = attachAgeback(app, {
  usageStore: usage.store,
  rpc: process.env.CHAIN_RPC || NET.rpcDefault,
  rebatePoolManager: process.env.REBATE_POOL_MANAGER,
  loyaltyTierManager: process.env.LOYALTY_TIER_MANAGER,
  referralGraph: process.env.REFERRAL_GRAPH,
  rebateAccumulator: process.env.REBATE_ACCUMULATOR,
  providerPrivateKey: process.env.PROVIDER_PRIVATE_KEY,
  facilitator: FACILITATOR_URL,
  fromBlock: Number(process.env.REBATE_POOL_DEPLOYED_BLOCK || 0),
  network: {
    chainId: NET.chainId,
    caip2: ACTIVE_NETWORK,
    name: CHAIN,
    rpc: process.env.CHAIN_RPC || NET.rpcDefault,
    explorer: NET.explorer,
  },
  service: {
    name: "Ageback Claude Proxy",
    description: `Payment-gated Claude API with on-chain cashback on ${CHAIN}`,
    category: "ai-inference",
    website: "https://github.com/Pigitaiko/Ageback",
  },
});

// --- x402 Setup: facilitator + EVM scheme ---
const facilitatorClient = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
});

const resourceServer = new x402ResourceServer(facilitatorClient);
resourceServer.register(ACTIVE_NETWORK, new ConfiguredEvmScheme());

// Build route accepts for each model — embeds the ageback.v1 extension so
// x402-aware clients/explorers (x402scan, agentcash) can discover cashback.
const messageAccepts = Object.entries(MODEL_PRICING).map(([model, price]) =>
  ageback.buildAccepts({
    scheme: "exact",
    price,
    network: ACTIVE_NETWORK,
    payTo: PAY_TO,
    model,
  })
);

// Apply x402 payment middleware — only gates POST /v1/messages
app.use(
  paymentMiddleware(
    {
      "POST /v1/messages": {
        accepts: messageAccepts,
        description: "Claude API call with cashback (pay in USDC on Taiko Hoodi)",
        mimeType: "application/json",
      },
    },
    resourceServer,
    undefined, // no paywall config
    undefined, // no custom paywall
    true, // sync facilitator on start
  )
);

// --- Extract payer address from X-PAYMENT header ---
function extractPayerAddress(paymentHeader) {
  if (!paymentHeader) return null;
  try {
    // x402 v2: payment header is base64-encoded JSON
    const decoded = JSON.parse(
      Buffer.from(paymentHeader, "base64").toString()
    );
    // The payload contains the authorization with 'from' field
    return (
      decoded?.payload?.authorization?.from ||
      decoded?.from ||
      decoded?.payer ||
      null
    );
  } catch {
    try {
      const parsed = JSON.parse(paymentHeader);
      return (
        parsed?.payload?.authorization?.from ||
        parsed?.from ||
        parsed?.payer ||
        null
      );
    } catch {
      return null;
    }
  }
}

// --- Routes ---

// Landing page
app.get("/", (req, res) => {
  res.json({
    name: "Ageback — x402 Cashback Protocol",
    description: "Payment-gated Claude API with automatic cashback on Taiko Hoodi",
    network: ACTIVE_NETWORK,
    endpoints: {
      "POST /v1/messages": "Claude API (x402 payment required)",
      "GET /health": "Server status + pool info",
      "GET /info": "Full server info",
      "GET /cashback/status": "Cashback pool balance",
      "GET /loyalty/tier/:id": "Agent loyalty tier",
      "GET /referral/:agent": "Agent referral info",
      "GET /providers": "On-chain Ageback provider directory",
      "GET /feed/cashback": "Recent RebateAllocated events (JSON feed)",
      "GET /.well-known/ageback.json": "Machine-readable service manifest",
      "GET /.well-known/x402": "x402 discovery pointer",
    },
    github: "https://github.com/Pigitaiko/Ageback",
  });
});

// Health check + pool status (free, no payment required)
app.get("/health", async (req, res) => {
  try {
    const pool = await getPoolStatus();
    res.json({
      status: "ok",
      facilitator: FACILITATOR_URL,
      network: ACTIVE_NETWORK,
      cashbackPool: pool,
      pricing: MODEL_PRICING,
    });
  } catch (err) {
    res.json({ status: "ok", cashbackError: err.message });
  }
});

// Claude API proxy — x402 middleware handles payment gating automatically
// By the time this handler runs, payment has been verified.
app.post("/v1/messages", async (req, res) => {
  const model = req.body?.model || "claude-sonnet-4-5-20250929";
  const price = MODEL_PRICING[model] || DEFAULT_PRICE;

  // Extract payer address for cashback
  const paymentHeader =
    req.headers["x-payment"] || req.headers["payment-signature"];
  const agentAddress = extractPayerAddress(paymentHeader);

  // Trigger cashback asynchronously (don't block the Claude response)
  if (agentAddress) {
    const priceNum = price.replace("$", "");
    const agentId = req.headers["x-agent-id"] || null; // ERC-8004 token ID for tier tracking
    allocateCashback(agentAddress, priceNum, agentId).then((result) => {
      if (result.success) {
        console.log(
          `[cashback] ${result.rebateAmount} ETH -> ${agentAddress} (tx: ${result.txHash})`
        );
      }
    });
  }

  // Proxy to upstream Claude API
  try {
    const upstreamResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });

    const data = await upstreamResp.json();

    // Add cashback metadata to response headers
    res.set("X-Cashback-Enabled", "true");
    res.set("X-Cashback-Network", "taiko-hoodi");
    res.set("X-Cashback-Contract", process.env.REBATE_POOL_MANAGER || "");
    if (agentAddress) {
      res.set("X-Cashback-Agent", agentAddress);
    }

    res.status(upstreamResp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "Upstream API error", message: err.message });
  }
});

// Cashback pool status (free)
app.get("/cashback/status", async (req, res) => {
  try {
    const pool = await getPoolStatus();
    res.json(pool);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cashback history for an agent (free)
app.get("/cashback/history/:agent", async (req, res) => {
  res.json({
    agent: req.params.agent,
    note: "Query RebateAllocated events from the contract for full history",
    contract: process.env.REBATE_POOL_MANAGER,
    explorer: `https://hoodi.taikoscan.io/address/${process.env.REBATE_POOL_MANAGER}`,
  });
});

// Loyalty tier info for an agent (free)
app.get("/loyalty/tier/:agentId", async (req, res) => {
  try {
    const info = await getAgentTierInfo(req.params.agentId);
    if (!info) return res.json({ error: "LoyaltyTierManager not configured" });
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Referral info for an agent (free)
app.get("/referral/:agent", async (req, res) => {
  try {
    const info = await getAgentReferralInfo(req.params.agent);
    if (!info) return res.json({ error: "ReferralGraph not configured" });
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Server info endpoint for frontend discovery
app.get("/info", async (req, res) => {
  try {
    const pool = await getPoolStatus();
    res.json({
      server: "x402-cashback-server",
      version: "1.0.0",
      network: ACTIVE_NETWORK,
      facilitator: FACILITATOR_URL,
      payTo: PAY_TO,
      pricing: MODEL_PRICING,
      cashbackPool: pool,
      contracts: {
        RebatePoolManager: process.env.REBATE_POOL_MANAGER,
        LoyaltyTierManager: process.env.LOYALTY_TIER_MANAGER || null,
        ReferralGraph: process.env.REFERRAL_GRAPH || null,
      },
      mockUsdc: process.env.MOCK_USDC || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n=== x402 Cashback Server (${CHAIN}) ===`);
  console.log(`Port:        ${PORT}`);
  console.log(`Pay to:      ${PAY_TO}`);
  console.log(`Network:     ${ACTIVE_NETWORK}`);
  console.log(`Facilitator: ${FACILITATOR_URL}`);
  console.log(`Models:      ${Object.keys(MODEL_PRICING).join(", ")}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /v1/messages         Claude API (x402 gated + cashback)`);
  console.log(`  GET  /health              Server status + pool info`);
  console.log(`  GET  /info                Full server info (for frontend)`);
  console.log(`  GET  /cashback/status     Cashback pool balance`);
  console.log(`  GET  /loyalty/tier/:id    Agent loyalty tier info`);
  console.log(`  GET  /referral/:agent     Agent referral info`);
  console.log(`  GET  /providers           On-chain provider directory`);
  console.log(`  GET  /feed/cashback       Recent RebateAllocated events`);
  console.log(`  GET  /.well-known/ageback.json   Service manifest`);
  console.log(`  GET  /.well-known/x402           x402 discovery`);
  console.log(`  GET  /usage/summary       Usage rollup (auth required)`);
  console.log(`  GET  /usage/{revenue,requests,wallets,cashback}  (auth required)`);
  console.log(`\nReady for agents!\n`);
});
