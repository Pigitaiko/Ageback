// --- Contract ABIs (minimal, inline for portability) ---
const ABIS = {
  MockERC8004: [
    "function mint(address to) external returns (uint256)",
    "function ownerOf(uint256 tokenId) external view returns (address)",
    "function getReputation(uint256 tokenId) external view returns (uint256)",
    "function nextTokenId() external view returns (uint256)"
  ],
  RebatePoolManager: [
    "function registerProvider(uint256 rebatePercentage, string name, string description, string apiEndpoint, string category) external payable",
    "function fundPool() external payable",
    "function allocateRebate(address agent, uint256 transactionAmount) external returns (uint256)",
    "function withdrawDeposit(uint256 amount) external",
    "function deactivateProvider() external",
    "function advanceEpoch() external",
    "function updateRebatePercentage(uint256 newPercentage) external",
    "function getProviderBalance(address provider) external view returns (uint256)",
    "function getActiveRebatePercentage(address provider) external view returns (uint256)",
    "function getWithdrawalInfo(address provider) external view returns (bool canWithdraw, uint256 availableBalance, uint256 weeklyLimit, uint256 weeklyRemaining, uint256 unlockTime)",
    "function providers(address) external view returns (uint256 depositedAmount, uint256 allocatedRewards, uint256 rebatePercentage, bool isActive, uint256 registrationTime, uint256 pendingRebatePercentage, uint256 rebateUpdateEpoch, uint256 lastWithdrawalTime, uint256 weeklyWithdrawnAmount)",
    "function providerMetadata(address) external view returns (string name, string description, string apiEndpoint, string category)",
    "function totalVolumeProcessed(address) external view returns (uint256)",
    "function currentEpoch() external view returns (uint256)",
    "function pause() external",
    "function unpause() external",
    "event ProviderRegistered(address indexed provider, uint256 initialDeposit, uint256 rebatePercentage, string name)",
    "event RebateAllocated(address indexed provider, address indexed agent, uint256 amount)",
    "event WithdrawalMade(address indexed provider, uint256 amount, uint256 remainingBalance)"
  ],
  LoyaltyTierManager: [
    "function getTierMultiplier(uint256 agentId) external view returns (uint256)",
    "function calculateBoostedRebate(uint256 agentId, uint256 baseRebate) external view returns (uint256)",
    "function getAgentStats(uint256 agentId) external view returns (uint256 totalTransactions, uint256 currentTier, uint256 currentMultiplier, uint256 accountAge, uint256 transactionsToNextTier, uint256 daysUntilNextTier)",
    "function getDailyTransactionCount(uint256 agentId) external view returns (uint256)",
    "function pause() external",
    "function unpause() external"
  ],
  ReferralGraph: [
    "function recordReferral(address referrer) external",
    "function getReferralInfo(address agent) external view returns (address referrer, uint256 totalVolume, bool bonusUnlocked, uint256 volumeUntilBonus, uint256 referralCount)",
    "function getReferrerStats(address referrer) external view returns (uint256 totalReferrals, uint256 activeReferrals, uint256 totalVolume)",
    "function getReferredAgents(address referrer) external view returns (address[])",
    "function getReferralBonus(address agent, uint256 baseRebate) external view returns (uint256 referrerBonus, uint256 refereeBonus)",
    "function pause() external",
    "function unpause() external"
  ],
  RebateAccumulator: [
    "function updateMerkleRoot(bytes32 newRoot) external",
    "function claimRebate(uint256 epoch, uint256 amount, bytes32[] merkleProof) external",
    "function claimMultipleEpochs(uint256[] epochs, uint256[] amounts, bytes32[] merkleProofs, uint256[] proofLengths) external",
    "function verifyProof(uint256 epoch, address agent, uint256 amount, bytes32[] merkleProof) external view returns (bool)",
    "function hasClaimedEpoch(uint256 epoch, address agent) external view returns (bool)",
    "function getEpochInfo(uint256 epoch) external view returns (bytes32 root, uint256 activationTime, bool isActive, uint256 totalClaimed)",
    "function currentEpoch() external view returns (uint256)",
    "function currentMerkleRoot() external view returns (bytes32)",
    "function pause() external",
    "function unpause() external",
    "event RewardClaimed(address indexed agent, uint256 amount, uint256 indexed epoch)",
    "event MerkleRootUpdated(uint256 indexed epoch, bytes32 root, uint256 activationTime, address indexed updatedBy)"
  ]
};

// --- Trending ERC-8004 Agents (from 8004scan.io leaderboard) ---
const TRENDING_AGENTS = [
  { rank: 1, name: "Gekko Strategist",  network: "Base",     x402: false, score: 100, category: "DeFi",          description: "Automated trading strategy agent",    scanUrl: "https://www.8004scan.io/agents?q=Gekko+Strategist" },
  { rank: 2, name: "Captain Dack",      network: "Base",     x402: true,  score: 99,  category: "AI Services",   description: "x402-enabled AI assistant agent",     scanUrl: "https://www.8004scan.io/agents?q=Captain+Dack" },
  { rank: 3, name: "Agent8",            network: "Base",     x402: false, score: 99,  category: "Multi-agent",   description: "Multi-agent orchestration framework", scanUrl: "https://www.8004scan.io/agents?q=Agent8" },
  { rank: 4, name: "Clawnch",           network: "Base",     x402: true,  score: 99,  category: "Infrastructure", description: "x402 infrastructure & tooling agent", scanUrl: "https://www.8004scan.io/agents?q=Clawnch" },
  { rank: 5, name: "Gekko Executor",    network: "Base",     x402: false, score: 99,  category: "DeFi",          description: "On-chain trade execution agent",      scanUrl: "https://www.8004scan.io/agents?q=Gekko+Executor" },
  { rank: 6, name: "Gekko Allocator",   network: "Base",     x402: true,  score: 99,  category: "DeFi",          description: "x402 portfolio allocation agent",     scanUrl: "https://www.8004scan.io/agents?q=Gekko+Allocator" },
  { rank: 7, name: "Gekko Rebalancer",  network: "Base",     x402: false, score: 99,  category: "DeFi",          description: "Automated portfolio rebalancing",     scanUrl: "https://www.8004scan.io/agents?q=Gekko+Rebalancer" },
  { rank: 8, name: "Minara AI",         network: "Ethereum", x402: false, score: 92,  category: "AI Services",   description: "Ethereum-native AI research agent",   scanUrl: "https://www.8004scan.io/agents?q=Minara+AI" },
];

