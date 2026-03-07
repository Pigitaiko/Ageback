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

// Extend ExactEvmScheme to add Taiko Hoodi USDC support
class TaikoExactEvmScheme extends ExactEvmScheme {
  getDefaultAsset(network) {
    if (network === "eip155:167013") {
      return {
        address: "0xB0b25E80D3a97526b50a73Cb7cEdBCFd4016882F",
        name: "USD Coin",
        version: "2",
        decimals: 6,
      };
    }
    return super.getDefaultAsset(network);
  }
}

const app = express();
app.use(express.json());

// CORS for frontend
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-Payment, Payment-Signature");
  res.set("Access-Control-Expose-Headers", "X-Cashback-Enabled, X-Cashback-Network, X-Cashback-Contract, X-Cashback-Agent");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// --- Config ---
const PORT = process.env.PORT || 4020;
const PAY_TO = process.env.PAY_TO_ADDRESS;
const TAIKO_HOODI_NETWORK = "eip155:167013";
const FACILITATOR_URL =
  process.env.FACILITATOR_URL || "https://facilitator.taiko.xyz";

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
  taikoRpc: process.env.TAIKO_RPC || "https://rpc.hoodi.taiko.xyz",
  providerPrivateKey: process.env.PROVIDER_PRIVATE_KEY,
  rebatePoolManager: process.env.REBATE_POOL_MANAGER,
  loyaltyTierManager: process.env.LOYALTY_TIER_MANAGER,
  referralGraph: process.env.REFERRAL_GRAPH,
});

// --- x402 Setup: Taiko Hoodi facilitator + EVM scheme ---
const facilitatorClient = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
});

const resourceServer = new x402ResourceServer(facilitatorClient);
resourceServer.register(TAIKO_HOODI_NETWORK, new TaikoExactEvmScheme());

// Build route accepts for each model
const messageAccepts = Object.entries(MODEL_PRICING).map(([model, price]) => ({
  scheme: "exact",
  price,
  network: TAIKO_HOODI_NETWORK,
  payTo: PAY_TO,
}));

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
    network: TAIKO_HOODI_NETWORK,
    endpoints: {
      "POST /v1/messages": "Claude API (x402 payment required)",
      "GET /health": "Server status + pool info",
      "GET /info": "Full server info",
      "GET /cashback/status": "Cashback pool balance",
      "GET /loyalty/tier/:id": "Agent loyalty tier",
      "GET /referral/:agent": "Agent referral info",
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
      network: TAIKO_HOODI_NETWORK,
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
      network: TAIKO_HOODI_NETWORK,
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
  console.log(`\n=== x402 Cashback Server (Taiko Hoodi) ===`);
  console.log(`Port:        ${PORT}`);
  console.log(`Pay to:      ${PAY_TO}`);
  console.log(`Network:     ${TAIKO_HOODI_NETWORK}`);
  console.log(`Facilitator: ${FACILITATOR_URL}`);
  console.log(`Models:      ${Object.keys(MODEL_PRICING).join(", ")}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /v1/messages         Claude API (x402 gated + cashback)`);
  console.log(`  GET  /health              Server status + pool info`);
  console.log(`  GET  /info                Full server info (for frontend)`);
  console.log(`  GET  /cashback/status     Cashback pool balance`);
  console.log(`  GET  /loyalty/tier/:id    Agent loyalty tier info`);
  console.log(`  GET  /referral/:agent     Agent referral info`);
  console.log(`\nReady for agents!\n`);
});
