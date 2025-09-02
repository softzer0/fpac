import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  console.log("🔍 Starting contract verification...");

  // Read deployment addresses
  const network = await ethers.provider.getNetwork();
  const deploymentFile = path.join(__dirname, "..", "deployments", `${network.name}-latest.json`);
  
  if (!fs.existsSync(deploymentFile)) {
    throw new Error(`❌ Deployment file not found: ${deploymentFile}`);
  }

  const addresses = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
  console.log("📋 Loaded deployment addresses from:", deploymentFile);

  const INITIAL_FAIT_PRICE = ethers.parseUnits("1.0", 18);

  // Verification commands
  const verificationCommands = [
    {
      name: "OracleHub",
      address: addresses.OracleHub,
      constructorArgs: [addresses.deployer, addresses.deployer]
    },
    {
      name: "FPAC",
      address: addresses.FPAC,
      constructorArgs: [addresses.deployer, addresses.deployer, INITIAL_FAIT_PRICE.toString()]
    },
    {
      name: "PegEngine",
      address: addresses.PegEngine,
      constructorArgs: [
        addresses.deployer,
        addresses.deployer,
        addresses.FPAC,
        addresses.OracleHub,
        INITIAL_FAIT_PRICE.toString()
      ]
    },
    {
      name: "ReserveManager",
      address: addresses.ReserveManager,
      constructorArgs: [addresses.deployer, addresses.deployer]
    },
    {
      name: "GovernanceToken",
      address: addresses.GovernanceToken,
      constructorArgs: [addresses.deployer, addresses.deployer]
    },
    {
      name: "Treasury",
      address: addresses.Treasury,
      constructorArgs: [addresses.deployer, addresses.deployer]
    }
  ];

  console.log("\n🔧 Verification commands:");
  console.log("Run these commands to verify contracts on Etherscan:\n");

  for (const contract of verificationCommands) {
    const argsString = contract.constructorArgs.map(arg => `"${arg}"`).join(" ");
    console.log(`npx hardhat verify --network ${network.name} ${contract.address} ${argsString}`);
  }

  // Also save verification script
  const verifyScript = verificationCommands
    .map(contract => {
      const argsString = contract.constructorArgs.map(arg => `"${arg}"`).join(" ");
      return `npx hardhat verify --network ${network.name} ${contract.address} ${argsString}`;
    })
    .join("\n");

  const verifyScriptFile = path.join(__dirname, "..", "verify-contracts.sh");
  fs.writeFileSync(verifyScriptFile, `#!/bin/bash\n# Contract verification script\n\n${verifyScript}\n`);
  
  console.log(`\n📄 Verification script saved to: ${verifyScriptFile}`);
  console.log("Make it executable with: chmod +x verify-contracts.sh");
}

main().catch((error) => {
  console.error("❌ Verification script failed:", error);
  process.exit(1);
});