function renderTrendingAgents() {
  const container = document.getElementById("trending-agents");
  if (!container) return;
  container.innerHTML = TRENDING_AGENTS.map(a => {
    const x402Tag = a.x402
      ? `<span class="x402-tag">x402</span>`
      : "";
    const networkClass = a.network.toLowerCase().replace(/\s+/g, "-");
    const scorePct = a.score;
    const scoreColor = scorePct >= 100 ? "var(--success)" : scorePct >= 95 ? "#6366f1" : "var(--warning)";
    return `
      <a href="${a.scanUrl}" target="_blank" rel="noopener" class="trending-agent-card">
        <div class="trending-rank" style="color:${a.rank <= 3 ? 'var(--warning)' : 'var(--text-muted)'}">#${a.rank}</div>
        <div class="trending-info">
          <div class="trending-name">${escapeHtml(a.name)} ${x402Tag}</div>
          <div class="trending-meta">
            <span class="network-tag ${networkClass}">${a.network}</span>
            <span class="trending-category">${escapeHtml(a.category)}</span>
          </div>
          <div class="trending-desc">${escapeHtml(a.description)}</div>
        </div>
        <div class="trending-score">
          <span class="score-value" style="color:${scoreColor}">${a.score}</span>
          <span class="score-max">/100</span>
        </div>
        <div class="trending-cta">
          <span class="cta-btn">Earn Cashback</span>
        </div>
      </a>
    `;
  }).join("");
}

// --- Agent Categories (based on x402 ecosystem + ERC-8004 agent types) ---
const CATEGORIES = {
  "AI Services": [
    "LLM Inference", "AI Assistant", "Image Generation",
    "Speech-to-Text", "Code Generation", "AI Research",
    "Multi-agent Orchestration", "AI Gateway"
  ],
  "DeFi": [
    "Trading", "Yield Scoring", "Portfolio Data",
    "DEX Aggregation", "Lending", "Price Oracle",
    "Smart Money Intelligence", "Risk Analysis"
  ],
  "Data & Analytics": [
    "On-chain Data", "Market Data", "Web Scraping",
    "News & Research", "Social Data", "Token Analytics",
    "Blockchain Intelligence", "Data Visualization"
  ],
  "Infrastructure": [
    "RPC & Nodes", "Cloud Compute", "IPFS & Storage",
    "Agent Hosting", "API Gateway", "Workflow Automation",
    "Agent Wallet", "MCP Server"
  ],
  "Security & Identity": [
    "Agent Reputation", "Auditing", "Risk Intelligence",
    "Fraud Prevention", "ZK Proofs", "Attestation",
    "Compliance", "Identity Management"
  ],
  "Payments": [
    "Payment Processing", "Cross-chain Settlement",
    "Micropayments", "Tipping", "Prepaid Cards",
    "Stablecoin Payments", "Payroll"
  ],
  "Social & Content": [
    "Social Data", "Publishing", "Content Creation",
    "Video & Streaming", "Community Management",
    "DAO Tooling", "Governance"
  ],
  "Developer Tools": [
    "SDK & Libraries", "API Monetization", "Testing Tools",
    "Vibe Coding", "Bounty Platform", "Domain Registration",
    "Monitoring", "Config Validation"
  ],
};

function populateCategorySelect(selectId, includeAll) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = "";
  if (includeAll) {
    sel.add(new Option("All Categories", ""));
  }
  for (const [group, subs] of Object.entries(CATEGORIES)) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group;
    // Add the parent as a selectable option
    optgroup.appendChild(new Option(group, group));
    for (const sub of subs) {
      optgroup.appendChild(new Option("  " + sub, sub));
    }
    sel.appendChild(optgroup);
  }
}

// --- State ---
let provider, signer, userAddress;
let contracts = {};
let addresses = {};
let serverUrl = "https://ageback.onrender.com";
let serverInfo = null;

// Public read-only provider for marketplace (no wallet needed)
const PUBLIC_RPC = "https://rpc.hoodi.taiko.xyz";
let publicProvider = null;
let publicContracts = {};

function initPublicContracts() {
  if (!addresses.RebatePoolManager || publicContracts.poolManager) return;
  try {
    publicProvider = new ethers.JsonRpcProvider(PUBLIC_RPC, {
      name: "taiko-hoodi",
      chainId: 167013,
      ensAddress: null,
    });
    publicContracts.poolManager = new ethers.Contract(
      addresses.RebatePoolManager, ABIS.RebatePoolManager, publicProvider
    );
    if (addresses.MockERC8004) {
      publicContracts.identity = new ethers.Contract(
        addresses.MockERC8004, ABIS.MockERC8004, publicProvider
      );
    }
    console.log("[init] Public contracts ready, RPC:", PUBLIC_RPC);
  } catch (err) {
    console.error("[init] Failed to init public contracts:", err);
    showStatus("Failed to connect to Taiko RPC: " + err.message, "error");
  }
}

// Build address→tokenId+reputation map from ERC-8004
async function loadReputationMap() {
  const id = publicContracts.identity || contracts.identity;
  if (!id) return {};
  try {
    const nextId = Number(await id.nextTokenId());
    const map = {}; // address → { tokenId, reputation }
    for (let i = 1; i < nextId; i++) {
      const owner = await id.ownerOf(i);
      const rep = await id.getReputation(i);
      const addr = owner.toLowerCase();
      // Keep highest reputation if multiple tokens
      if (!map[addr] || Number(rep) > map[addr].reputation) {
        map[addr] = { tokenId: i, reputation: Number(rep) };
      }
    }
    return map;
  } catch {
    return {};
  }
}

// --- Default addresses (update after deployment or load from deployment.json) ---
async function loadDeployment() {
  try {
    const resp = await fetch("deployment.json");
    const data = await resp.json();
    addresses = data.contracts;
    showContractAddresses();
    return true;
  } catch {
    // Try localStorage fallback
    const saved = localStorage.getItem("cashback_deployment");
    if (saved) {
      addresses = JSON.parse(saved);
      showContractAddresses();
      return true;
    }
    showStatus("No deployment.json found. Deploy contracts first, or manually set addresses in Admin tab.", "info");
    return false;
  }
}

function showContractAddresses() {
  const el = document.getElementById("contract-addresses");
  el.innerHTML = Object.entries(addresses).map(([name, addr]) =>
    `<div class="info-row"><span class="label">${name}</span><span class="value">${shortenAddr(addr)}</span></div>`
  ).join("");
}

// --- Wallet Connection ---
async function connectWallet() {
  if (!window.ethereum) {
    showStatus("MetaMask not detected. Please install MetaMask.", "error");
    return;
  }

  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    const accts = await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();

    const balance = await provider.getBalance(userAddress);
    const network = await provider.getNetwork();

    document.getElementById("connect-btn").classList.add("hidden");
    document.getElementById("wallet-info").classList.remove("hidden");
    document.getElementById("wallet-address").textContent = shortenAddr(userAddress);
    document.getElementById("wallet-balance").textContent = parseFloat(ethers.formatEther(balance)).toFixed(4) + " ETH";
    document.getElementById("network-name").textContent = getNetworkName(network.chainId);

    await loadDeployment();
    initContracts();
    showStatus("Wallet connected: " + shortenAddr(userAddress), "success");
    loadMarketplace();
  } catch (err) {
    showStatus("Connection failed: " + err.message, "error");
  }
}

