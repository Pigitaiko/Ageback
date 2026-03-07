const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Updating provider metadata for:", deployer.address);

  const poolManager = await hre.ethers.getContractAt(
    "RebatePoolManager",
    "0x1571922009FC4a9ed68646b9722A9df6FB1fD11d"
  );

  const tx = await poolManager.updateMetadata(
    "Claude AI Reseller",
    "x402 payment-gated Claude API with cashback on Taiko Hoodi",
    "https://ageback.onrender.com/v1/messages",
    "AI Services"
  );

  console.log("Tx sent:", tx.hash);
  await tx.wait();
  console.log("Metadata updated!");

  const meta = await poolManager.providerMetadata(deployer.address);
  console.log("API Endpoint:", meta.apiEndpoint);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
