import { ethers } from "hardhat";

async function main() {
  console.log("=== FPAC Level Targeting Upgrade Deployment ===\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH\n");

  // Deploy OracleHub first (if not already deployed)
  const OracleHub = await ethers.getContractFactory("OracleHub");
  const oracleHub = await OracleHub.deploy(deployer.address, deployer.address);
  await oracleHub.waitForDeployment();
  console.log("OracleHub deployed to:", await oracleHub.getAddress());

  // Deploy FPAC (if not already deployed)
  const FPAC = await ethers.getContractFactory("FPAC");
  const initialPrice = ethers.parseUnits("1.0", 18); // $1.00
  const fpac = await FPAC.deploy(
    deployer.address,
    deployer.address, // temporary peg engine address
    initialPrice
  );
  await fpac.waitForDeployment();
  console.log("FPAC deployed to:", await fpac.getAddress());

  // Deploy PegEngineV2 with Level Targeting
  const PegEngineV2 = await ethers.getContractFactory("PegEngineV2");
  const annualGrowthRate = 200; // 2% annual FAIT growth
  const pegEngineV2 = await PegEngineV2.deploy(
    deployer.address,
    deployer.address,
    await fpac.getAddress(),
    await oracleHub.getAddress(),
    initialPrice,
    1, // PLT (Price Level Targeting) mode
    annualGrowthRate
  );
  await pegEngineV2.waitForDeployment();
  console.log("PegEngineV2 deployed to:", await pegEngineV2.getAddress());

  // Grant necessary roles
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const BURNER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE"));
  const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));

  console.log("\nGranting roles...");
  await fpac.grantRole(MINTER_ROLE, await pegEngineV2.getAddress());
  await fpac.grantRole(BURNER_ROLE, await pegEngineV2.getAddress());
  await oracleHub.grantRole(ORACLE_ROLE, deployer.address);

  console.log("✓ Roles granted");

  // Setup oracle feed
  await oracleHub.addOracle("FAIT_USD", deployer.address);
  console.log("✓ Oracle feed FAIT_USD configured");

  // Submit initial price data
  await oracleHub.submitData("FAIT_USD", initialPrice, 95);
  console.log("✓ Initial price data submitted");

  // Display deployment summary
  console.log("\n=== Deployment Summary ===");
  console.log("FPAC Token:", await fpac.getAddress());
  console.log("OracleHub:", await oracleHub.getAddress());
  console.log("PegEngineV2:", await pegEngineV2.getAddress());

  // Display initial status
  const pegStatus = await pegEngineV2.getPegStatus();
  const pathStats = await pegEngineV2.getPathStats();

  console.log("\n=== Initial Status ===");
  console.log("Current Price:", ethers.formatUnits(pegStatus.currentPrice, 18));
  console.log("Target Price:", ethers.formatUnits(pegStatus.currentTargetPrice, 18));
  console.log("Targeting Mode:", pathStats.mode === 0n ? "FAIT" : pathStats.mode === 1n ? "PLT" : "NGDPLT");
  console.log("Cumulative Gap:", pathStats.totalGap.toString(), "basis points");
  console.log("Gap Closed:", pathStats.gapClosedStatus);

  console.log("\n=== Level Targeting Features ===");
  console.log("✓ Path-dependent peg adjustments");
  console.log("✓ Flexible Average Targeting (FAIT) support");
  console.log("✓ Price Level Targeting (PLT) support");
  console.log("✓ Nominal GDP Level Targeting (NGDPLT) support");
  console.log("✓ No time limits on catch-up adjustments");
  console.log("✓ Configurable aggressiveness parameter");
  console.log("✓ Migration support from PegEngineV1");

  console.log("\n=== Example: 1:2 → 2:1 Recovery Pattern ===");
  console.log("1. If FPAC undershoots target by 50% for 1 year");
  console.log("2. System will push for 100% overshoot in year 2");
  console.log("3. Until cumulative gap closes to within tolerance");
  console.log("4. No time limits - keeps adjusting until path is restored");

  console.log("\nDeployment completed successfully! 🎉");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