function initContracts() {
  if (!signer || !addresses.RebatePoolManager) return;

  contracts.poolManager = new ethers.Contract(addresses.RebatePoolManager, ABIS.RebatePoolManager, signer);
  contracts.tierManager = new ethers.Contract(addresses.LoyaltyTierManager, ABIS.LoyaltyTierManager, signer);
  contracts.referralGraph = new ethers.Contract(addresses.ReferralGraph, ABIS.ReferralGraph, signer);
  contracts.accumulator = new ethers.Contract(addresses.RebateAccumulator, ABIS.RebateAccumulator, signer);
  contracts.identity = new ethers.Contract(addresses.MockERC8004, ABIS.MockERC8004, signer);
}

// --- Marketplace ---
let marketplaceData = []; // cached provider list

async function loadMarketplace() {
  const pm = contracts.poolManager || publicContracts.poolManager;
  if (!pm) return showStatus("Loading deployment data...", "info");
  try {
    showStatus("Loading providers from chain...", "info");
    const filter = pm.filters.ProviderRegistered();

    // Use a bounded block range and timeout to avoid RPC hangs
    const rpcProvider = publicProvider || provider;
    const currentBlock = await Promise.race([
      rpcProvider.getBlockNumber(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("RPC timeout (block number)")), 15000))
    ]);
    const fromBlock = Math.max(0, currentBlock - 500000);
    const events = await Promise.race([
      pm.queryFilter(filter, fromBlock, "latest"),
      new Promise((_, rej) => setTimeout(() => rej(new Error("RPC timeout (event query)")), 20000))
    ]);

    const seen = new Set();
    const providers = [];
    for (const ev of events) {
      const addr = ev.args.provider;
      if (seen.has(addr)) continue;
      seen.add(addr);
      providers.push(addr);
    }

    // Fetch live data for each provider in parallel
    const results = await Promise.all(providers.map(async (addr) => {
      try {
        const [p, meta, volume, balance] = await Promise.all([
          pm.providers(addr),
          pm.providerMetadata(addr),
          pm.totalVolumeProcessed(addr),
          pm.getProviderBalance(addr),
        ]);
        if (!p.isActive) return null;
        return {
          address: addr,
          name: meta.name,
          description: meta.description,
          apiEndpoint: meta.apiEndpoint,
          category: meta.category,
          rebateBps: Number(p.rebatePercentage),
          depositedAmount: p.depositedAmount,
          availableBalance: balance,
          allocatedRewards: p.allocatedRewards,
          totalVolume: volume,
          registrationTime: Number(p.registrationTime),
        };
      } catch { return null; }
    }));

    marketplaceData = results.filter(Boolean);

    // Fetch ERC-8004 reputation for each provider
    const repMap = await loadReputationMap();
    for (const p of marketplaceData) {
      const rep = repMap[p.address.toLowerCase()];
      p.tokenId = rep?.tokenId || null;
      p.reputation = rep?.reputation ?? null;
    }

    sortMarketplace();
    showStatus(`Found ${marketplaceData.length} active provider(s)`, "success");
  } catch (err) {
    console.error("[marketplace]", err);
    showStatus("Loading from server fallback...", "info");
    // Fallback: use server /info to show at least the connected provider
    try {
      const srvUrl = document.getElementById("server-url").value.replace(/\/+$/, "");
      const resp = await fetch(srvUrl + "/info");
      const info = await resp.json();
      if (info.payTo && info.contracts?.RebatePoolManager) {
        marketplaceData = [{
          address: info.payTo,
          name: "x402 Cashback Server",
          description: "Payment-gated Claude API with automatic cashback",
          apiEndpoint: srvUrl + "/v1/messages",
          category: "AI Services",
          rebateBps: info.cashbackPool?.rebatePercent ? parseInt(info.cashbackPool.rebatePercent) * 100 : 300,
          depositedAmount: ethers.parseEther(info.cashbackPool?.deposited || "0"),
          availableBalance: ethers.parseEther(info.cashbackPool?.available || "0"),
          allocatedRewards: 0n,
          totalVolume: 0n,
          registrationTime: 0,
          tokenId: null,
          reputation: null,
        }];
        renderMarketplace(marketplaceData);
        showStatus("Loaded from server (on-chain query failed: " + parseError(err) + ")", "info");
        return;
      }
    } catch (fallbackErr) {
      console.error("[marketplace fallback]", fallbackErr);
    }
    showStatus("Failed to load marketplace: " + parseError(err), "error");
  }
}

function renderMarketplace(data) {
  const grid = document.getElementById("marketplace-grid");
  const statsEl = document.getElementById("marketplace-stats");

  // Summary stats
  const totalProviders = data.length;
  const totalPooled = data.reduce((s, p) => s + BigInt(p.depositedAmount), 0n);
  const totalVol = data.reduce((s, p) => s + BigInt(p.totalVolume), 0n);
  statsEl.innerHTML = `
    <span><span class="stat-value">${totalProviders}</span> providers</span>
    <span><span class="stat-value">${parseFloat(ethers.formatEther(totalPooled)).toFixed(3)}</span> ETH pooled</span>
    <span><span class="stat-value">${parseFloat(ethers.formatEther(totalVol)).toFixed(3)}</span> ETH total volume</span>
  `;

  if (data.length === 0) {
    grid.innerHTML = '<div class="no-results">No providers found matching your filters</div>';
    return;
  }

  // Sort live server provider to the top
  const sorted = [...data].sort((a, b) => {
    const aLive = serverInfo && serverInfo.payTo && a.address.toLowerCase() === serverInfo.payTo.toLowerCase();
    const bLive = serverInfo && serverInfo.payTo && b.address.toLowerCase() === serverInfo.payTo.toLowerCase();
    if (aLive && !bLive) return -1;
    if (!aLive && bLive) return 1;
    return 0;
  });

  grid.innerHTML = sorted.map(p => renderProviderCard(p)).join("");
}

function filterMarketplace() {
  const search = document.getElementById("mp-search").value.toLowerCase();
  const category = document.getElementById("mp-category-filter").value;

  // Build set of matching categories (include subcategories if parent selected)
  let matchingCategories = null;
  if (category) {
    matchingCategories = new Set([category]);
    if (CATEGORIES[category]) {
      for (const sub of CATEGORIES[category]) {
        matchingCategories.add(sub);
      }
    }
  }

  const filtered = marketplaceData.filter(p => {
    const matchSearch = !search ||
      p.name.toLowerCase().includes(search) ||
      p.description.toLowerCase().includes(search) ||
      p.category.toLowerCase().includes(search) ||
      p.address.toLowerCase().includes(search);
    const matchCategory = !matchingCategories || matchingCategories.has(p.category);
    return matchSearch && matchCategory;
  });

  renderMarketplace(filtered);
}

