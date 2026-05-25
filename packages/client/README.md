# @ageback/client

Agent-side helper for [Ageback](https://github.com/Pigitaiko/Ageback). Wraps your existing x402 `paidFetch` and returns a typed result that includes parsed cashback metadata. Also gives you thin clients for the public discovery endpoints (`/.well-known/ageback.json`, `/providers`, `/feed/cashback`) so aggregators and dashboards can list Ageback services with one HTTP call each.

No hard dependencies — uses your `paidFetch` (typically from `@x402/core/client` + `@x402/evm`) and `globalThis.fetch` for unauthenticated reads.

## Install

```bash
npm install @ageback/client
# plus whatever x402 client stack you're using:
npm install @x402/core @x402/evm viem
```

## Use

```js
import { createAgebackClient } from "@ageback/client";
import { createWalletClient, http, defineChain, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";

const taikoHoodi = defineChain({
  id: 167013, name: "Taiko Hoodi",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.hoodi.taiko.xyz"] } },
});

const wallet = createWalletClient({
  account: privateKeyToAccount(process.env.AGENT_PRIVATE_KEY),
  chain: taikoHoodi, transport: http(),
}).extend(publicActions);
wallet.address = wallet.account.address;

const client = new x402Client();
registerExactEvmScheme(client, { signer: toClientEvmSigner(wallet) });

const paidFetch = async (url, init) => {
  const c = new x402HTTPClient(client, url, { ...init, headers: init?.headers || {} });
  const r = await c.send();
  return r.response;
};

const ageback = createAgebackClient({ paidFetch });

// Discover before paying
const manifest = await ageback.discover("https://ageback.onrender.com");

// Pay + parse cashback in one call
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
// { enabled: true, network: "taiko-hoodi", agent: "0x...",
//   bps: 300, rebatePercent: "3.00%",
//   contract: "0x...", txHash: "0x..." }
```

## API surface

```ts
createAgebackClient({ paidFetch, fetch? }) => {
  fetch(url, init) => Promise<{ response, data, cashback }>
  discover(originUrl) => Promise<Manifest | null>
  listProviders(originUrl, { activeOnly? }) => Promise<{ providers, count, ... }>
  cashbackFeed(originUrl, { limit?, fromBlock? }) => Promise<{ items, ... }>
}
parseCashbackHeaders(headers) => CashbackMeta | null
```

## License

MIT
