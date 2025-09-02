import { ethers } from "hardhat";

async function main() {
  console.log("🧪 Starting contract interaction demo...");
  
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  
  console.log("👤 Account:", deployer.address);
  console.log("🌐 Network:", network.name);

  // In a real scenario, you would load these from deployment files
  // For now, we'll show how to interact with deployed contracts
  
  try {
    // Example contract addresses (replace with actual addresses after deployment)
    const FPAC_ADDRESS = "0x0000000000000000000000000000000000000000"; // Replace with actual
    const ORACLE_HUB_ADDRESS = "0x0000000000000000000000000000000000000000"; // Replace with actual
    const PEG_ENGINE_ADDRESS = "0x0000000000000000000000000000000000000000"; // Replace with actual

    // Get contract instances
    const fpac = await ethers.getContractAt("FPAC", FPAC_ADDRESS);
    const oracleHub = await ethers.getContractAt("OracleHub", ORACLE_HUB_ADDRESS);
    const pegEngine = await ethers.getContractAt("PegEngine", PEG_ENGINE_ADDRESS);

    console.log("\n📊 FPAC Token Information:");
    const name = await fpac.name();
    const symbol = await fpac.symbol();
    const totalSupply = await fpac.totalSupply();
    const targetPrice = await fpac.getTargetPrice();
    const currentPrice = await fpac.getCurrentPrice();

    console.log(`Name: ${name}`);
    console.log(`Symbol: ${symbol}`);
    console.log(`Total Supply: ${ethers.formatEther(totalSupply)} FPAC`);
    console.log(`Target Price: $${ethers.formatEther(targetPrice)}`);
    console.log(`Current Price: $${ethers.formatEther(currentPrice)}`);
    console.log(`Peg Maintained: ${await fpac.isPegMaintained()}`);

    console.log("\n🔮 Oracle Hub Status:");
    const [value, timestamp, confidence, isValid] = await oracleHub.getLatestData("FAIT_USD");
    console.log(`FAIT/USD Price: $${ethers.formatEther(value)}`);
    console.log(`Last Update: ${new Date(Number(timestamp) * 1000).toISOString()}`);
    console.log(`Confidence: ${confidence}%`);
    console.log(`Is Valid: ${isValid}`);

    console.log("\n⚙️ Peg Engine Status:");
    const [currentPriceStatus, targetPriceStatus, deviation, pegMaintained, canOperate] = await pegEngine.getPegStatus();
    console.log(`Current Price: $${ethers.formatEther(currentPriceStatus)}`);
    console.log(`Target Price: $${ethers.formatEther(targetPriceStatus)}`);
    console.log(`Deviation: ${deviation} basis points`);
    console.log(`Peg Maintained: ${pegMaintained}`);
    console.log(`Can Operate: ${canOperate}`);

    const [totalOps, totalMinted, totalBurned, lastOp, dailyOps] = await pegEngine.getOperationStats();
    console.log(`Total Operations: ${totalOps}`);
    console.log(`Total Minted: ${ethers.formatEther(totalMinted)} FPAC`);
    console.log(`Total Burned: ${ethers.formatEther(totalBurned)} FPAC`);
    console.log(`Last Operation: ${new Date(Number(lastOp) * 1000).toISOString()}`);
    console.log(`Daily Operations: ${dailyOps}`);

    console.log("\n✅ Contract interaction demo completed!");

  } catch (error) {
    console.error("❌ Error during contract interaction:", error);
    console.log("\n💡 Note: Make sure to replace the contract addresses with actual deployed addresses");
  }
}

main().catch((error) => {
  console.error("❌ Demo script failed:", error);
  process.exit(1);
});
