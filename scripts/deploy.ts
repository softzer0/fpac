import { ethers } from "hardhat";
import { Contract, ContractFactory } from "ethers";
import fs from "fs";
import path from "path";

interface DeploymentAddresses {
  OracleHub: string;
  FPAC: string;
  PegEngine: string;
  ReserveManager: string;
  GovernanceToken: string;
  Treasury: string;
  deployer: string;
  network: string;
  timestamp: number;
}

async function main() {
  console.log("🚀 Starting FPAC deployment...");
  
  const [deployer] = await ethers.getSigners();
  console.log("📋 Deploying contracts with account:", deployer.address);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", ethers.formatEther(balance), "ETH");
  
  if (balance === 0n) {
    throw new Error("❌ Deployer account has no ETH for gas fees");
  }

  // Deployment configuration
  const INITIAL_FAIT_PRICE = ethers.parseUnits("1.0", 18); // $1.00 in wei
  const network = await ethers.provider.getNetwork();
  
  console.log(`🌐 Deploying to network: ${network.name} (${network.chainId})`);

  // Deploy contracts in order
  const addresses: Partial<DeploymentAddresses> = {
    deployer: deployer.address,
    network: network.name,
    timestamp: Date.now()
  };

  try {
    // 1. Deploy OracleHub
    console.log("\n📊 Deploying OracleHub...");
    const OracleHub = await ethers.getContractFactory("OracleHub");
    const oracleHub = await OracleHub.deploy(deployer.address, deployer.address);
    await oracleHub.waitForDeployment();
    addresses.OracleHub = await oracleHub.getAddress();
    console.log("✅ OracleHub deployed to:", addresses.OracleHub);

    // 2. Deploy FPAC Token
    console.log("\n🪙 Deploying FPAC Token...");
    const FPAC = await ethers.getContractFactory("FPAC");
    const fpac = await FPAC.deploy(
      deployer.address,
      deployer.address, // Temporary PegEngine address
      INITIAL_FAIT_PRICE
    );
    await fpac.waitForDeployment();
    addresses.FPAC = await fpac.getAddress();
    console.log("✅ FPAC deployed to:", addresses.FPAC);

    // 3. Deploy PegEngine
    console.log("\n⚙️ Deploying PegEngine...");
    const PegEngine = await ethers.getContractFactory("PegEngine");
    const pegEngine = await PegEngine.deploy(
      deployer.address,
      deployer.address,
      addresses.FPAC,
      addresses.OracleHub,
      INITIAL_FAIT_PRICE
    );
    await pegEngine.waitForDeployment();
    addresses.PegEngine = await pegEngine.getAddress();
    console.log("✅ PegEngine deployed to:", addresses.PegEngine);

    // 4. Deploy ReserveManager
    console.log("\n🏦 Deploying ReserveManager...");
    const ReserveManager = await ethers.getContractFactory("ReserveManager");
    const reserveManager = await ReserveManager.deploy(
      deployer.address,
      deployer.address
    );
    await reserveManager.waitForDeployment();
    addresses.ReserveManager = await reserveManager.getAddress();
    console.log("✅ ReserveManager deployed to:", addresses.ReserveManager);

    // 5. Deploy GovernanceToken
    console.log("\n🗳️ Deploying GovernanceToken...");
    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    const governanceToken = await GovernanceToken.deploy(
      deployer.address,
      deployer.address
    );
    await governanceToken.waitForDeployment();
    addresses.GovernanceToken = await governanceToken.getAddress();
    console.log("✅ GovernanceToken deployed to:", addresses.GovernanceToken);

    // 6. Deploy Treasury
    console.log("\n🏛️ Deploying Treasury...");
    const Treasury = await ethers.getContractFactory("Treasury");
    const treasury = await Treasury.deploy(
      deployer.address,
      deployer.address
    );
    await treasury.waitForDeployment();
    addresses.Treasury = await treasury.getAddress();
    console.log("✅ Treasury deployed to:", addresses.Treasury);

    // Post-deployment configuration
    console.log("\n🔧 Configuring contracts...");

    // Grant PegEngine the necessary roles on FPAC
    console.log("- Granting PegEngine roles on FPAC...");
    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
    const BURNER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE"));
    const PEG_ENGINE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PEG_ENGINE_ROLE"));
    
    await fpac.grantRole(MINTER_ROLE, addresses.PegEngine);
    await fpac.grantRole(BURNER_ROLE, addresses.PegEngine);
    await fpac.grantRole(PEG_ENGINE_ROLE, addresses.PegEngine);

    // Add deployer as oracle for initial setup
    console.log("- Adding deployer as oracle...");
    await oracleHub.addOracle("FAIT_USD", deployer.address);
    await oracleHub.addOracle("CPI_USA", deployer.address);
    await oracleHub.addOracle("BASKET_PRICES", deployer.address);

    // Submit initial oracle data
    console.log("- Submitting initial oracle data...");
    await oracleHub.submitData("FAIT_USD", INITIAL_FAIT_PRICE, 85);
    await oracleHub.submitData("CPI_USA", ethers.parseUnits("310.5", 2), 90); // CPI with 2 decimals
    await oracleHub.submitData("BASKET_PRICES", ethers.parseUnits("350.75", 2), 85);

    // Save deployment addresses
    console.log("\n💾 Saving deployment addresses...");
    const deploymentsDir = path.join(__dirname, "..", "deployments");
    if (!fs.existsSync(deploymentsDir)) {
      fs.mkdirSync(deploymentsDir, { recursive: true });
    }

    const deploymentFile = path.join(deploymentsDir, `${network.name}-${Date.now()}.json`);
    fs.writeFileSync(deploymentFile, JSON.stringify(addresses, null, 2));
    
    // Also save as latest
    const latestFile = path.join(deploymentsDir, `${network.name}-latest.json`);
    fs.writeFileSync(latestFile, JSON.stringify(addresses, null, 2));

    console.log("📄 Deployment addresses saved to:", deploymentFile);

    // Generate oracle agent config
    console.log("\n🤖 Generating oracle agent config...");
    const oracleConfig = {
      network: {
        rpcUrl: network.name === "sepolia" ? "https://sepolia.infura.io/v3/YOUR_INFURA_PROJECT_ID" : "http://localhost:8545",
        chainId: Number(network.chainId),
        oracleHubAddress: addresses.OracleHub
      },
      contracts: addresses,
      deployment: {
        timestamp: addresses.timestamp,
        deployer: addresses.deployer,
        network: network.name
      }
    };

    const oracleConfigFile = path.join(__dirname, "..", "oracle-agent", "config.json");
    fs.writeFileSync(oracleConfigFile, JSON.stringify(oracleConfig, null, 2));
    console.log("🤖 Oracle config saved to:", oracleConfigFile);

    // Deployment summary
    console.log("\n🎉 Deployment completed successfully!");
    console.log("📋 Contract Addresses:");
    console.log("┌─────────────────┬──────────────────────────────────────────────┐");
    console.log("│ Contract        │ Address                                      │");
    console.log("├─────────────────┼──────────────────────────────────────────────┤");
    console.log(`│ OracleHub       │ ${addresses.OracleHub}                     │`);
    console.log(`│ FPAC            │ ${addresses.FPAC}                     │`);
    console.log(`│ PegEngine       │ ${addresses.PegEngine}                     │`);
    console.log(`│ ReserveManager  │ ${addresses.ReserveManager}                     │`);
    console.log(`│ GovernanceToken │ ${addresses.GovernanceToken}                     │`);
    console.log(`│ Treasury        │ ${addresses.Treasury}                     │`);
    console.log("└─────────────────┴──────────────────────────────────────────────┘");

    console.log("\n📝 Next Steps:");
    console.log("1. Update your .env file with the contract addresses");
    console.log("2. Fund the PegEngine with FPAC tokens for burning operations");
    console.log("3. Set up the oracle agent with the generated config");
    console.log("4. Configure additional oracles for redundancy");
    console.log("5. Set up governance and treasury operations");

    if (network.name !== "hardhat" && network.name !== "localhost") {
      console.log("\n🔍 Verify contracts on Etherscan:");
      console.log(`npx hardhat verify --network ${network.name} ${addresses.OracleHub} "${deployer.address}" "${deployer.address}"`);
      console.log(`npx hardhat verify --network ${network.name} ${addresses.FPAC} "${deployer.address}" "${deployer.address}" "${INITIAL_FAIT_PRICE}"`);
      console.log(`npx hardhat verify --network ${network.name} ${addresses.PegEngine} "${deployer.address}" "${deployer.address}" "${addresses.FPAC}" "${addresses.OracleHub}" "${INITIAL_FAIT_PRICE}"`);
    }

  } catch (error) {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("❌ Deployment script failed:", error);
  process.exit(1);
});
