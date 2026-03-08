import "dotenv/config";
import { createWalletClient, http, defineChain, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";

// ─────────────────────────────────────────────
//  Ageback Demo Agent — x402 + Cashback on Taiko
// ─────────────────────────────────────────────

const taikoHoodi = defineChain({
  id: 167013,
  name: "Taiko Hoodi",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.hoodi.taiko.xyz"] } },
  blockExplorers: { default: { name: "Taikoscan", url: "https://hoodi.taikoscan.io" } },
});

// Agent wallet — use AGENT_PRIVATE_KEY or fall back to PROVIDER_PRIVATE_KEY for testing
const AGENT_KEY = process.env.AGENT_PRIVATE_KEY || process.env.PROVIDER_PRIVATE_KEY;
if (!AGENT_KEY) {
  console.error("Set AGENT_PRIVATE_KEY (or PROVIDER_PRIVATE_KEY) in .env");
  process.exit(1);
}

const account = privateKeyToAccount(AGENT_KEY);
const walletClient = createWalletClient({
  account, chain: taikoHoodi, transport: http(),
}).extend(publicActions);

// viem workaround: toClientEvmSigner expects .address at top level
walletClient.address = walletClient.account.address;

const signer = toClientEvmSigner(walletClient);
const client = new x402Client();
registerExactEvmScheme(client, { signer, networks: ["eip155:167013"] });
const httpClient = new x402HTTPClient(client);

// Use live server by default, override with SERVER_URL env var
const SERVER_URL = process.env.SERVER_URL || "https://ageback.onrender.com";

// Custom prompt via CLI arg: node test-agent.js "What is x402?"
const userPrompt = process.argv[2] || "Say hello in one sentence.";

async function main() {
  const url = `${SERVER_URL}/v1/messages`;
  const body = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 100,
    messages: [{ role: "user", content: userPrompt }],
  };

  console.log(`\n┌─────────────────────────────────────────┐`);
  console.log(`│  Ageback — x402 Cashback Demo Agent     │`);
  console.log(`└─────────────────────────────────────────┘`);
  console.log(`  Agent:   ${account.address}`);
  console.log(`  Server:  ${SERVER_URL}`);
  console.log(`  Prompt:  "${userPrompt}"`);

  // ── Step 1: Request without payment ──
  console.log(`\n── Step 1: Send request (expect 402) ──────`);

  const initialResp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  console.log(`  Status: ${initialResp.status}`);

  if (initialResp.status !== 402) {
    const text = await initialResp.text();
    console.log(`  Unexpected response:`, text.substring(0, 300));
    return;
  }

  // Parse payment requirements from response body
  let paymentRequired;
  try {
    const respBody = await initialResp.json();
    paymentRequired = respBody;
  } catch {
    const header = initialResp.headers.get("PAYMENT-REQUIRED");
    if (!header) { console.error("  No payment requirements found"); return; }
    paymentRequired = JSON.parse(Buffer.from(header, "base64").toString());
  }

  const accept = paymentRequired.accepts?.[0] || paymentRequired;
  console.log(`  Payment required:`);
  console.log(`    Amount:  ${accept.maxAmountRequired || accept.amount || "?"} (smallest unit)`);
  console.log(`    Asset:   ${accept.asset || "?"}`);
  console.log(`    Network: ${accept.network || "?"}`);
  console.log(`    Pay to:  ${accept.payTo || "?"}`);

  // ── Step 2: Sign x402 payment ──
  console.log(`\n── Step 2: Sign USDC payment (EIP-3009) ───`);

  const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

  console.log(`  Payment signed (transferWithAuthorization)`);
  console.log(`  Header: ${Object.keys(paymentHeaders)[0]}`);

  // ── Step 3: Retry with payment ──
  console.log(`\n── Step 3: Retry with payment ──────────────`);

  const paidResp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...paymentHeaders },
    body: JSON.stringify(body),
  });

  console.log(`  Status: ${paidResp.status}`);

  const cashbackEnabled = paidResp.headers.get("X-Cashback-Enabled");
  const cashbackAgent = paidResp.headers.get("X-Cashback-Agent");
  const cashbackContract = paidResp.headers.get("X-Cashback-Contract");

  const data = await paidResp.json();

  if (paidResp.ok) {
    console.log(`\n── Claude Response ─────────────────────────`);
    console.log(`  ${data.content?.[0]?.text || JSON.stringify(data)}`);

    console.log(`\n── Cashback Info ───────────────────────────`);
    console.log(`  Enabled:  ${cashbackEnabled || "false"}`);
    console.log(`  Agent:    ${cashbackAgent || "N/A"}`);
    console.log(`  Contract: ${cashbackContract || "N/A"}`);

    console.log(`\n┌─────────────────────────────────────────┐`);
    console.log(`│  Demo complete!                         │`);
    console.log(`│                                         │`);
    console.log(`│  Agent paid USDC -> Got Claude response  │`);
    console.log(`│  -> Cashback allocated on-chain          │`);
    console.log(`│                                         │`);
    console.log(`│  Explorer: https://hoodi.taikoscan.io   │`);
    console.log(`│  /address/${cashbackContract || "0x1571922009FC4a9ed68646b9722A9df6FB1fD11d"}`);
    console.log(`└─────────────────────────────────────────┘\n`);
  } else {
    console.log(`\n  Error:`, JSON.stringify(data, null, 2));
  }
}

main().catch((err) => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});
