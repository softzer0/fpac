import { ethers } from 'ethers';
import { Config } from '../config/config';
import { Logger } from '../utils/logger';

// Oracle Hub ABI (simplified for data submission)
const ORACLE_HUB_ABI = [
    "function submitData(string calldata feedName, uint256 value, uint256 confidence) external",
    "function getLatestData(string calldata feedName) external view returns (uint256 value, uint256 timestamp, uint256 confidence, bool isValid)",
    "function isDataStale(string calldata feedName) external view returns (bool)"
];

export class OracleSubmitter {
    private config: Config;
    private logger: Logger;
    private provider!: ethers.JsonRpcProvider;
    private wallet!: ethers.Wallet;
    private oracleHub!: ethers.Contract;

    constructor(config: Config) {
        this.config = config;
        this.logger = new Logger('OracleSubmitter');
    }

    async initialize(): Promise<void> {
        try {
            // Initialize provider
            this.provider = new ethers.JsonRpcProvider(this.config.network.rpcUrl);
            
            // Initialize wallet
            this.wallet = new ethers.Wallet(this.config.privateKey, this.provider);
            
            // Initialize contract
            this.oracleHub = new ethers.Contract(
                this.config.network.oracleHubAddress,
                ORACLE_HUB_ABI,
                this.wallet
            );

            // Verify connection
            const network = await this.provider.getNetwork();
            this.logger.info(`Connected to network: ${network.name} (${network.chainId})`);
            
            const balance = await this.provider.getBalance(this.wallet.address);
            this.logger.info(`Oracle wallet balance: ${ethers.formatEther(balance)} ETH`);
            
            if (balance === 0n) {
                this.logger.warn('Oracle wallet has no ETH for gas fees');
            }

        } catch (error) {
            this.logger.error('Failed to initialize Oracle Submitter:', error);
            throw error;
        }
    }

    async submitData(feedName: string, value: bigint | number, confidence: number): Promise<void> {
        try {
            // Convert value to bigint if it's a number
            const valueBI = typeof value === 'number' ? BigInt(Math.floor(value)) : value;
            
            this.logger.debug(`Submitting data for ${feedName}:`, {
                value: valueBI.toString(),
                confidence
            });

            // Check if data is significantly different from last submission
            const shouldSubmit = await this.shouldSubmitData(feedName, valueBI, confidence);
            if (!shouldSubmit) {
                this.logger.debug(`Skipping submission for ${feedName} - no significant change`);
                return;
            }

            // Estimate gas
            const gasEstimate = await this.oracleHub.submitData.estimateGas(
                feedName,
                valueBI,
                confidence
            );

            // Add 20% buffer to gas estimate
            const gasLimit = gasEstimate * 120n / 100n;

            // Submit transaction
            const tx = await this.oracleHub.submitData(
                feedName,
                valueBI,
                confidence,
                { gasLimit }
            );

            this.logger.info(`Data submission transaction sent:`, {
                feedName,
                value: valueBI.toString(),
                confidence,
                txHash: tx.hash
            });

            // Wait for confirmation
            const receipt = await tx.wait();
            
            if (receipt.status === 1) {
                this.logger.info(`Data submission confirmed:`, {
                    feedName,
                    txHash: tx.hash,
                    blockNumber: receipt.blockNumber,
                    gasUsed: receipt.gasUsed.toString()
                });
            } else {
                throw new Error(`Transaction failed: ${tx.hash}`);
            }

        } catch (error) {
            this.logger.error(`Failed to submit data for ${feedName}:`, error);
            
            // Check for specific error types
            if (error && typeof error === 'object' && 'code' in error) {
                if ((error as any).code === 'INSUFFICIENT_FUNDS') {
                    this.logger.error('Insufficient funds for gas fees');
                } else if ((error as any).code === 'NONCE_EXPIRED') {
                    this.logger.error('Nonce expired - transaction may have been replaced');
                }
            }
            
            throw error;
        }
    }

    private async shouldSubmitData(feedName: string, newValue: bigint, newConfidence: number): Promise<boolean> {
        try {
            // Get current data from contract
            const [currentValue, timestamp, confidence, isValid] = await this.oracleHub.getLatestData(feedName);
            
            // Always submit if no valid data exists
            if (!isValid) {
                return true;
            }

            // Check if data is stale
            const isStale = await this.oracleHub.isDataStale(feedName);
            if (isStale) {
                return true;
            }

            // Calculate percentage change
            const currentValueBI = BigInt(currentValue.toString());
            if (currentValueBI === 0n) {
                return true; // Submit if current value is 0
            }

            const difference = newValue > currentValueBI 
                ? newValue - currentValueBI 
                : currentValueBI - newValue;
            
            const percentageChange = (difference * 10000n) / currentValueBI; // In basis points
            
            // Submit if change is > 0.1% (10 basis points) or confidence changed significantly
            const significantPriceChange = percentageChange > 10n;
            const significantConfidenceChange = Math.abs(newConfidence - Number(confidence)) > 5;
            
            return significantPriceChange || significantConfidenceChange;

        } catch (error) {
            // If we can't read current data, submit anyway
            this.logger.warn(`Could not read current data for ${feedName}, submitting anyway:`, error);
            return true;
        }
    }

    async getLatestData(feedName: string): Promise<{
        value: bigint;
        timestamp: number;
        confidence: number;
        isValid: boolean;
    }> {
        try {
            const [value, timestamp, confidence, isValid] = await this.oracleHub.getLatestData(feedName);
            
            return {
                value: BigInt(value.toString()),
                timestamp: Number(timestamp),
                confidence: Number(confidence),
                isValid
            };
        } catch (error) {
            this.logger.error(`Failed to get latest data for ${feedName}:`, error);
            throw error;
        }
    }

    async isDataStale(feedName: string): Promise<boolean> {
        try {
            return await this.oracleHub.isDataStale(feedName);
        } catch (error) {
            this.logger.error(`Failed to check if data is stale for ${feedName}:`, error);
            return true; // Assume stale if we can't check
        }
    }

    async getWalletInfo(): Promise<{
        address: string;
        balance: string;
        nonce: number;
    }> {
        const balance = await this.provider.getBalance(this.wallet.address);
        const nonce = await this.provider.getTransactionCount(this.wallet.address);
        
        return {
            address: this.wallet.address,
            balance: ethers.formatEther(balance),
            nonce
        };
    }
}