function sortMarketplace() {
  const sortBy = document.getElementById("mp-sort").value;

  const sorters = {
    "rebate-desc": (a, b) => b.rebateBps - a.rebateBps,
    "rebate-asc": (a, b) => a.rebateBps - b.rebateBps,
    "deposit-desc": (a, b) => {
      const diff = BigInt(b.depositedAmount) - BigInt(a.depositedAmount);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    },
    "volume-desc": (a, b) => {
      const diff = BigInt(b.totalVolume) - BigInt(a.totalVolume);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    },
    "newest": (a, b) => b.registrationTime - a.registrationTime,
  };

  marketplaceData.sort(sorters[sortBy] || sorters["rebate-desc"]);
  filterMarketplace();
}

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// --- Provider Functions ---
async function registerProvider(e) {
  e.preventDefault();
  try {
    // Check if already registered
    const existing = await contracts.poolManager.providers(userAddress);
    if (existing.isActive) {
      showStatus("You are already registered as a provider. See 'My Provider Status' below.", "error");
      loadProviderInfo();
      return;
    }

    showStatus("Registering provider...", "info");
    const tx = await contracts.poolManager.registerProvider(
      parseInt(document.getElementById("reg-rebate").value),
      document.getElementById("reg-name").value,
      document.getElementById("reg-description").value,
      document.getElementById("reg-api").value,
      document.getElementById("reg-category").value,
      { value: ethers.parseEther(document.getElementById("reg-deposit").value) }
    );
    await tx.wait();
    showStatus("Provider registered successfully!", "success");
    loadProviderInfo();
  } catch (err) {
    showStatus("Registration failed: " + parseError(err), "error");
  }
}

async function loadProviderInfo() {
  if (!contracts.poolManager) return showStatus("Connect wallet first", "error");
  try {
    const p = await contracts.poolManager.providers(userAddress);
    const meta = await contracts.poolManager.providerMetadata(userAddress);
    const volume = await contracts.poolManager.totalVolumeProcessed(userAddress);
    const balance = await contracts.poolManager.getProviderBalance(userAddress);

    const el = document.getElementById("provider-info");
    if (!p.isActive) {
      el.innerHTML = '<p class="placeholder">Not registered as a provider</p>';
      return;
    }

    el.innerHTML = `
      <div class="info-row"><span class="label">Name</span><span class="value">${meta.name}</span></div>
      <div class="info-row"><span class="label">Category</span><span class="value">${meta.category}</span></div>
      <div class="info-row"><span class="label">Active</span><span class="value">${p.isActive}</span></div>
      <div class="info-row"><span class="label">Deposited</span><span class="value">${ethers.formatEther(p.depositedAmount)} ETH</span></div>
      <div class="info-row"><span class="label">Allocated Rewards</span><span class="value">${ethers.formatEther(p.allocatedRewards)} ETH</span></div>
      <div class="info-row"><span class="label">Available Balance</span><span class="value">${ethers.formatEther(balance)} ETH</span></div>
      <div class="info-row"><span class="label">Rebate %</span><span class="value">${Number(p.rebatePercentage) / 100}%</span></div>
      <div class="info-row"><span class="label">Total Volume</span><span class="value">${ethers.formatEther(volume)} ETH</span></div>
      <div class="info-row"><span class="label">Registered</span><span class="value">${new Date(Number(p.registrationTime) * 1000).toLocaleDateString()}</span></div>
    `;
  } catch (err) {
    showStatus("Failed to load provider info: " + parseError(err), "error");
  }
}

async function fundPool(e) {
  e.preventDefault();
  try {
    showStatus("Funding pool...", "info");
    const tx = await contracts.poolManager.fundPool({
      value: ethers.parseEther(document.getElementById("fund-amount").value)
    });
    await tx.wait();
    showStatus("Pool funded successfully!", "success");
    loadProviderInfo();
  } catch (err) {
    showStatus("Fund failed: " + parseError(err), "error");
  }
}

async function loadWithdrawalInfo() {
  if (!contracts.poolManager) return;
  try {
    const info = await contracts.poolManager.getWithdrawalInfo(userAddress);
    const el = document.getElementById("withdrawal-info");
    el.innerHTML = `
      <div class="info-row"><span class="label">Can Withdraw</span><span class="value">${info.canWithdraw}</span></div>
      <div class="info-row"><span class="label">Available Balance</span><span class="value">${ethers.formatEther(info.availableBalance)} ETH</span></div>
      <div class="info-row"><span class="label">Weekly Limit</span><span class="value">${ethers.formatEther(info.weeklyLimit)} ETH</span></div>
      <div class="info-row"><span class="label">Weekly Remaining</span><span class="value">${ethers.formatEther(info.weeklyRemaining)} ETH</span></div>
      <div class="info-row"><span class="label">Unlock Time</span><span class="value">${new Date(Number(info.unlockTime) * 1000).toLocaleString()}</span></div>
    `;
  } catch (err) {
    showStatus("Failed to load withdrawal info: " + parseError(err), "error");
  }
}

async function withdrawDeposit(e) {
  e.preventDefault();
  try {
    showStatus("Withdrawing...", "info");
    const tx = await contracts.poolManager.withdrawDeposit(
      ethers.parseEther(document.getElementById("withdraw-amount").value)
    );
    await tx.wait();
    showStatus("Withdrawal successful!", "success");
    loadProviderInfo();
    loadWithdrawalInfo();
  } catch (err) {
    showStatus("Withdrawal failed: " + parseError(err), "error");
  }
}

async function allocateRebate(e) {
  e.preventDefault();
  try {
    showStatus("Allocating rebate...", "info");
    const tx = await contracts.poolManager.allocateRebate(
      document.getElementById("alloc-agent").value,
      ethers.parseEther(document.getElementById("alloc-amount").value)
    );
    const receipt = await tx.wait();
    showStatus("Rebate allocated!", "success");
    loadProviderInfo();
  } catch (err) {
    showStatus("Allocation failed: " + parseError(err), "error");
  }
}

