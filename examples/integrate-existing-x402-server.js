// Example: minimal x402 Express server that adds Ageback cashback.
//
// This is what an AgentCash-listed API or any other x402-gated service would
// add to enable on-chain cashback for paying agents. The "5-line diff" is
// marked with [+] comments.
//
// Run:
//   cd x402-server && npm install
//   node ../examples/integrate-existing-x402-server.js
//
// Env required:
//   PAY_TO_ADDRESS, PROVIDER_PRIVATE_KEY, REBATE_POOL_MANAGER, TAIKO_RPC
//
// What this demonstrates:
// 1. An ordinary x402-gated POST /quote endpoint (paid in USDC on Taiko Hoodi).
// 2. Cashback is wired in by importing attachAgeback, calling it once on the
//    app, and then either:
//      (a) using ageback.buildAccepts(...) so 402 responses advertise
//          the ageback.v1 extension and clients/explorers can auto-discover, AND
//      (b) calling ageback.allocateForRequest(req, res, { paymentAmountUsd })
//          inside the paid handler to allocate rebate on-chain.

import "dotenv/config";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

// [+] 1. Import the Ageback toolkit.
import { attachAgeback } from "../x402-server/middleware/ageback.js";

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

const PORT = process.env.PORT || 4030;
const PAY_TO = process.env.PAY_TO_ADDRESS;
const NETWORK = "eip155:167013";
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://facilitator.taiko.xyz";

// [+] 2. Attach Ageback. This mounts /.well-known/ageback.json,
//        /.well-known/x402, /providers, /feed/cashback and gives you
//        helpers to build accepts and allocate rebates.
const ageback = attachAgeback(app, {
  rpc: process.env.TAIKO_RPC || "https://rpc.hoodi.taiko.xyz",
  rebatePoolManager: process.env.REBATE_POOL_MANAGER,
  loyaltyTierManager: process.env.LOYALTY_TIER_MANAGER,
  referralGraph: process.env.REFERRAL_GRAPH,
  providerPrivateKey: process.env.PROVIDER_PRIVATE_KEY,
  facilitator: FACILITATOR_URL,
  fromBlock: Number(process.env.REBATE_POOL_DEPLOYED_BLOCK || 0),
  service: {
    name: "Example Quote API",
    description: "Returns a fake quote string for $0.005",
    category: "data",
  },
});

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient);
resourceServer.register(NETWORK, new TaikoExactEvmScheme());

const PRICE = "$0.005";

app.use(
  paymentMiddleware(
    {
      // [+] 3. buildAccepts injects the ageback.v1 extension so x402scan /
      //        agentcash can read the cashback metadata directly from the 402.
      "POST /quote": {
        accepts: [ageback.buildAccepts({ price: PRICE, payTo: PAY_TO, network: NETWORK })],
        description: "Get a quote (paid, with Ageback cashback)",
        mimeType: "application/json",
      },
    },
    resourceServer,
    undefined,
    undefined,
    true
  )
);

app.post("/quote", async (req, res) => {
  // [+] 4. Fire-and-forget rebate allocation. Also sets X-Cashback-* headers.
  ageback.allocateForRequest(req, res, { paymentAmountUsd: "0.005" }).then((r) => {
    if (r.success) console.log(`[ageback] rebate ${r.rebateAmount} -> ${r.agent} (${r.txHash})`);
  });

  res.json({
    quote: `BTC/USD ${(60000 + Math.random() * 1000).toFixed(2)}`,
    issuedAt: new Date().toISOString(),
  });
});

app.get("/", (req, res) => {
  res.json({
    name: "Example x402 service with Ageback",
    paidRoute: "POST /quote",
    discovery: ["/.well-known/ageback.json", "/.well-known/x402"],
    feeds: ["/providers", "/feed/cashback"],
  });
});

app.listen(PORT, () => {
  console.log(`Example x402 + Ageback server on :${PORT}`);
  console.log(`  POST /quote                       (paid ${PRICE} USDC on Taiko Hoodi)`);
  console.log(`  GET  /.well-known/ageback.json    (service manifest)`);
  console.log(`  GET  /providers                   (on-chain directory)`);
  console.log(`  GET  /feed/cashback               (recent rebates)`);
});
