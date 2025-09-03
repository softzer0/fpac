import { ethers } from "hardhat";

async function main() {
  console.log("=== FPAC Level Targeting Demonstration ===\n");

  // This script demonstrates the 1:2 → 2:1 recovery pattern
  // and shows how level targeting differs from traditional inflation targeting

  const [deployer] = await ethers.getSigners();

  // Deploy contracts (simplified for demo)
  const OracleHub = await ethers.getContractFactory("OracleHub");
  const oracleHub = await OracleHub.deploy(deployer.address, deployer.address);
  await oracleHub.waitForDeployment();

  const FPAC = await ethers.getContractFactory("FPAC");
  const initialPrice = ethers.parseUnits("1.0", 18);
  const fpac = await FPAC.deploy(deployer.address, deployer.address, initialPrice);
  await fpac.waitForDeployment();

  const PegEngineV2 = await ethers.getContractFactory("PegEngineV2");
  const annualGrowthRate = 200; // 2% annual growth
  const pegEngine = await PegEngineV2.deploy(
    deployer.address,
    deployer.address,
    await fpac.getAddress(),
    await oracleHub.getAddress(),
    initialPrice,
    1, // PLT mode
    annualGrowthRate
  );
  await pegEngine.waitForDeployment();

  // Setup permissions and oracle
  const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
  await oracleHub.grantRole(ORACLE_ROLE, deployer.address);
  await oracleHub.addOracle("FAIT_USD", deployer.address);

  console.log("Contracts deployed and configured ✓\n");

  // Helper function to advance time and update path
  async function advanceTimeAndUpdate(days: number) {
    await ethers.provider.send("evm_increaseTime", [days * 86400]);
    await ethers.provider.send("evm_mine", []);
    await pegEngine.updatePath();
  }

  // Helper function to submit price and display status
  async function submitPriceAndDisplay(price: string, description: string) {
    const priceWei = ethers.parseUnits(price, 18);
    await oracleHub.submitData("FAIT_USD", priceWei, 95);

    const pegStatus = await pegEngine.getPegStatus();
    const pathStats = await pegEngine.getPathStats();

    console.log(`${description}:`);
    console.log(`  Current Price: $${price}`);
    console.log(`  Target Price: $${ethers.formatUnits(pegStatus.currentTargetPrice, 18)}`);
    console.log(`  Adjusted Target: $${ethers.formatUnits(pegStatus.adjustedTargetPrice, 18)}`);
    console.log(`  Cumulative Gap: ${pathStats.totalGap.toString()} basis points`);
    console.log(`  Gap Closed: ${pathStats.gapClosedStatus}`);
    console.log(`  Gap Ratio: ${Number(pegStatus.gapRatio) / 1000}`);
    console.log("");
  }

  // === DEMONSTRATION SCENARIO ===

  console.log("=== Scenario: 1:2 → 2:1 Recovery Pattern ===\n");

  // Initial state
  await submitPriceAndDisplay("1.00", "Day 0: Initial State");

  // Year 1: Major undershoot (1:2 ratio)
  console.log("📉 YEAR 1: Major undershoot occurs...");
  await submitPriceAndDisplay("0.50", "Day 1: Major undershoot to $0.50 (50% of target)");

  // Advance 365 days to simulate 1 year
  await advanceTimeAndUpdate(365);
  await submitPriceAndDisplay("0.50", "Day 365: Still at $0.50 after 1 year");

  console.log("Traditional inflation targeting: Would only care about current 2% target");
  console.log("Level targeting: Must catch up entire 50% shortfall + 1 year of growth\n");

  // Year 2: Recovery begins (even with 0% underlying inflation)
  console.log("📈 YEAR 2: Recovery phase begins...");
  await submitPriceAndDisplay("1.00", "Day 366: Price returns to $1.00");

  console.log("Notice:");
  console.log("- Adjusted target is HIGHER than base target");
  console.log("- Gap ratio > 1.0 indicates need to catch up");
  console.log("- System will push for overshoot to restore path\n");

  // Demonstrate overshoot needed for catch-up
  await submitPriceAndDisplay("1.50", "Day 367: Price overshoots to $1.50");
  await submitPriceAndDisplay("2.00", "Day 368: Price reaches $2.00 (2:1 recovery)");

  console.log("=== Key Insights ===");
  console.log("1. Level targeting has 'memory' of past deviations");
  console.log("2. All gaps must eventually be closed - 'no bygones'");
  console.log("3. Temporary overshoots are necessary to restore long-term path");
  console.log("4. System provides credible commitment to price stability");

  console.log("\n=== Traditional vs Level Targeting ===");
  console.log("Traditional: 'Bygones are bygones' - only current target matters");
  console.log("Level: 'No bygones' - must correct all historical deviations");
  console.log("Result: Level targeting provides superior long-term stability");

  console.log("\nDemonstration completed! 🎯");
}

// Run demonstration
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