// --- Tier Functions ---
async function loadAgentStats(e) {
  e.preventDefault();
  try {
    const tokenId = document.getElementById("agent-token-id").value;
    const stats = await contracts.tierManager.getAgentStats(tokenId);
    const tierNames = ["Bronze", "Silver", "Gold", "Platinum"];

    document.getElementById("agent-stats").innerHTML = `
      <div class="info-row"><span class="label">Total Transactions</span><span class="value">${stats.totalTransactions.toString()}</span></div>
      <div class="info-row"><span class="label">Current Tier</span><span class="value">${tierNames[Number(stats.currentTier)] || stats.currentTier.toString()}</span></div>
      <div class="info-row"><span class="label">Multiplier</span><span class="value">${(Number(stats.currentMultiplier) / 10000).toFixed(1)}x</span></div>
      <div class="info-row"><span class="label">Account Age</span><span class="value">${Math.floor(Number(stats.accountAge) / 86400)} days</span></div>
      <div class="info-row"><span class="label">Txs to Next Tier</span><span class="value">${stats.transactionsToNextTier.toString()}</span></div>
      <div class="info-row"><span class="label">Days to Next Tier</span><span class="value">${stats.daysUntilNextTier.toString()}</span></div>
    `;
  } catch (err) {
    showStatus("Failed to load agent stats: " + parseError(err), "error");
  }
}

async function calcBoostedRebate(e) {
  e.preventDefault();
  try {
    const tokenId = document.getElementById("boost-token-id").value;
    const baseRebate = ethers.parseEther(document.getElementById("boost-base").value);
    const boosted = await contracts.tierManager.calculateBoostedRebate(tokenId, baseRebate);

    document.getElementById("boosted-result").innerHTML = `
      <div class="info-row"><span class="label">Boosted Rebate</span><span class="value">${ethers.formatEther(boosted)} ETH</span></div>
    `;
  } catch (err) {
    showStatus("Calculation failed: " + parseError(err), "error");
  }
}

async function mintIdentity(e) {
  e.preventDefault();
  try {
    const recipient = document.getElementById("mint-address").value || userAddress;
    showStatus("Minting identity token...", "info");
    const tx = await contracts.identity.mint(recipient);
    const receipt = await tx.wait();
    const nextId = await contracts.identity.nextTokenId();
    const mintedId = Number(nextId) - 1;
    document.getElementById("mint-result").innerHTML = `
      <div class="info-row"><span class="label">Minted Token ID</span><span class="value">${mintedId}</span></div>
      <div class="info-row"><span class="label">Owner</span><span class="value">${shortenAddr(recipient)}</span></div>
    `;
    showStatus("Identity token #" + mintedId + " minted!", "success");
  } catch (err) {
    showStatus("Mint failed: " + parseError(err), "error");
  }
}

// --- Referral Functions ---
async function recordReferral(e) {
  e.preventDefault();
  try {
    showStatus("Recording referral...", "info");
    const tx = await contracts.referralGraph.recordReferral(
      document.getElementById("ref-referrer").value
    );
    await tx.wait();
    showStatus("Referral recorded!", "success");
    loadReferralInfo();
  } catch (err) {
    showStatus("Referral failed: " + parseError(err), "error");
  }
}

async function loadReferralInfo() {
  if (!contracts.referralGraph) return;
  try {
    const info = await contracts.referralGraph.getReferralInfo(userAddress);
    document.getElementById("referral-info").innerHTML = `
      <div class="info-row"><span class="label">Referrer</span><span class="value">${info.referrer === ethers.ZeroAddress ? "None" : shortenAddr(info.referrer)}</span></div>
      <div class="info-row"><span class="label">Total Volume</span><span class="value">${ethers.formatEther(info.totalVolume)} ETH</span></div>
      <div class="info-row"><span class="label">Bonus Unlocked</span><span class="value">${info.bonusUnlocked}</span></div>
      <div class="info-row"><span class="label">Volume Until Bonus</span><span class="value">${ethers.formatEther(info.volumeUntilBonus)} ETH</span></div>
      <div class="info-row"><span class="label">My Referral Count</span><span class="value">${info.referralCount.toString()}</span></div>
    `;
  } catch (err) {
    showStatus("Failed to load referral info: " + parseError(err), "error");
  }
}

async function loadReferrerStats(e) {
  e.preventDefault();
  try {
    const addr = document.getElementById("referrer-address").value || userAddress;
    const stats = await contracts.referralGraph.getReferrerStats(addr);
    document.getElementById("referrer-stats").innerHTML = `
      <div class="info-row"><span class="label">Total Referrals</span><span class="value">${stats.totalReferrals.toString()}</span></div>
      <div class="info-row"><span class="label">Active Referrals</span><span class="value">${stats.activeReferrals.toString()}</span></div>
      <div class="info-row"><span class="label">Total Volume</span><span class="value">${ethers.formatEther(stats.totalVolume)} ETH</span></div>
    `;
  } catch (err) {
    showStatus("Failed to load referrer stats: " + parseError(err), "error");
  }
}

// --- Claims Functions ---
async function loadEpochInfo() {
  if (!contracts.accumulator) return;
  try {
    const epoch = await contracts.accumulator.currentEpoch();
    const root = await contracts.accumulator.currentMerkleRoot();

    let epochDetail = "";
    if (Number(epoch) > 0) {
      const info = await contracts.accumulator.getEpochInfo(epoch);
      epochDetail = `
        <div class="info-row"><span class="label">Root</span><span class="value" style="font-size:0.75rem">${root}</span></div>
        <div class="info-row"><span class="label">Activation Time</span><span class="value">${new Date(Number(info.activationTime) * 1000).toLocaleString()}</span></div>
        <div class="info-row"><span class="label">Is Active</span><span class="value">${info.isActive}</span></div>
        <div class="info-row"><span class="label">Total Claimed</span><span class="value">${ethers.formatEther(info.totalClaimed)} ETH</span></div>
      `;
    }

    document.getElementById("epoch-info").innerHTML = `
      <div class="info-row"><span class="label">Current Epoch</span><span class="value">${epoch.toString()}</span></div>
      ${epochDetail}
    `;
  } catch (err) {
    showStatus("Failed to load epoch info: " + parseError(err), "error");
  }
}

async function claimRebate(e) {
  e.preventDefault();
  try {
    showStatus("Claiming rebate...", "info");
    const proof = document.getElementById("claim-proof").value
      .split(",")
      .map(p => p.trim())
      .filter(p => p.length > 0);

    const tx = await contracts.accumulator.claimRebate(
      parseInt(document.getElementById("claim-epoch").value),
      ethers.parseEther(document.getElementById("claim-amount").value),
      proof
    );
    await tx.wait();
    showStatus("Rebate claimed successfully!", "success");
  } catch (err) {
    showStatus("Claim failed: " + parseError(err), "error");
  }
}

async function verifyProof(e) {
  e.preventDefault();
  try {
    const proof = document.getElementById("verify-proof").value
      .split(",")
      .map(p => p.trim())
      .filter(p => p.length > 0);

    const valid = await contracts.accumulator.verifyProof(
      parseInt(document.getElementById("verify-epoch").value),
      document.getElementById("verify-agent").value || userAddress,
      ethers.parseEther(document.getElementById("verify-amount").value),
      proof
    );

    document.getElementById("verify-result").innerHTML = `
      <div class="info-row"><span class="label">Proof Valid</span><span class="value" style="color: ${valid ? 'var(--success)' : 'var(--danger)'}">${valid}</span></div>
    `;
  } catch (err) {
    showStatus("Verification failed: " + parseError(err), "error");
  }
}

