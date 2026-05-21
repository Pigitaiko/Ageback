// Ageback agent-side helper — wraps the x402 paidFetch pattern and surfaces
// cashback metadata so agents/aggregators don't have to parse headers manually.
//
// Usage (agent side):
//
//   import { createAgebackClient } from "./sdk/ageback-fetch.js";
//   import { createWalletClient, http, defineChain, publicActions } from "viem";
//   import { privateKeyToAccount } from "viem/accounts";
//   import { x402Client, x402HTTPClient } from "@x402/core/client";
//   import { registerExactEvmScheme } from "@x402/evm/exact/client";
//   import { toClientEvmSigner } from "@x402/evm";
//
//   const wallet = createWalletClient({ ... }).extend(publicActions);
//   wallet.address = wallet.account.address;
//   const client = new x402Client();
//   registerExactEvmScheme(client, { signer: toClientEvmSigner(wallet) });
//   const paidFetch = (url, init) =>
//     new x402HTTPClient(client, url, { ...init, headers: init?.headers || {} })
//       .send().then(r => r.response);
//
//   const ageback = createAgebackClient({ paidFetch });
//   const result = await ageback.fetch("https://ageback.onrender.com/v1/messages", {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 50,
//       messages: [{ role: "user", content: "hi" }] }),
//   });
//   // result.data           -> parsed JSON body
//   // result.cashback       -> { enabled, agent, network, contract, bps, txHash }
//   // result.response       -> raw Response
//
// You can also use `discover(originUrl)` to pull a service's machine-readable
// manifest before sending a payment — useful for aggregators (agentcash) that
// want to surface "X% cashback on Taiko Hoodi" in their UI.

export function parseCashbackHeaders(headers) {
  const get = (k) =>
    typeof headers?.get === "function" ? headers.get(k) : headers?.[k] || headers?.[k.toLowerCase()];
  const enabled = get("X-Cashback-Enabled");
  if (!enabled) return null;
  const bpsRaw = get("X-Cashback-Bps");
  const bps = bpsRaw == null ? null : Number(bpsRaw);
  return {
    enabled: enabled === "true",
    network: get("X-Cashback-Network") || null,
    contract: get("X-Cashback-Contract") || null,
    agent: get("X-Cashback-Agent") || null,
    bps,
    rebatePercent: bps == null ? null : (bps / 100).toFixed(2) + "%",
    txHash: get("X-Cashback-Tx") || null,
  };
}

export function createAgebackClient({ paidFetch, fetch: rawFetch = globalThis.fetch } = {}) {
  if (!paidFetch) {
    throw new Error("[ageback] paidFetch is required (x402-signing fetch)");
  }
  return {
    async fetch(url, init) {
      const response = await paidFetch(url, init);
      const cashback = parseCashbackHeaders(response.headers);
      let data = null;
      const contentType = response.headers?.get?.("content-type") || "";
      try {
        data = contentType.includes("application/json")
          ? await response.json()
          : await response.text();
      } catch {
        data = null;
      }
      return { response, data, cashback };
    },

    async discover(originUrl) {
      const base = originUrl.replace(/\/+$/, "");
      try {
        const r = await rawFetch(`${base}/.well-known/ageback.json`);
        if (r.ok) return await r.json();
      } catch {
        // fall through
      }
      try {
        const r = await rawFetch(`${base}/.well-known/x402`);
        if (r.ok) return await r.json();
      } catch {
        // fall through
      }
      return null;
    },

    async listProviders(originUrl, { activeOnly = false } = {}) {
      const base = originUrl.replace(/\/+$/, "");
      const q = activeOnly ? "?active=true" : "";
      const r = await rawFetch(`${base}/providers${q}`);
      if (!r.ok) throw new Error(`/providers returned ${r.status}`);
      return await r.json();
    },

    async cashbackFeed(originUrl, { limit, fromBlock } = {}) {
      const base = originUrl.replace(/\/+$/, "");
      const params = new URLSearchParams();
      if (limit != null) params.set("limit", String(limit));
      if (fromBlock != null) params.set("fromBlock", String(fromBlock));
      const q = params.toString() ? `?${params.toString()}` : "";
      const r = await rawFetch(`${base}/feed/cashback${q}`);
      if (!r.ok) throw new Error(`/feed/cashback returned ${r.status}`);
      return await r.json();
    },
  };
}
