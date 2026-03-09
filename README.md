# Ageback — x402 Cashback Protocol

Cashback protocol for the agentic economy. Providers sell API access via [x402](https://www.x402.org/) micropayments, and agents earn on-chain cashback on every call. Built on [Taiko](https://taiko.xyz/) with [ERC-8004](https://www.8004scan.io/) agent identities.

**Live demo**: https://pigitaiko.github.io/Ageback/
**Live server**: https://ageback.onrender.com
**Contracts**: [Taiko Hoodi Taikoscan](https://hoodi.taikoscan.io/address/0x1571922009FC4a9ed68646b9722A9df6FB1fD11d)

---

## How it works

```
Agent                    x402 Server                  Blockchain
  │                          │                            │
  ├─ POST /v1/messages ─────►│                            │
  │◄──── 402 Payment Required│                            │
  │                          │                            │
  ├─ Sign USDC payment ──────┤                            │
  ├─ Retry with X-PAYMENT ──►│                            │
  │                          ├─ Verify via Facilitator ──►│
  │                          ├─ Proxy to Claude API       │
  │                          ├─ allocateRebate() ────────►│ (cashback on-chain)
  │◄──── Claude response ────┤                            │
  │  + X-Cashback headers    │                            │
```

1. Agent sends a request to the x402-gated endpoint
2. Server returns HTTP 402 with payment requirements (USDC on Taiko Hoodi)
3. Agent's x402 client signs a gasless `transferWithAuthorization` (EIP-3009)
4. Agent retries with the signed payment in headers
5. Taiko facilitator settles the USDC payment on-chain
6. Server proxies the request to Claude API and returns the response
7. Server calls `RebatePoolManager.allocateRebate()` — cashback goes to the agent

---

## For Agents — Earn Cashback

### Prerequisites

- A wallet with ETH on Taiko Hoodi (chain ID 167013) for gas
- MockUSDC on Taiko Hoodi for payments
- Node.js 18+

### 1. Install dependencies

```bash
npm install @x402/core @x402/evm viem dotenv
```

### 2. Get testnet funds

**ETH**: Use the [Hoodi faucet](https://faucet.hoodi.taiko.xyz/) or bridge from Holesky.

**MockUSDC**: Anyone can mint. Call `mint(yourAddress, amount)` on the contract, or use the [Live Demo](https://pigitaiko.github.io/Ageback/) to mint from the browser.

```
MockUSDC: 0xB0b25E80D3a97526b50a73Cb7cEdBCFd4016882F
```

### 3. Create your agent

```js
import { createWalletClient, http, defineChain, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";

const taikoHoodi = defineChain({
  id: 167013,
  name: "Taiko Hoodi",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.hoodi.taiko.xyz"] } },
});

const account = privateKeyToAccount("0xYOUR_PRIVATE_KEY");
const walletClient = createWalletClient({
  account, chain: taikoHoodi, transport: http(),
}).extend(publicActions);
walletClient.address = walletClient.account.address;

const signer = toClientEvmSigner(walletClient);
const client = new x402Client();
registerExactEvmScheme(client, { signer, networks: ["eip155:167013"] });
const httpClient = new x402HTTPClient(client);

async function callClaude(prompt) {
  const url = "https://ageback.onrender.com/v1/messages";
  const body = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    messages: [{ role: "user", content: prompt }],
  };

  // Step 1: Send request, get 402 with payment requirements
  const initialResp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (initialResp.status !== 402) throw new Error("Expected 402");

  const paymentRequired = await initialResp.json();

  // Step 2: Sign USDC payment (gasless EIP-3009)
  const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

  // Step 3: Retry with payment — cashback is allocated automatically
  const paidResp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...paymentHeaders },
    body: JSON.stringify(body),
  });

  const data = await paidResp.json();
  console.log("Response:", data.content?.[0]?.text);
  console.log("Cashback:", paidResp.headers.get("X-Cashback-Enabled"));
}

callClaude("What is x402?");
```

### 4. Run the included demo agent

```bash
cd x402-server
cp .env.example .env  # add your AGENT_PRIVATE_KEY
node test-agent.js
node test-agent.js "What is the meaning of life?"  # custom prompt
```

### Available models and pricing

| Model | Price per call |
|-------|---------------|
| claude-haiku-4-5-20251001 | $0.006 |
| claude-sonnet-4-5-20250929 | $0.025 |
| claude-sonnet-4-6-20260320 | $0.025 |
| claude-opus-4-6 | $0.12 |

### Free endpoints (no payment required)

```
GET  /health            Server status + pool info
GET  /info              Full server info
GET  /cashback/status   Pool balance and rebate rate
GET  /loyalty/tier/:id  Agent loyalty tier (ERC-8004 token ID)
GET  /referral/:agent   Agent referral info
```

---

## For Providers — Offer Cashback

### 1. Register on-chain

Go to https://pigitaiko.github.io/Ageback/, connect your wallet (Taiko Hoodi network), and navigate to the **My Provider** tab:

- Set your service name, description, API endpoint, and category
- Set your cashback rate in basis points (e.g. 300 = 3%)
- Deposit at minimum 0.1 ETH into the rebate pool

### 2. Fork and configure

```bash
git clone https://github.com/Pigitaiko/Ageback
cd Ageback/x402-server
npm install
```

Create a `.env` file:

```env
# Your wallet (receives USDC payments)
PAY_TO_ADDRESS=0xYourWalletAddress

# Private key for the wallet that registered as provider
# Used to sign cashback allocation transactions
PROVIDER_PRIVATE_KEY=0xYourPrivateKey

# Claude API key (get one at https://console.anthropic.com)
ANTHROPIC_API_KEY=sk-ant-...

# Contract addresses (Taiko Hoodi)
REBATE_POOL_MANAGER=0x1571922009FC4a9ed68646b9722A9df6FB1fD11d
LOYALTY_TIER_MANAGER=0x126B3Ec653BD2ca9fe537b5A701bD94eDDFF1F6c
REFERRAL_GRAPH=0xa9BCFa08f1A2A82339ecA528b58366923dC0B250
MOCK_USDC=0xB0b25E80D3a97526b50a73Cb7cEdBCFd4016882F

# Network
TAIKO_RPC=https://rpc.hoodi.taiko.xyz
FACILITATOR_URL=https://facilitator.taiko.xyz
PORT=4020
```

### 3. Run locally

```bash
npm start
```

Test it works:
```bash
curl http://localhost:4020/health
```

### 4. Deploy

We recommend **[Render](https://render.com/)** (free tier, reliable):

1. Push your fork to GitHub
2. Create a new Web Service on Render, connect your repo
3. Set root directory to `x402-server`
4. Build command: `npm install`
5. Start command: `node server.js`
6. Add all `.env` variables in the Environment tab

### 5. Update on-chain metadata

After deploying, update your API endpoint in the **My Provider** tab so agents can discover you in the marketplace. Or run:

```bash
npx hardhat run scripts/update-endpoint.js --network taikoHoodi
```

---

## Smart Contracts (Taiko Hoodi)

| Contract | Address | Purpose |
|----------|---------|---------|
| RebatePoolManager | `0x1571922009FC4a9ed68646b9722A9df6FB1fD11d` | Provider registration, deposit pools, cashback allocation |
| LoyaltyTierManager | `0x126B3Ec653BD2ca9fe537b5A701bD94eDDFF1F6c` | Agent loyalty tiers (Bronze → Platinum), rebate multipliers |
| ReferralGraph | `0xa9BCFa08f1A2A82339ecA528b58366923dC0B250` | Referral tracking, bonus rebates |
| RebateAccumulator | `0xc1c3Edd5C5fCb85a05A949E42E9A350837D1B781` | Merkle-based batch claims |
| MockERC8004 | `0x8cc9aD184F2440FACFbffCBFdC4c69B5bCF577af` | ERC-8004 agent identity (testnet) |
| MockUSDC | `0xB0b25E80D3a97526b50a73Cb7cEdBCFd4016882F` | ERC-20 + EIP-3009 USDC (testnet, anyone can mint) |

### Loyalty tiers

| Tier | Transactions | Multiplier | Min Age |
|------|-------------|------------|---------|
| Bronze | 0 | 1.0x | None |
| Silver | 10 | 1.1x | None |
| Gold | 100 | 1.3x | None |
| Platinum | 1,000 | 1.5x | 30 days |

---

## Project Structure

```
Ageback/
├── contracts/           # Solidity smart contracts (Hardhat)
│   ├── RebatePoolManager.sol
│   ├── LoyaltyTierManager.sol
│   ├── ReferralGraph.sol
│   ├── RebateAccumulator.sol
│   ├── MockERC8004.sol
│   └── MockUSDC.sol
├── x402-server/         # Express server with x402 payment middleware
│   ├── server.js        # Main server — x402 gating + Claude proxy + cashback
│   ├── cashback.js      # On-chain cashback allocation logic
│   └── test-agent.js    # Demo agent script
├── frontend/            # Static frontend (HTML/JS/CSS)
│   ├── index.html
│   ├── app.js
│   └── style.css
├── docs/                # GitHub Pages deployment (mirror of frontend/)
└── scripts/             # Hardhat deployment and admin scripts
```

---

## Tech Stack

- **Blockchain**: [Taiko Hoodi](https://taiko.xyz/) testnet (EVM, chain ID 167013)
- **Payments**: [x402 Protocol](https://www.x402.org/) v2 — HTTP-native micropayments
- **USDC**: EIP-3009 `transferWithAuthorization` (gasless for payers)
- **Facilitator**: [Taiko x402 Facilitator](https://facilitator.taiko.xyz)
- **Identity**: [ERC-8004](https://www.8004scan.io/) agent identity standard
- **API**: [Claude API](https://docs.anthropic.com/) (Anthropic)
- **Server**: Express.js + [@x402/express](https://www.npmjs.com/package/@x402/express)
- **Client**: [viem](https://viem.sh/) + [@x402/evm](https://www.npmjs.com/package/@x402/evm)
- **Contracts**: [Hardhat](https://hardhat.org/) + [ethers.js](https://docs.ethers.org/) v6

---

## Links

- **Live Demo**: https://pigitaiko.github.io/Ageback/
- **Live Server**: https://ageback.onrender.com
- **Explorer**: https://hoodi.taikoscan.io/address/0x1571922009FC4a9ed68646b9722A9df6FB1fD11d
- **x402 Protocol**: https://www.x402.org/
- **ERC-8004 Agents**: https://www.8004scan.io/
- **8004 Explorer**: https://8004agents.ai/

---

## License

MIT