async function checkClaimStatus(e) {
  e.preventDefault();
  try {
    const epoch = parseInt(document.getElementById("check-epoch").value);
    const agent = document.getElementById("check-agent").value || userAddress;
    const claimed = await contracts.accumulator.hasClaimedEpoch(epoch, agent);

    document.getElementById("claim-status").innerHTML = `
      <div class="info-row"><span class="label">Claimed</span><span class="value" style="color: ${claimed ? 'var(--warning)' : 'var(--success)'}">${claimed ? "Yes (already claimed)" : "No (available)"}</span></div>
    `;
  } catch (err) {
    showStatus("Check failed: " + parseError(err), "error");
  }
}

// --- Admin Functions ---
async function pauseContract(name) {
  try {
    showStatus(`Pausing ${name}...`, "info");
    const tx = await contracts[name].pause();
    await tx.wait();
    showStatus(`${name} paused!`, "success");
  } catch (err) {
    showStatus("Pause failed: " + parseError(err), "error");
  }
}

async function unpauseContract(name) {
  try {
    showStatus(`Unpausing ${name}...`, "info");
    const tx = await contracts[name].unpause();
    await tx.wait();
    showStatus(`${name} unpaused!`, "success");
  } catch (err) {
    showStatus("Unpause failed: " + parseError(err), "error");
  }
}

async function advanceEpoch() {
  try {
    showStatus("Advancing epoch...", "info");
    const tx = await contracts.poolManager.advanceEpoch();
    await tx.wait();
    showStatus("Epoch advanced!", "success");
  } catch (err) {
    showStatus("Failed: " + parseError(err), "error");
  }
}

async function updateMerkleRoot(e) {
  e.preventDefault();
  try {
    showStatus("Updating Merkle root...", "info");
    const tx = await contracts.accumulator.updateMerkleRoot(
      document.getElementById("new-merkle-root").value
    );
    await tx.wait();
    showStatus("Merkle root updated!", "success");
    loadEpochInfo();
  } catch (err) {
    showStatus("Failed: " + parseError(err), "error");
  }
}

// --- x402 Server Connection ---
async function connectServer() {
  serverUrl = document.getElementById("server-url").value.replace(/\/+$/, "");
  const banner = document.getElementById("server-banner");
  const dot = document.getElementById("server-dot");
  const statusText = document.getElementById("server-status-text");
  const details = document.getElementById("server-details");
  banner.style.display = "flex";

  try {
    const resp = await fetch(serverUrl + "/info");
    serverInfo = await resp.json();

    dot.classList.add("online");
    statusText.textContent = "Connected";
    details.innerHTML = `
      <span>Network: ${serverInfo.network}</span>
      <span>Pool: ${serverInfo.cashbackPool?.available || "?"} ETH</span>
      <span>Rebate: ${serverInfo.cashbackPool?.rebatePercent || "?"}</span>
      <span>Models: ${Object.keys(serverInfo.pricing || {}).length}</span>
    `;
    showStatus("Connected to x402 server at " + serverUrl, "success");
  } catch (err) {
    dot.classList.remove("online");
    statusText.textContent = "Offline";
    details.innerHTML = `<span>Cannot reach ${serverUrl}</span>`;
    serverInfo = null;
    showStatus("Cannot connect to server: " + err.message, "error");
  }
}

