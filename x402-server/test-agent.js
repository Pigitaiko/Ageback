import "dotenv/config";
import { createWalletClient, createPublicClient, http, defineChain, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";

// --- Taiko Hoodi chain definition ---
const taikoHoodi = defineChain({
  id: 167013,
  name: "Taiko Hoodi",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.hoodi.taiko.xyz"] },
  },
  blockExplorers: {
    default: { name: "Taikoscan", url: "https://hoodi.taikoscan.io" },
  },
});

// --- Agent wallet setup ---
// Use a DIFFERENT key than the provider. For testing, we use the same one.
// In production, the agent would have its own wallet with USDC.
const AGENT_PRIVATE_KEY = process.env.PROVIDER_PRIVATE_KEY;
if (!AGENT_PRIVATE_KEY) {
  console.error("Set PROVIDER_PRIVATE_KEY in .env (or add AGENT_PRIVATE_KEY)");
  process.exit(1);
}

const account = privateKeyToAccount(AGENT_PRIVATE_KEY);
console.log("Agent wallet:", account.address);

const walletClient = createWalletClient({
  account,
  chain: taikoHoodi,
  transport: http(),
}).extend(publicActions);

// --- Build x402 client ---
// viem puts address at walletClient.account.address, but toClientEvmSigner expects .address
walletClient.address = walletClient.account.address;
const signer = toClientEvmSigner(walletClient);
const client = new x402Client();
registerExactEvmScheme(client, {
  signer,
  networks: ["eip155:167013"],
});

const httpClient = new x402HTTPClient(client);

// --- Make a paid request ---
const SERVER_URL = `http://localhost:${process.env.PORT || 4020}`;

async function main() {
  const url = `${SERVER_URL}/v1/messages`;
  const body = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 50,
    messages: [{ role: "user", content: "Say hello in one sentence." }],
  };

  console.log("\n=== Step 1: Initial request (expect 402) ===");

  // First request - get 402 with payment requirements
  const initialResp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  console.log("Status:", initialResp.status);

  if (initialResp.status !== 402) {
    console.log("Expected 402, got", initialResp.status);
    const text = await initialResp.text();
    console.log("Body:", text);
    return;
  }

  // Extract payment requirements from PAYMENT-REQUIRED header
  const paymentRequiredHeader = initialResp.headers.get("PAYMENT-REQUIRED");
  if (!paymentRequiredHeader) {
    console.error("No PAYMENT-REQUIRED header found");
    return;
  }

  const paymentRequired = JSON.parse(
    Buffer.from(paymentRequiredHeader, "base64").toString()
  );

  console.log("Payment required:");
  console.log("  x402 version:", paymentRequired.x402Version);
  console.log("  Options:", paymentRequired.accepts.length);
  console.log(
    "  Price:",
    paymentRequired.accepts[0].amount,
    "micro-USDC ($" +
      (Number(paymentRequired.accepts[0].amount) / 1e6).toFixed(4) +
      ")"
  );
  console.log("  Asset:", paymentRequired.accepts[0].asset);
  console.log("  Pay to:", paymentRequired.accepts[0].payTo);

  console.log("\n=== Step 2: Create payment signature ===");

  // Use x402 client to create signed payment payload
  const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

  console.log("Payment signed!");
  console.log("Header key:", Object.keys(paymentHeaders)[0]);

  console.log("\n=== Step 3: Retry with payment ===");

  // Retry with payment header
  const paidResp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...paymentHeaders,
    },
    body: JSON.stringify(body),
  });

  console.log("Status:", paidResp.status);

  // Check cashback headers
  const cashbackEnabled = paidResp.headers.get("X-Cashback-Enabled");
  const cashbackAgent = paidResp.headers.get("X-Cashback-Agent");
  console.log("Cashback enabled:", cashbackEnabled);
  console.log("Cashback agent:", cashbackAgent);

  const data = await paidResp.json();
  if (paidResp.ok) {
    console.log("\n=== Claude Response ===");
    console.log(data.content?.[0]?.text || JSON.stringify(data, null, 2));
    console.log("\n=== Success! ===");
    console.log("Agent paid USDC on Taiko Hoodi -> got Claude response -> cashback allocated!");
  } else {
    console.log("\nError response:", JSON.stringify(data, null, 2));
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
