const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Registering provider:", deployer.address);

  const poolManager = await hre.ethers.getContractAt(
    "RebatePoolManager",
    "0x1571922009FC4a9ed68646b9722A9df6FB1fD11d"
  );

  // Check if already registered
  const info = await poolManager.providers(deployer.address);
  if (info.isActive) {
    console.log("Already registered as provider!");
    console.log("Deposited:", hre.ethers.formatEther(info.depositedAmount), "ETH");
    console.log("Rebate:", Number(info.rebatePercentage) / 100 + "%");
    return;
  }

  // Register: 3% cashback, 0.1 ETH deposit
  const tx = await poolManager.registerProvider(
    300, // 3% rebate in basis points
    "Claude AI Reseller",
    "x402 payment-gated Claude API with cashback on Taiko Hoodi",
    "http://localhost:4020/v1/messages",
    "AI Services",
    { value: hre.ethers.parseEther("0.1") }
  );

  console.log("Tx sent:", tx.hash);
  const receipt = await tx.wait();
  console.log("Registered! Block:", receipt.blockNumber);

  // Verify
  const provider = await poolManager.providers(deployer.address);
  console.log("\nProvider status:");
  console.log("  Active:", provider.isActive);
  console.log("  Deposited:", hre.ethers.formatEther(provider.depositedAmount), "ETH");
  console.log("  Rebate:", Number(provider.rebatePercentage) / 100 + "%");

  const balance = await poolManager.getProviderBalance(deployer.address);
  console.log("  Available balance:", hre.ethers.formatEther(balance), "ETH");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