function renderProviderCard(p) {
  const rebatePct = (p.rebateBps / 100).toFixed(1);
  const poolBal = parseFloat(ethers.formatEther(p.availableBalance)).toFixed(4);
  const vol = parseFloat(ethers.formatEther(p.totalVolume)).toFixed(4);
  const deposited = parseFloat(ethers.formatEther(p.depositedAmount)).toFixed(4);
  const regDate = new Date(p.registrationTime * 1000).toLocaleDateString();

  // Check if this provider matches the connected server
  const isLiveServer = serverInfo && serverInfo.payTo &&
    p.address.toLowerCase() === serverInfo.payTo.toLowerCase();

  const liveTag = isLiveServer
    ? `<span style="font-size:0.7rem;padding:0.15rem 0.5rem;border-radius:20px;background:rgba(34,197,94,0.2);color:var(--success);font-weight:600;">LIVE</span>`
    : "";

  const repDisplay = p.reputation !== null
    ? `<span class="tier-badge ${p.reputation >= 500 ? 'platinum' : p.reputation >= 200 ? 'gold' : p.reputation >= 100 ? 'silver' : 'bronze'}" title="ERC-8004 #${p.tokenId}">Rep: ${p.reputation}</span>`
    : `<span style="font-size:0.7rem;color:var(--text-muted);">No 8004 ID</span>`;

  const apiDisplay = p.apiEndpoint
    ? `<div class="provider-card-api"><a href="${escapeHtml(p.apiEndpoint)}" target="_blank" rel="noopener">${escapeHtml(p.apiEndpoint)}</a></div>`
    : "";

  const pricingDisplay = isLiveServer && serverInfo.pricing
    ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.6rem;">
        ${Object.entries(serverInfo.pricing).map(([m, pr]) =>
          `<span style="margin-right:0.8rem;">${m.split("-").slice(1,3).join("-")}: ${pr}</span>`
        ).join("")}
       </div>`
    : "";

  const actionsDisplay = isLiveServer
    ? `<div class="provider-card-actions">
        <button class="btn-primary" onclick="copyApiUrl()">Copy API URL</button>
        <button class="btn-secondary" style="margin-bottom:0" onclick="testServerHealth()">Health Check</button>
       </div>`
    : "";

  return `
    <div class="provider-card${isLiveServer ? " live" : ""}" data-address="${p.address}" ${isLiveServer ? 'style="border-color:var(--success)"' : ""}>
      <div class="provider-card-header">
        <h3>${escapeHtml(p.name)} ${liveTag}</h3>
        <div style="display:flex;gap:0.4rem;align-items:center;">
          ${repDisplay}
          <span class="provider-category">${escapeHtml(p.category)}</span>
        </div>
      </div>
      <div class="provider-card-desc">${escapeHtml(p.description) || "No description"}</div>
      ${apiDisplay}
      ${pricingDisplay}
      <div class="provider-card-stats">
        <div class="provider-stat">
          <span class="label">Cashback</span>
          <span class="value rebate-badge">${rebatePct}%</span>
        </div>
        <div class="provider-stat">
          <span class="label">Available Pool</span>
          <span class="value">${poolBal} ETH</span>
        </div>
        <div class="provider-stat">
          <span class="label">Total Deposited</span>
          <span class="value">${deposited} ETH</span>
        </div>
        <div class="provider-stat">
          <span class="label">Volume Processed</span>
          <span class="value">${vol} ETH</span>
        </div>
      </div>
      <div class="provider-card-footer">
        <span class="provider-address" title="${p.address}">${shortenAddr(p.address)}</span>
        <span style="font-size:0.75rem;color:var(--text-muted)">Since ${regDate}</span>
      </div>
      ${actionsDisplay}
    </div>
  `;
}

function copyApiUrl() {
  navigator.clipboard.writeText(serverUrl + "/v1/messages");
  showStatus("API URL copied: " + serverUrl + "/v1/messages", "success");
}

async function testServerHealth() {
  try {
    const resp = await fetch(serverUrl + "/health");
    const data = await resp.json();
    showStatus(`Server healthy. Pool: ${data.cashbackPool?.available} ETH available, ${data.cashbackPool?.rebatePercent} cashback`, "success");
  } catch (err) {
    showStatus("Health check failed: " + err.message, "error");
  }
}

// --- Demo Tab Functions ---
const MOCK_USDC_ADDRESS = "0xB0b25E80D3a97526b50a73Cb7cEdBCFd4016882F";
const MOCK_USDC_ABI = [
  "function mint(address to, uint256 amount) external",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)"
];

async function demoRefreshSetup() {
  // Wallet info
  const addrEl = document.getElementById("demo-wallet-addr");
  const ethEl = document.getElementById("demo-eth-balance");
  const usdcEl = document.getElementById("demo-usdc-balance");
  const dotEl = document.getElementById("demo-server-dot");

  if (userAddress && provider) {
    addrEl.textContent = shortenAddr(userAddress);
    try {
      const bal = await provider.getBalance(userAddress);
      ethEl.textContent = parseFloat(ethers.formatEther(bal)).toFixed(4) + " ETH";
    } catch { ethEl.textContent = "Error"; }

    try {
      const rpcProv = publicProvider || provider;
      const usdc = new ethers.Contract(MOCK_USDC_ADDRESS, MOCK_USDC_ABI, rpcProv);
      const usdcBal = await usdc.balanceOf(userAddress);
      usdcEl.textContent = parseFloat(ethers.formatUnits(usdcBal, 6)).toFixed(2) + " USDC";
    } catch { usdcEl.textContent = "Error"; }
  } else {
    addrEl.textContent = "Not connected";
    ethEl.textContent = "--";
    usdcEl.textContent = "--";
  }

  // Server status
  try {
    const resp = await fetch((serverUrl || "https://ageback.onrender.com") + "/info");
    if (resp.ok) {
      dotEl.classList.add("online");
    } else {
      dotEl.classList.remove("online");
    }
  } catch {
    dotEl.classList.remove("online");
  }
}

async function demoMintUSDC() {
  if (!signer) {
    showStatus("Connect wallet first to mint USDC", "error");
    return;
  }
  try {
    showStatus("Minting 100 MockUSDC...", "info");
    const usdc = new ethers.Contract(MOCK_USDC_ADDRESS, MOCK_USDC_ABI, signer);
    const tx = await usdc.mint(userAddress, ethers.parseUnits("100", 6));
    await tx.wait();
    showStatus("Minted 100 MockUSDC! Tx: " + tx.hash.slice(0, 18) + "...", "success");
    demoRefreshSetup();
  } catch (err) {
    showStatus("Mint failed: " + parseError(err), "error");
  }
}

async function demoStep1() {
  const resultEl = document.getElementById("demo-step1-result");
  const url = (serverUrl || "https://ageback.onrender.com") + "/v1/messages";
  const body = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 50,
    messages: [{ role: "user", content: "Say hello in one sentence." }]
  };

  resultEl.innerHTML = '<div class="demo-progress"><div class="spinner"></div> Sending POST to /v1/messages without payment...</div>';
  resultEl.classList.add("visible");

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const status = resp.status;
    let paymentHeader = resp.headers.get("x-payment") || resp.headers.get("X-Payment");

    let decoded = null;
    if (status === 402) {
      // Try to get payment requirements from response body or header
      try {
        const respBody = await resp.json();
        if (respBody.x402) decoded = respBody.x402;
        else if (respBody.paymentRequirements) decoded = respBody.paymentRequirements;
        else decoded = respBody;
      } catch {
        // Try parsing header
        if (paymentHeader) {
          try { decoded = JSON.parse(atob(paymentHeader)); } catch {}
        }
      }
    }

    let html = `<div style="margin-bottom:0.5rem"><span class="demo-check">&#10003;</span> Response received</div>`;
    html += `<div class="info-row"><span class="label">HTTP Status</span><span class="value" style="color:var(--warning);font-weight:700">${status} Payment Required</span></div>`;

    if (decoded) {
      const req = Array.isArray(decoded) ? decoded[0] : decoded;
      html += `<div style="margin-top:0.6rem;font-size:0.85rem;color:var(--text-muted)"><strong style="color:var(--text)">Payment Requirements:</strong></div>`;
      html += `<div class="info-grid" style="margin-top:0.3rem">`;
      if (req.maxAmountRequired) html += `<div class="info-row"><span class="label">Price</span><span class="value">${req.maxAmountRequired} (smallest unit)</span></div>`;
      if (req.asset) html += `<div class="info-row"><span class="label">Asset</span><span class="value">${shortenAddr(req.asset)}</span></div>`;
      if (req.network) html += `<div class="info-row"><span class="label">Network</span><span class="value">${req.network}</span></div>`;
      if (req.payTo) html += `<div class="info-row"><span class="label">Pay To</span><span class="value">${shortenAddr(req.payTo)}</span></div>`;
      html += `</div>`;
      html += `<details style="margin-top:0.6rem"><summary style="cursor:pointer;font-size:0.8rem;color:var(--text-muted)">Raw payment requirements</summary><pre>${JSON.stringify(decoded, null, 2)}</pre></details>`;
    } else {
      html += `<p style="color:var(--text-muted);font-size:0.85rem;margin-top:0.5rem">Could not parse payment requirements. The server may be offline or not returning x402 headers. Status: ${status}</p>`;
      try {
        const text = await resp.text();
        if (text) html += `<pre>${text.substring(0, 500)}</pre>`;
      } catch {}
    }

    resultEl.innerHTML = html;
  } catch (err) {
    resultEl.innerHTML = `<div style="color:var(--danger)">Request failed: ${err.message}</div><p style="color:var(--text-muted);font-size:0.82rem;margin-top:0.5rem">The server at ${url} may be starting up (cold start on Render can take ~30s). Try again in a moment.</p>`;
  }
}

