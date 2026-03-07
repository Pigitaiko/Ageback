const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying MockUSDC with:", deployer.address);

  const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();

  const address = await usdc.getAddress();
  console.log("MockUSDC deployed to:", address);

  // Mint 10,000 USDC to deployer (6 decimals)
  const mintAmount = hre.ethers.parseUnits("10000", 6);
  const mintTx = await usdc.mint(deployer.address, mintAmount);
  await mintTx.wait();
  console.log("Minted 10,000 USDC to", deployer.address);

  // Verify
  const balance = await usdc.balanceOf(deployer.address);
  console.log("Balance:", hre.ethers.formatUnits(balance, 6), "USDC");

  const name = await usdc.name();
  const symbol = await usdc.symbol();
  const decimals = await usdc.decimals();
  console.log(`Token: ${name} (${symbol}), ${decimals} decimals`);

  const domainSep = await usdc.DOMAIN_SEPARATOR();
  console.log("Domain separator:", domainSep);

  console.log("\n=== Update your x402-server .env ===");
  console.log(`Add/update: MOCK_USDC=${address}`);
  console.log(`Update TaikoExactEvmScheme in server.js to use: ${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
