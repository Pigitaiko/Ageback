# Integrating with Ageback

Ageback is a cashback layer on top of [x402](https://www.x402.org/). Any x402-gated service can opt into it in a few lines, and any x402-aware explorer or aggregator can discover those services from on-chain state and a JSON manifest.

This document is the integration contract.

---

## 1. Service Provider — add Ageback to your x402 server

You already have an x402 Express server. Add five things:

```diff
+ import { attachAgeback } from "./middleware/ageback.js";

  const app = express();

+ const ageback = attachAgeback(app, {
+   rpc: process.env.TAIKO_RPC,
+   rebatePoolManager: process.env.REBATE_POOL_MANAGER,
+   providerPrivateKey: process.env.PROVIDER_PRIVATE_KEY,
+   service: { name: "My API", category: "data" },
+ });

  app.use(paymentMiddleware({
    "POST /my-route": {
-     accepts: [{ scheme: "exact", price: "$0.01", network: "eip155:167013", payTo: PAY_TO }],
+     accepts: [ageback.buildAccepts({ price: "$0.01", payTo: PAY_TO })],
      description: "...",
      mimeType: "application/json",
    },
  }, resourceServer, undefined, undefined, true));

  app.post("/my-route", async (req, res) => {
+   ageback.allocateForRequest(req, res, { paymentAmountUsd: "0.01" });
    // ...your handler...
  });
```

What you get:

| Endpoint | What it returns |
|---|---|
| `GET /.well-known/ageback.json` | Machine-readable manifest (name, contracts, chain, rebate %) |
| `GET /.well-known/x402` | x402 discovery pointer to the manifest |
| `GET /providers` | All Ageback providers on-chain (this contract), cached 60s |
| `GET /feed/cashback` | Recent `RebateAllocated` events, cached 15s |

Response headers Ageback sets on paid responses:

```
X-Cashback-Enabled: true
X-Cashback-Network: taiko-hoodi
X-Cashback-Contract: 0x1571922009FC4a9ed68646b9722A9df6FB1fD11d
X-Cashback-Agent:   0x<payer>
X-Cashback-Bps:     300
X-Cashback-Tx:      0x<rebate-tx-hash>
```

The accepts payload in the 402 response is extended with:

```json
{
  "scheme": "exact",
  "price": "$0.01",
  "network": "eip155:167013",
  "payTo": "0x...",
  "extensions": {
    "ageback.v1": {
      "rebatePoolManager": "0x1571922009FC4a9ed68646b9722A9df6FB1fD11d",
      "loyaltyTierManager": "0x126B3Ec653BD2ca9fe537b5A701bD94eDDFF1F6c",
      "referralGraph": "0xa9BCFa08f1A2A82339ecA528b58366923dC0B250",
      "provider": "0x...",
      "manifest": "/.well-known/ageback.json"
    }
  }
}
```

A full runnable example lives at [`examples/integrate-existing-x402-server.js`](./examples/integrate-existing-x402-server.js).

You also need to register your provider on-chain (one-time): visit the [Live Demo](https://pigitaiko.github.io/Ageback/) ➜ **My Provider** tab, or run `scripts/register-provider.js`.

---

## 2. AgentCash — routing agents to Ageback providers

[AgentCash](https://agentcash.dev/) routes agent payments to 600+ paywalled APIs. Ageback gives those payments a cashback layer with zero changes to the agent — the rebate is allocated by the provider's server after settlement.

To list / route to Ageback providers in AgentCash:

1. **Discover providers** by polling `GET /providers` on any Ageback server (or by reading `ProviderRegistered` events from the `RebatePoolManager` directly).

   ```bash
   curl https://ageback.onrender.com/providers
   ```

   Each entry is shaped:
   ```json
   {
     "address": "0x...",
     "name": "Ageback Claude Proxy",
     "description": "...",
     "apiEndpoint": "https://ageback.onrender.com",
     "category": "ai-inference",
     "rebateBps": 300,
     "rebatePercent": "3.00%",
     "isActive": true,
     "registeredAt": 1709712966,
     "deposited": "1.0",
     "available": "0.95"
   }
   ```

2. **Surface cashback in your UI**: read `extensions["ageback.v1"]` from the x402 402 response (or fetch `/.well-known/ageback.json`) to display "Earn X% cashback" next to the price.

3. **No payment-flow changes**: x402 settlement happens exactly as today. The provider's server reads `X-PAYMENT.payload.authorization.from`, calls `RebatePoolManager.allocateRebate(agent, amountWei)`, and the agent's wallet accrues a claim against the rebate pool.

4. **Verify the cashback was allocated** (optional, for receipts in the AgentCash dashboard): the response carries `X-Cashback-Tx` once settled, and `GET /feed/cashback?limit=50` returns recent allocations in JSON.

5. **Track tiers** (optional): if the agent passes their ERC-8004 token id as `X-Agent-Id`, the provider records the transaction against the `LoyaltyTierManager` for tier progression (Bronze → Platinum, 1.0x–1.5x multiplier).

---

## 3. x402scan — indexing Ageback

[x402scan](https://www.x402scan.com/) is an ecosystem explorer. Ageback exposes everything an explorer needs without RPC access or contract ABIs:

| Source | Use for |
|---|---|
| `GET /.well-known/ageback.json` | Service-level metadata: name, icon, category, chain, contracts, provider address |
| `GET /providers` | Directory listing — one HTTP request returns every Ageback-enabled service registered against the contract this server points at |
| `GET /feed/cashback?limit=200` | Recent `RebateAllocated` events with `provider`, `agent`, `amount`, `txHash`, `blockNumber`, `explorerUrl` — drop straight into a transaction list |
| `RebatePoolManager` events (on-chain) | Source of truth; the JSON feeds are caches over these |

Suggested ingestion:

1. Poll `/.well-known/ageback.json` of any candidate service to confirm it's Ageback-enabled and read its `cashback.contracts.rebatePoolManager`.
2. Use that contract address as the index key — multiple services can share one pool manager, and one service is one provider address on that contract.
3. Poll `/feed/cashback` every ~15s, or subscribe to `RebateAllocated` directly.
4. Surface the cashback rate by reading `extensions["ageback.v1"].rebateBps` from the 402 response or by calling `getActiveRebatePercentage(provider)` on the contract.

### Canonical contract addresses (Taiko Hoodi, chain 167013)

| Contract | Address |
|---|---|
| RebatePoolManager | `0x1571922009FC4a9ed68646b9722A9df6FB1fD11d` |
| LoyaltyTierManager | `0x126B3Ec653BD2ca9fe537b5A701bD94eDDFF1F6c` |
| ReferralGraph | `0xa9BCFa08f1A2A82339ecA528b58366923dC0B250` |
| RebateAccumulator | `0xc1c3Edd5C5fCb85a05A949E42E9A350837D1B781` |
| MockUSDC (testnet) | `0xB0b25E80D3a97526b50a73Cb7cEdBCFd4016882F` |

---

## 4. Agents — using `ageback-fetch`

Agents already paying with x402 don't need to do anything — cashback is server-side. But for richer UX (showing rebate in agent logs, discovering services), use the helper:

```js
import { createAgebackClient } from "./sdk/ageback-fetch.js";

const ageback = createAgebackClient({ paidFetch }); // your @x402 fetch

// Discover before sending
const manifest = await ageback.discover("https://ageback.onrender.com");
console.log(manifest.cashback.contracts.rebatePoolManager);

// Pay + parse cashback metadata in one call
const result = await ageback.fetch("https://ageback.onrender.com/v1/messages", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 50,
    messages: [{ role: "user", content: "hi" }],
  }),
});

console.log(result.data.content[0].text);
console.log(result.cashback);
// { enabled: true, network: "taiko-hoodi", agent: "0x...", bps: 300,
//   rebatePercent: "3.00%", contract: "0x...", txHash: "0x..." }
```

---

## 5. The `ageback.v1` extension — schema

What providers SHOULD include in their `accepts.extensions["ageback.v1"]`:

| Field | Type | Required | Notes |
|---|---|---|---|
| `rebatePoolManager` | address | yes | Contract holding the rebate pool |
| `provider` | address | yes | The on-chain provider entry the server settles to |
| `rebateBps` | number | recommended | Current active rate in basis points (300 = 3%) |
| `manifest` | string | recommended | Path or URL to `/.well-known/ageback.json` |
| `loyaltyTierManager` | address | optional | If the provider records tier progression |
| `referralGraph` | address | optional | If the provider records referral volume |
| `model` | string | optional | For multi-tier APIs (e.g. Claude model id) |

Clients/explorers MUST treat unknown fields as forward-compatible — Ageback may extend the schema with `v1.x` additions before bumping to `v2`.

---

## 6. Versioning

- `ageback.v1` — current. Additive changes only.
- Breaking changes ship as `ageback.v2` alongside `v1` for one full quarter.
