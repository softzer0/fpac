import dotenv from "dotenv";
import { ethers } from "ethers";
import cron from "node-cron";
import { Config } from "./config/config";
import { DataValidator } from "./services/DataValidator";
import { EconomicDataFetcher } from "./services/EconomicDataFetcher";
import { OracleSubmitter } from "./services/OracleSubmitter";
import { Logger } from "./utils/logger";

dotenv.config();

class OracleAgent {
  private logger: Logger;
  private dataFetcher: EconomicDataFetcher;
  private oracleSubmitter: OracleSubmitter;
  private dataValidator: DataValidator;
  private config: Config;

  constructor() {
    this.logger = new Logger("OracleAgent");
    this.config = new Config();
    this.dataFetcher = new EconomicDataFetcher(this.config);
    this.oracleSubmitter = new OracleSubmitter(this.config);
    this.dataValidator = new DataValidator();
  }

  async initialize(): Promise<void> {
    try {
      this.logger.info("Initializing Oracle Agent...");

      // Initialize services
      await this.oracleSubmitter.initialize();

      this.logger.info("Oracle Agent initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize Oracle Agent:", error);
      throw error;
    }
  }

  async start(): Promise<void> {
    await this.initialize();

    // Schedule regular data updates
    this.scheduleDataUpdates();

    // Perform initial data fetch and submission
    await this.updateEconomicData();

    this.logger.info("Oracle Agent started successfully");
  }

  private scheduleDataUpdates(): void {
    // Update CPI data every hour
    cron.schedule("0 * * * *", async () => {
      this.logger.info("Scheduled CPI data update starting...");
      await this.updateCPIData();
    });

    // Update basket prices every 30 minutes
    cron.schedule("*/30 * * * *", async () => {
      this.logger.info("Scheduled basket price update starting...");
      await this.updateBasketPrices();
    });

    // Update FAIT price every 5 minutes
    cron.schedule("*/5 * * * *", async () => {
      this.logger.info("Scheduled FAIT price update starting...");
      await this.updateFAITPrice();
    });

    this.logger.info("Data update schedules configured");
  }

  private async updateEconomicData(): Promise<void> {
    try {
      await Promise.all([this.updateCPIData(), this.updateBasketPrices(), this.updateFAITPrice()]);
    } catch (error) {
      this.logger.error("Error updating economic data:", error);
    }
  }

  private async updateCPIData(): Promise<void> {
    try {
      this.logger.info("Fetching CPI data...");

      const cpiData = await this.dataFetcher.fetchCPIData();

      if (!this.dataValidator.validateCPIData(cpiData)) {
        this.logger.warn("CPI data validation failed");
        return;
      }

      const confidence = this.dataValidator.calculateConfidence(cpiData, "CPI");

      await this.oracleSubmitter.submitData("CPI_USA", cpiData.value, confidence);

      this.logger.info(`CPI data submitted: ${cpiData.value} (confidence: ${confidence}%)`);
    } catch (error) {
      this.logger.error("Error updating CPI data:", error);
    }
  }

  private async updateBasketPrices(): Promise<void> {
    try {
      this.logger.info("Fetching basket prices...");

      const basketData = await this.dataFetcher.fetchBasketPrices();

      if (!this.dataValidator.validateBasketData(basketData)) {
        this.logger.warn("Basket data validation failed");
        return;
      }

      const confidence = this.dataValidator.calculateConfidence(basketData, "BASKET");

      await this.oracleSubmitter.submitData("BASKET_PRICES", basketData.totalValue, confidence);

      this.logger.info(`Basket prices submitted: ${basketData.totalValue} (confidence: ${confidence}%)`);
    } catch (error) {
      this.logger.error("Error updating basket prices:", error);
    }
  }

  private async updateFAITPrice(): Promise<void> {
    try {
      this.logger.info("Fetching FAIT price...");

      const faitPrice = await this.dataFetcher.fetchFAITPrice();

      if (!this.dataValidator.validatePriceData(faitPrice)) {
        this.logger.warn("FAIT price validation failed");
        return;
      }

      const confidence = this.dataValidator.calculateConfidence(faitPrice, "PRICE");

      // Convert to wei (18 decimals)
      const priceInWei = ethers.parseUnits(faitPrice.price.toString(), 18);

      await this.oracleSubmitter.submitData("FAIT_USD", priceInWei, confidence);

      this.logger.info(`FAIT price submitted: $${faitPrice.price} (confidence: ${confidence}%)`);
    } catch (error) {
      this.logger.error("Error updating FAIT price:", error);
    }
  }

  async stop(): Promise<void> {
    this.logger.info("Stopping Oracle Agent...");
    // Cleanup logic here if needed
    this.logger.info("Oracle Agent stopped");
  }
}

// Main execution
async function main() {
  const agent = new OracleAgent();

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nReceived SIGINT, shutting down gracefully...");
    await agent.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nReceived SIGTERM, shutting down gracefully...");
    await agent.stop();
    process.exit(0);
  });

  try {
    await agent.start();
  } catch (error) {
    console.error("Failed to start Oracle Agent:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { OracleAgent };
