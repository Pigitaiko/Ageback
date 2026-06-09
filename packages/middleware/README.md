# @ageback/middleware

Drop-in cashback layer for any [x402](https://www.x402.org/) Express server. Adds on-chain rebate allocation (Ageback protocol) plus discovery and event feeds that AgentCash, x402scan, and agent runtimes can ingest with no out-of-band coordination.

## Install

```bash
npm install @ageback/middleware ethers express @x402/express @x402/core @x402/evm
```

`ethers ^6` and `express ^4` are declared as `peerDependencies` so this package doesn't pull duplicates of what your server already has.

## Use

```js
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { attachAgeback } from "@ageback/middleware";

const app = express();
app.use(express.json());

const ageback = attachAgeback(app, {
  rpc: process.env.TAIKO_RPC,
  rebatePoolManager: process.env.REBATE_POOL_MANAGER,
  providerPrivateKey: process.env.PROVIDER_PRIVATE_KEY,
  service: { name: "My API", category: "data" },
});

const resourceServer = new x402ResourceServer(
  new HTTPFacilitatorClient({ url: "https://facilitator.taiko.xyz" })
);
resourceServer.register("eip155:167013", new ExactEvmScheme());

app.use(paymentMiddleware({
  "POST /my-route": {
    accepts: [ageback.buildAccepts({ price: "$0.01", payTo: process.env.PAY_TO })],
    description: "Paid route with Ageback cashback",
    mimeType: "application/json",
  },
}, resourceServer, undefined, undefined, true));

app.post("/my-route", (req, res) => {
  ageback.allocateForRequest(req, res, { paymentAmountUsd: "0.01" });
  res.json({ ok: true });
});

app.listen(4030);
```

## What it mounts for free

| Endpoint | Purpose | Cache |
|---|---|---|
| `GET /.well-known/ageback.json` | Service manifest (name, chain, contracts, rebate %) | 60s |
| `GET /.well-known/x402` | x402 discovery pointer | 60s |
| `GET /providers` | On-chain provider directory | 60s |
| `GET /feed/cashback` | Recent `RebateAllocated` events | 15s |

## Response headers on paid responses

```
X-Cashback-Enabled, X-Cashback-Network, X-Cashback-Contract,
X-Cashback-Agent, X-Cashback-Bps, X-Cashback-Tx
```

## 402 accepts advertisement

`ageback.buildAccepts(...)` injects the canonical `extensions["ageback.v1"]` block so x402 clients/explorers can discover cashback metadata directly from the 402 response. See the [`ageback.v1` extension schema](https://github.com/Pigitaiko/Ageback/blob/main/INTEGRATIONS.md#5-the-agebackv1-extension--schema).

## API surface

- `attachAgeback(app, opts)` — convenience: `createAgeback(opts)` + mount discovery/feeds. Returns the toolkit.
- `createAgeback(opts)` — just the toolkit, no auto-mount. Use this if you want to customize routes.
- `parsePayerFromHeader(paymentHeader)` — pure helper, exported for callers that want to inspect `X-PAYMENT` outside Express.

### `opts`

| Field | Required | Notes |
|---|---|---|
| `rpc` | yes | EVM RPC URL |
| `rebatePoolManager` | yes | `RebatePoolManager` address |
| `providerPrivateKey` | for writes | Without it, the toolkit runs in read-only mode (manifest + feeds still work) |
| `loyaltyTierManager` | optional | If set, `allocateForRequest` records tier transactions when an `agentId` is supplied |
| `referralGraph` | optional | If set, referral volume is updated per allocation |
| `network` | optional | `{ chainId, caip2, name, rpc, explorer }`. Defaults to Taiko Hoodi |
| `service` | optional | `{ name, description, category, icon, website }` for the manifest |
| `facilitator` | optional | Surfaced in the manifest |
| `fromBlock` | optional | Earliest block to scan for `ProviderRegistered` / `RebateAllocated` events |

## Usage API

`@ageback/middleware` also ships a `/usage/*` API for per-UTC-day rollups of revenue, requests, cashback, and wallets. Adds:

```js
import { attachAgeback, attachUsageApi } from "@ageback/middleware";

const usage = await attachUsageApi(app, {
  storePath: process.env.USAGE_DB_PATH,
  keysPath:  process.env.USAGE_KEYS_PATH,
  envKeys:   process.env.AGEBACK_USAGE_API_KEYS,
});
const ageback = attachAgeback(app, { usageStore: usage.store /* + other opts */ });
```

Mounts auth-gated `GET /usage/{summary,revenue,requests,wallets,cashback}` with UTC-day window control (`?start=YYYY-MM-DD&end=YYYY-MM-DD`). Full schema in [USAGE.md](https://github.com/Pigitaiko/Ageback/blob/main/USAGE.md).

## Versioning

`@ageback/middleware@0.x` — additive changes only; the `ageback.v1` wire format is stable. Breaking shape changes will ship as `1.x` with the previous major maintained for a quarter.

## License

MIT
