const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Registering provider:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH");

  // Read contract address from deployment.json or REBATE_POOL_MANAGER env var
  let poolManagerAddr = process.env.REBATE_POOL_MANAGER;
  if (!poolManagerAddr) {
    const deploymentPath = path.join(__dirname, "..", "docs", "deployment.json");
    if (!fs.existsSync(deploymentPath)) {
      throw new Error("No REBATE_POOL_MANAGER env var and no docs/deployment.json found. Run deploy.js first.");
    }
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    poolManagerAddr = deployment.contracts.RebatePoolManager;
    console.log("Using address from deployment.json:", poolManagerAddr);
  }

  const poolManager = await hre.ethers.getContractAt("RebatePoolManager", poolManagerAddr);

  const info = await poolManager.providers(deployer.address);
  if (info.isActive) {
    console.log("Already registered as provider!");
    console.log("Deposited:", hre.ethers.formatEther(info.depositedAmount), "ETH");
    console.log("Rebate:", Number(info.rebatePercentage) / 100 + "%");
    return;
  }

  const network = hre.network.name;
  const apiEndpoint = process.env.API_ENDPOINT || `https://ageback.onrender.com/v1/messages`;

  const tx = await poolManager.registerProvider(
    300, // 3% rebate in basis points
    "Ageback AI Gateway",
    `x402 payment-gated Claude API with cashback on ${network}`,
    apiEndpoint,
    "AI Inference",
    { value: hre.ethers.parseEther("0.1") }
  );

  console.log("Tx sent:", tx.hash);
  const receipt = await tx.wait();
  console.log("Registered! Block:", receipt.blockNumber);

  const registered = await poolManager.providers(deployer.address);
  console.log("\nProvider status:");
  console.log("  Active:", registered.isActive);
  console.log("  Deposited:", hre.ethers.formatEther(registered.depositedAmount), "ETH");
  console.log("  Rebate:", Number(registered.rebatePercentage) / 100 + "%");

  const balance = await poolManager.getProviderBalance(deployer.address);
  console.log("  Available balance:", hre.ethers.formatEther(balance), "ETH");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