async function demoStep3() {
  const resultEl = document.getElementById("demo-step3-result");
  const baseUrl = serverUrl || "https://ageback.onrender.com";

  resultEl.innerHTML = '<div class="demo-progress"><div class="spinner"></div> Checking current cashback pool state...</div>';
  resultEl.classList.add("visible");

  let beforeInfo = null;
  try {
    const resp = await fetch(baseUrl + "/health");
    if (resp.ok) beforeInfo = await resp.json();
  } catch {}

  let html = "";

  // Before state
  if (beforeInfo && beforeInfo.cashbackPool) {
    html += `<div style="margin-bottom:0.8rem"><span class="demo-check">&#10003;</span> <strong>Pool State (Before)</strong></div>`;
    html += `<div class="info-grid">`;
    html += `<div class="info-row"><span class="label">Available Balance</span><span class="value">${beforeInfo.cashbackPool.available || "?"} ETH</span></div>`;
    html += `<div class="info-row"><span class="label">Rebate Rate</span><span class="value">${beforeInfo.cashbackPool.rebatePercent || "?"}</span></div>`;
    html += `</div>`;
  }

  // Simulated payment animation
  html += `<div class="demo-progress" style="margin:1rem 0"><div class="spinner"></div> Simulating x402 payment flow...</div>`;
  resultEl.innerHTML = html;

  await new Promise(r => setTimeout(r, 1500));

  // After state
  html = "";
  if (beforeInfo && beforeInfo.cashbackPool) {
    html += `<div style="margin-bottom:0.8rem"><span class="demo-check">&#10003;</span> <strong>Pool State (Before)</strong></div>`;
    html += `<div class="info-grid">`;
    html += `<div class="info-row"><span class="label">Available Balance</span><span class="value">${beforeInfo.cashbackPool.available || "?"} ETH</span></div>`;
    html += `<div class="info-row"><span class="label">Rebate Rate</span><span class="value">${beforeInfo.cashbackPool.rebatePercent || "?"}</span></div>`;
    html += `</div>`;
  }

  html += `<div style="margin:1rem 0;padding:1rem;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.25);border-radius:8px">`;
  html += `<span class="demo-check">&#10003;</span> <strong style="color:var(--success)">Payment Simulation Complete</strong>`;
  html += `<p style="color:var(--text-muted);font-size:0.82rem;margin-top:0.5rem;line-height:1.5">`;
  html += `In production, the agent's <code style="background:var(--input-bg);padding:0.1rem 0.3rem;border-radius:3px;font-size:0.78rem">@x402/evm</code> client automatically:</p>`;
  html += `<ol style="color:var(--text-muted);font-size:0.82rem;margin:0.5rem 0 0 1.2rem;line-height:1.7">`;
  html += `<li>Reads payment requirements from the 402 response</li>`;
  html += `<li>Signs a USDC <code style="background:var(--input-bg);padding:0.1rem 0.3rem;border-radius:3px;font-size:0.78rem">transferWithAuthorization</code> (EIP-3009, gasless)</li>`;
  html += `<li>Retries the request with the signed payment in headers</li>`;
  html += `<li>The Taiko facilitator settles the USDC on-chain</li>`;
  html += `<li>The server calls <code style="background:var(--input-bg);padding:0.1rem 0.3rem;border-radius:3px;font-size:0.78rem">RebatePoolManager.allocateRebate()</code></li>`;
  html += `<li>Cashback is allocated from the provider's deposit pool to the agent</li>`;
  html += `</ol></div>`;

  // Fetch after state
  let afterInfo = null;
  try {
    const resp2 = await fetch(baseUrl + "/health");
    if (resp2.ok) afterInfo = await resp2.json();
  } catch {}

  if (afterInfo && afterInfo.cashbackPool) {
    html += `<div style="margin-top:0.8rem"><span class="demo-check">&#10003;</span> <strong>Pool State (Current)</strong></div>`;
    html += `<div class="info-grid">`;
    html += `<div class="info-row"><span class="label">Available Balance</span><span class="value">${afterInfo.cashbackPool.available || "?"} ETH</span></div>`;
    html += `<div class="info-row"><span class="label">Rebate Rate</span><span class="value">${afterInfo.cashbackPool.rebatePercent || "?"}</span></div>`;
    html += `</div>`;
  }

  html += `<div style="margin-top:1rem"><a href="https://hoodi.taikoscan.io/address/0x1571922009FC4a9ed68646b9722A9df6FB1fD11d" target="_blank" rel="noopener" style="color:var(--primary);font-size:0.85rem">View RebatePoolManager on Taikoscan &rarr;</a></div>`;

  resultEl.innerHTML = html;
}

// --- UI Helpers ---
function showTab(name) {
  document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("tab-" + name).classList.add("active");
  event.target.classList.add("active");
  if (name === "marketplace" && marketplaceData.length === 0 && contracts.poolManager) {
    loadMarketplace();
  }
  if (name === "providers" && contracts.poolManager) {
    loadProviderInfo();
  }
  if (name === "referrals" && contracts.referralGraph) {
    loadReferralInfo();
  }
  if (name === "claims" && contracts.accumulator) {
    loadEpochInfo();
  }
  if (name === "demo") {
    demoRefreshSetup();
  }
}

function showStatus(msg, type) {
  const bar = document.getElementById("status-bar");
  bar.textContent = msg;
  bar.className = type;
  bar.classList.remove("hidden");
  if (type === "success") {
    setTimeout(() => bar.classList.add("hidden"), 5000);
  }
}

function shortenAddr(addr) {
  if (!addr) return "";
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function getNetworkName(chainId) {
  const names = {
    1n: "Ethereum",
    167013n: "Taiko Hoodi",
    167000n: "Taiko Mainnet",
    31337n: "Hardhat Local",
    11155111n: "Sepolia",
  };
  return names[chainId] || `Chain ${chainId}`;
}

function parseError(err) {
  if (err.reason) return err.reason;
  if (err.data?.message) return err.data.message;
  if (err.message?.includes("user rejected")) return "Transaction rejected by user";
  if (err.message?.length > 200) return err.message.substring(0, 200) + "...";
  return err.message || "Unknown error";
}

// --- Init ---
window.addEventListener("load", async () => {
  populateCategorySelect("reg-category", false);
  populateCategorySelect("mp-category-filter", true);
  await loadDeployment();
  initPublicContracts();
  // Load marketplace immediately (no wallet needed)
  loadMarketplace();
  // Render trending 8004 agents
  renderTrendingAgents();
  // Auto-connect server
  connectServer();
  // Initialize demo tab
  demoRefreshSetup();
  if (window.ethereum) {
    const accts = await window.ethereum.request({ method: "eth_accounts" });
    if (accts.length > 0) {
      await connectWallet();
    }
  }
});

// Handle account/network changes
if (window.ethereum) {
  window.ethereum.on("accountsChanged", () => window.location.reload());
  window.ethereum.on("chainChanged", () => window.location.reload());
}
