# Ageback — Live Demo Runbook

## Prep (2 min before)

1. Open browser tabs:
   - **Tab 1**: https://pigitaiko.github.io/Ageback/ (frontend)
   - **Tab 2**: https://ageback.onrender.com/health (wake server)
   - **Tab 3**: https://hoodi.taikoscan.io/address/0x1571922009FC4a9ed68646b9722A9df6FB1fD11d (explorer)
2. Connect MetaMask to Taiko Hoodi (chain 167013)
3. Terminal open in `x402-server/` with `.env` configured
4. Verify server is awake (Tab 2 shows JSON)

---

## Demo Script (~5 min)

### 1. Intro (30s)

> "Every AI agent needs API access. They pay full price with zero loyalty rewards. In traditional commerce, cashback drives retention — Ageback brings that to the agentic economy using x402 payments on Taiko."

### 2. Marketplace (60s)

**Tab 1 → Marketplace tab**

- Show registered provider: name, 3% cashback rate, pool balance
- Show trending ERC-8004 agents from 8004scan leaderboard
- Point out x402 badges: "These agents are already making on-chain payments"
- "Any of these agents can earn cashback just by using an Ageback provider"

### 3. Interactive Demo (90s)

**Tab 1 → Live Demo tab**

**Step 1 — Click "Send Request"**
- Shows HTTP 402 Payment Required
- "The server says: pay me USDC on Taiko to access Claude"
- Point out: price, asset (USDC), network (Taiko Hoodi), payTo address

**Step 2 — Read the explanation**
- "The agent's x402 client auto-signs a gasless USDC transfer using EIP-3009"
- "No wallet popup, no gas for the payment — the facilitator handles settlement"

**Step 3 — Click "Execute Paid Request"**
- Shows pool state before/after
- "After payment, the server calls allocateRebate() on-chain"
- "The agent earns 3% back automatically. No claim needed, no extra integration."

### 4. Terminal Demo (60s)

```bash
node test-agent.js "What is Taiko?"
```

Walk through the output:
- 402 received → payment requirements
- USDC payment signed (EIP-3009 transferWithAuthorization)
- Claude response received
- Cashback headers: X-Cashback-Enabled: true

> "One HTTP call. Payment and cashback handled automatically."

### 5. On-chain Proof (30s)

**Tab 3 → Taikoscan**

- Show RebatePoolManager contract
- Show transactions: ProviderRegistered, RebateAllocated events
- "Everything verifiable on-chain"

### 6. Close (30s)

> "For agents: just point your x402 client at an Ageback provider. Cashback is automatic — one URL change.
>
> For providers: register, deposit ETH, and agents come to you for the rewards.
>
> It's credit card cashback for AI agents, settled on Taiko."

---

## If something goes wrong

- **Server returns 503/timeout**: Render cold start. Wait 30s, retry. Say: "This is a free-tier demo server — in production it stays warm."
- **Step 1 doesn't show 402**: Server might be down. Use the terminal demo instead.
- **MetaMask popup**: Dismiss it. The demo doesn't need wallet transactions (minting USDC is optional).
- **Marketplace empty**: RPC might be slow. Say: "The marketplace reads from Taiko Hoodi — the provider data is on-chain." Switch to the demo tab.
