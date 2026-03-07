const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH");

  // 1. Deploy Mock ERC-8004
  console.log("\n--- Deploying MockERC8004 ---");
  const ERC8004 = await hre.ethers.getContractFactory("MockERC8004");
  const identity = await ERC8004.deploy();
  await identity.waitForDeployment();
  const identityAddr = await identity.getAddress();
  console.log("MockERC8004:", identityAddr);

  // 2. Deploy RebatePoolManager
  console.log("\n--- Deploying RebatePoolManager ---");
  const PoolManager = await hre.ethers.getContractFactory("RebatePoolManager");
  const poolManager = await PoolManager.deploy();
  await poolManager.waitForDeployment();
  const poolManagerAddr = await poolManager.getAddress();
  console.log("RebatePoolManager:", poolManagerAddr);

  // 3. Deploy LoyaltyTierManager
  console.log("\n--- Deploying LoyaltyTierManager ---");
  const TierManager = await hre.ethers.getContractFactory("LoyaltyTierManager");
  const tierManager = await TierManager.deploy(identityAddr);
  await tierManager.waitForDeployment();
  const tierManagerAddr = await tierManager.getAddress();
  console.log("LoyaltyTierManager:", tierManagerAddr);

  // 4. Deploy ReferralGraph
  console.log("\n--- Deploying ReferralGraph ---");
  const ReferralGraph = await hre.ethers.getContractFactory("ReferralGraph");
  const referralGraph = await ReferralGraph.deploy();
  await referralGraph.waitForDeployment();
  const referralGraphAddr = await referralGraph.getAddress();
  console.log("ReferralGraph:", referralGraphAddr);

  // 5. Deploy RebateAccumulator
  console.log("\n--- Deploying RebateAccumulator ---");
  const Accumulator = await hre.ethers.getContractFactory("RebateAccumulator");
  const accumulator = await Accumulator.deploy(poolManagerAddr, deployer.address);
  await accumulator.waitForDeployment();
  const accumulatorAddr = await accumulator.getAddress();
  console.log("RebateAccumulator:", accumulatorAddr);

  // 6. Wire up authorizations
  console.log("\n--- Wiring authorizations ---");
  let tx = await tierManager.addAuthorizedCaller(poolManagerAddr);
  await tx.wait();
  console.log("TierManager: authorized PoolManager");

  tx = await referralGraph.addAuthorizedCaller(poolManagerAddr);
  await tx.wait();
  console.log("ReferralGraph: authorized PoolManager");

  // 7. Save deployment addresses for the frontend
  const deployment = {
    network: hre.network.name,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      MockERC8004: identityAddr,
      RebatePoolManager: poolManagerAddr,
      LoyaltyTierManager: tierManagerAddr,
      ReferralGraph: referralGraphAddr,
      RebateAccumulator: accumulatorAddr,
    },
  };

  const deploymentPath = path.join(__dirname, "..", "frontend", "deployment.json");
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log("\nDeployment saved to frontend/deployment.json");

  // 8. Copy ABIs for frontend
  const artifactsDir = path.join(__dirname, "..", "artifacts", "contracts");
  const abiDir = path.join(__dirname, "..", "frontend", "abis");
  fs.mkdirSync(abiDir, { recursive: true });

  const contractNames = [
    "MockERC8004",
    "RebatePoolManager",
    "LoyaltyTierManager",
    "ReferralGraph",
    "RebateAccumulator",
  ];

  for (const name of contractNames) {
    const artifactPath = path.join(artifactsDir, `${name}.sol`, `${name}.json`);
    if (fs.existsSync(artifactPath)) {
      const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
      fs.writeFileSync(
        path.join(abiDir, `${name}.json`),
        JSON.stringify(artifact.abi, null, 2)
      );
    }
  }
  console.log("ABIs copied to frontend/abis/");

  console.log("\n=== Deployment Complete ===");
  console.log(JSON.stringify(deployment.contracts, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
