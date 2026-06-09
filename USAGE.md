# Ageback Usage API

A usage API for any x402-gated server. Built into `@ageback/middleware` so the live Ageback server and any partner integration get the same shape — revenue, requests, cashback allocations, and wallet rollups, per UTC day.

---

## Authentication

```
X-API-Key: ageback_<rest>
```
or
```
Authorization: Bearer ageback_<rest>
```

Keys are stored hashed (sha256). The raw key is shown exactly once at creation. Missing or revoked keys return `401 unauthorized`.

## Endpoints

| Path | Returns |
|---|---|
| `GET /usage/summary` | Full payload: window, generatedAt, revenue, requests, cashback, wallets |
| `GET /usage/revenue` | Revenue object only |
| `GET /usage/requests` | Request counts only |
| `GET /usage/wallets` | Payer statistics |
| `GET /usage/cashback` | Cashback allocations (count, total ETH, unique recipients) |

All endpoints return JSON with `Cache-Control: no-store`.

## Query parameters (window control)

| Parameter | Format | Default | Behavior |
|---|---|---|---|
| `start` | `YYYY-MM-DD` (UTC) | 6 days before today | Inclusive |
| `end` | `YYYY-MM-DD` (UTC) | Tomorrow | Exclusive |

- Maximum window: **366 days**
- Granularity: per UTC day only
- Both must be valid; `start < end`
- Invalid params → `400 bad_request` with `message`

## Response schema (`/usage/summary`)

```json
{
  "window": {
    "start": "2026-06-03T00:00:00.000Z",
    "end":   "2026-06-10T00:00:00.000Z",
    "startDay": "2026-06-03",
    "endDayExclusive": "2026-06-10"
  },
  "generatedAt": "2026-06-09T15:13:49.154Z",
  "revenue": {
    "totalUsd": 0.42,
    "paymentCount": 14,
    "uniquePayers": 3,
    "byProtocol": { "x402": { "totalUsd": 0.42, "count": 14 } },
    "byEndpoint": { "POST /v1/messages": { "totalUsd": 0.42, "count": 14 } }
  },
  "requests": {
    "total": 88, "paid": 14, "rejected_402": 7, "free": 67
  },
  "cashback": {
    "allocated": { "count": 14, "totalEth": 0.00084 },
    "recipients": { "uniqueInWindow": 3 }
  },
  "wallets": {
    "payersInWindow": 3,
    "cumulativePayers": 9,
    "firstTimePayersInWindow": ["0xabc...", "0xdef..."]
  }
}
```

Metric definitions:

- **paymentCount**: successful x402 payments in the window
- **uniquePayers / payersInWindow**: distinct payer wallets seen in the window
- **firstTimePayersInWindow**: wallets whose first-ever paying day falls in the window
- **cumulativePayers**: all-time unique payers since the store was deployed
- **rejected_402**: responses with HTTP 402 (payment required)
- **cashback.allocated.totalEth**: sum of rebate amounts allocated on-chain
- **cashback.recipients.uniqueInWindow**: distinct agent wallets that received cashback

> Metrics are forward-only — counters start from the deploy that introduces them. Existing on-chain `RebateAllocated` history is queryable via the public `GET /feed/cashback` endpoint.

---

## Key management

The Ageback server ships a CLI at `x402-server/scripts/usage-key.js`:

```bash
# inside x402-server/, with USAGE_KEYS_PATH set:
npm run usage:key -- create internal-dashboard
# => { "name": "internal-dashboard", "apiKey": "ageback_..." }
# (the raw key is shown once — store it now)

npm run usage:key -- list
# => [{ id, name, createdAt, lastUsedAt, revokedAt }, ...]

echo "ageback_existing" | npm run usage:key -- import bring-your-own
npm run usage:key -- revoke internal-dashboard
```

For ephemeral deploys without persistent disk, seed keys via env:

```env
AGEBACK_USAGE_API_KEYS=ageback_xxx,ageback_yyy
```

---

## Adding usage tracking to your own x402 server

The usage subsystem is part of `@ageback/middleware`:

```js
import express from "express";
import { attachUsageApi, attachAgeback } from "@ageback/middleware";

const app = express();
app.use(express.json());

const usage = await attachUsageApi(app, {
  storePath: process.env.USAGE_DB_PATH,     // ./data/usage.json
  keysPath:  process.env.USAGE_KEYS_PATH,   // ./data/keys.json
  envKeys:   process.env.AGEBACK_USAGE_API_KEYS,
});

const ageback = attachAgeback(app, {
  usageStore: usage.store,                  // pipe revenue + cashback into the store
  // ...other Ageback opts
});
```

`attachUsageApi` installs:
- A response-listener middleware that classifies every request as `paid` / `rejected_402` / `free` and rolls it up per UTC day.
- The `/usage/*` router behind API-key auth.

Passing `usageStore` to `attachAgeback` makes `allocateForRequest` also record revenue (USD) and on-chain cashback (ETH) into the same store.

---

## Storage

A single JSON file holds per-day rollups. Atomic writes via temp-file + rename. Writes are debounced (1.5s). Recommended on Render: mount a persistent disk and set `USAGE_DB_PATH=/var/data/usage.json`. Without a path, the store runs in-memory only and data is lost on restart (intended for local testing).
