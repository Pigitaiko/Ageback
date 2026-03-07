const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Authorizing server wallet as caller:", deployer.address);

  const tierManager = await hre.ethers.getContractAt(
    "LoyaltyTierManager",
    "0x126B3Ec653BD2ca9fe537b5A701bD94eDDFF1F6c"
  );

  const referralGraph = await hre.ethers.getContractAt(
    "ReferralGraph",
    "0xa9BCFa08f1A2A82339ecA528b58366923dC0B250"
  );

  // Authorize deployer wallet on LoyaltyTierManager
  const isAuthorizedTier = await tierManager.authorizedCallers(deployer.address);
  if (isAuthorizedTier) {
    console.log("Already authorized on LoyaltyTierManager");
  } else {
    console.log("Authorizing on LoyaltyTierManager...");
    const tx1 = await tierManager.addAuthorizedCaller(deployer.address);
    await tx1.wait();
    console.log("Done! Tx:", tx1.hash);
  }

  // Authorize deployer wallet on ReferralGraph
  const isAuthorizedRef = await referralGraph.authorizedCallers(deployer.address);
  if (isAuthorizedRef) {
    console.log("Already authorized on ReferralGraph");
  } else {
    console.log("Authorizing on ReferralGraph...");
    const tx2 = await referralGraph.addAuthorizedCaller(deployer.address);
    await tx2.wait();
    console.log("Done! Tx:", tx2.hash);
  }

  console.log("\nServer wallet is now authorized on both contracts!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
