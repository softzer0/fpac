export interface NetworkConfig {
  rpcUrl: string;
  chainId: number;
  oracleHubAddress: string;
}

export interface APIConfig {
  cpiApiKey: string;
  economicDataApiKey: string;
  faitPriceApiUrl: string;
  basketPriceApiUrl: string;
}

export class Config {
  public readonly network: NetworkConfig;
  public readonly api: APIConfig;
  public readonly privateKey: string;
  public readonly updateInterval: number;
  public readonly maxRetries: number;
  public readonly confidenceThreshold: number;

  constructor() {
    // Network configuration
    this.network = {
      rpcUrl: process.env.RPC_URL || "https://sepolia.infura.io/v3/YOUR_PROJECT_ID",
      chainId: parseInt(process.env.CHAIN_ID || "11155111"), // Sepolia
      oracleHubAddress: process.env.ORACLE_HUB_ADDRESS || "0x0000000000000000000000000000000000000000",
    };

    // API configuration
    this.api = {
      cpiApiKey: process.env.CPI_API_KEY || "",
      economicDataApiKey: process.env.ECONOMIC_DATA_API_KEY || "",
      faitPriceApiUrl: process.env.FAIT_PRICE_API_URL || "https://api.example.com/fait/price",
      basketPriceApiUrl: process.env.BASKET_PRICE_API_URL || "https://api.example.com/basket/prices",
    };

    // Oracle configuration
    this.privateKey = process.env.ORACLE_PRIVATE_KEY || "";
    this.updateInterval = parseInt(process.env.UPDATE_INTERVAL || "300000"); // 5 minutes default
    this.maxRetries = parseInt(process.env.MAX_RETRIES || "3");
    this.confidenceThreshold = parseInt(process.env.CONFIDENCE_THRESHOLD || "70");

    this.validateConfig();
  }

  private validateConfig(): void {
    if (!this.privateKey) {
      throw new Error("ORACLE_PRIVATE_KEY environment variable is required");
    }

    if (!this.network.oracleHubAddress || this.network.oracleHubAddress === "0x0000000000000000000000000000000000000000") {
      throw new Error("ORACLE_HUB_ADDRESS environment variable is required");
    }

    if (!this.network.rpcUrl.includes("http")) {
      throw new Error("Invalid RPC_URL environment variable");
    }
  }

  public isMainnet(): boolean {
    return this.network.chainId === 1;
  }

  public isTestnet(): boolean {
    return this.network.chainId !== 1;
  }
}
