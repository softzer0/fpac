# FPAC Deployment Guide 🚀

Complete step-by-step guide to deploy and operate the FPAC currency system.

## 📋 Pre-Deployment Checklist

### System Requirements

- [ ] Node.js 18+ installed
- [ ] Git installed
- [ ] MetaMask or compatible wallet
- [ ] Testnet ETH for gas fees
- [ ] API keys for data sources

### Account Setup

- [ ] Deployment account with sufficient ETH
- [ ] Separate oracle account for data submission
- [ ] Multi-sig wallet for admin operations (recommended)
- [ ] Backup and secure all private keys

### API Keys Required

- [ ] Infura/Alchemy RPC endpoints
- [ ] Etherscan API key for verification
- [ ] Economic data API keys (BLS, FRED, etc.)
- [ ] Exchange API keys for price data

## 🔧 Step 1: Environment Setup

### Clone and Install

```bash
git clone https://github.com/your-org/fpac-currency-system.git
cd fpac-currency-system
npm install
```

### Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Network RPC URLs
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_PROJECT_ID
MAINNET_RPC_URL=https://mainnet.infura.io/v3/YOUR_INFURA_PROJECT_ID

# Deployment account private key (without 0x)
PRIVATE_KEY=your_private_key_here

# Oracle account private key
ORACLE_PRIVATE_KEY=your_oracle_private_key_here

# API keys
ETHERSCAN_API_KEY=your_etherscan_api_key
CPI_API_KEY=your_bls_api_key
ECONOMIC_DATA_API_KEY=your_fred_api_key

# Configuration
DEPLOY_VERIFY=true
REPORT_GAS=true
```

### Verify Setup

```bash
# Compile contracts
npm run build

# Run tests
npm test

# Check account balances
npx hardhat run scripts/check-balance.ts --network sepolia
```

## 🚀 Step 2: Testnet Deployment

### Deploy to Sepolia

```bash
# Deploy all contracts
npm run deploy:sepolia
```

The deployment script will:

1. Deploy all smart contracts in correct order
2. Configure roles and permissions
3. Initialize with safe parameters
4. Submit initial oracle data
5. Generate configuration files
6. Output contract addresses

### Verify Deployment

```bash
# Verify contracts on Etherscan
npm run verify

# Test basic functionality
npx hardhat run scripts/interact.ts --network sepolia
```

### Expected Output

```
🎉 Deployment completed successfully!
📋 Contract Addresses:
┌─────────────────┬──────────────────────────────────────────────┐
│ Contract        │ Address                                      │
├─────────────────┼──────────────────────────────────────────────┤
│ OracleHub       │ 0x1234567890123456789012345678901234567890 │
│ FPAC            │ 0x2345678901234567890123456789012345678901 │
│ PegEngine       │ 0x3456789012345678901234567890123456789012 │
│ ReserveManager  │ 0x4567890123456789012345678901234567890123 │
│ GovernanceToken │ 0x5678901234567890123456789012345678901234 │
│ Treasury        │ 0x6789012345678901234567890123456789012345 │
└─────────────────┴──────────────────────────────────────────────┘
```

## 🔮 Step 3: Oracle Agent Setup

### Configure Oracle Agent

```bash
cd oracle-agent
npm install
cp .env.example .env
```

Edit `oracle-agent/.env`:

```env
RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_PROJECT_ID
CHAIN_ID=11155111
ORACLE_HUB_ADDRESS=0x1234567890123456789012345678901234567890
ORACLE_PRIVATE_KEY=your_oracle_private_key_here

# API Configuration
CPI_API_KEY=your_bls_api_key
ECONOMIC_DATA_API_KEY=your_economic_data_key
FAIT_PRICE_API_URL=https://api.exchange.com/fait/price

# Update intervals (milliseconds)
UPDATE_INTERVAL=300000  # 5 minutes
CONFIDENCE_THRESHOLD=70
MAX_RETRIES=3
```

### Start Oracle Agent

```bash
# Build and start oracle agent
npm run build
npm start
```

Expected output:

```
🤖 Oracle Agent started successfully
📊 Fetching CPI data...
✅ CPI data submitted: 310.5 (confidence: 90%)
🛒 Fetching basket prices...
✅ Basket prices submitted: 350.75 (confidence: 85%)
💱 Fetching FAIT price...
✅ FAIT price submitted: $1.00 (confidence: 88%)
```

## 🧪 Step 4: System Testing

### Test Peg Maintenance

```bash
# Check current peg status
npx hardhat run scripts/check-peg-status.ts --network sepolia

# Test manual peg operation (if needed)
npx hardhat run scripts/test-peg-maintenance.ts --network sepolia
```

### Test Oracle Operations

```bash
# Check oracle data
npx hardhat run scripts/check-oracle-data.ts --network sepolia

# Submit test data
npx hardhat run scripts/test-oracle-submission.ts --network sepolia
```

### Test Emergency Functions

```bash
# Test pause/unpause (admin only)
npx hardhat run scripts/test-emergency.ts --network sepolia
```

## 🏦 Step 5: Reserve Management

### Add Reserve Assets

```bash
# Example: Add USDC as reserve asset
npx hardhat run scripts/add-reserve-asset.ts --network sepolia
```

Example script content:

```typescript
async function addUSDCReserve() {
  const reserveManager = await ethers.getContractAt("ReserveManager", RESERVE_MANAGER_ADDRESS);

  const USDC_ADDRESS = "0xA0b86a33E6441218B99e6E3e0a23B4C4F8E5E2E7"; // Sepolia USDC
  const weight = 5000; // 50%
  const minReserveRatio = 15000; // 150%

  await reserveManager.addAsset(USDC_ADDRESS, weight, minReserveRatio);
  console.log("✅ USDC added as reserve asset");
}
```

### Fund Reserves

```bash
# Deposit initial reserves
npx hardhat run scripts/fund-reserves.ts --network sepolia
```

## 📊 Step 6: Monitoring Setup

### Set Up Monitoring

```bash
# Install monitoring dependencies
npm install --save-dev @openzeppelin/defender-client

# Configure monitoring scripts
npx hardhat run scripts/setup-monitoring.ts --network sepolia
```

### Key Metrics to Monitor

- Peg deviation from target price
- Oracle data freshness and confidence
- Reserve collateralization ratio
- PegEngine operation frequency
- Gas usage and costs

### Recommended Alerts

- Peg deviation > 1%
- Oracle data older than 2 hours
- Reserve ratio < 120%
- Failed oracle submissions
- Unusual transaction patterns

## 🔒 Step 7: Security Hardening

### Multi-Signature Setup

```bash
# Deploy Gnosis Safe for admin operations
npx hardhat run scripts/setup-multisig.ts --network sepolia

# Transfer admin roles to multisig
npx hardhat run scripts/transfer-admin.ts --network sepolia
```

### Role Management

```bash
# Review and minimize role assignments
npx hardhat run scripts/audit-roles.ts --network sepolia

# Set up role-based monitoring
npx hardhat run scripts/setup-role-monitoring.ts --network sepolia
```

## 🌐 Step 8: Mainnet Preparation

### Pre-Mainnet Checklist

- [ ] Complete security audit
- [ ] Comprehensive testing on testnet
- [ ] Oracle data sources verified and stable
- [ ] Multi-sig wallet configured
- [ ] Emergency procedures documented
- [ ] Monitoring and alerting active
- [ ] Team training completed

### Mainnet Deployment

```bash
# Deploy to mainnet (use with extreme caution)
npm run deploy:mainnet

# Verify all contracts
npm run verify

# Set up production oracles
npm run oracle:production
```

### Post-Mainnet Steps

1. **Monitor closely** for first 24-48 hours
2. **Verify oracle operations** are working correctly
3. **Test peg maintenance** with small amounts
4. **Set up governance** for parameter changes
5. **Enable public access** once stable

## 🚨 Emergency Procedures

### Emergency Pause

```bash
# Pause all operations if critical issue detected
npx hardhat run scripts/emergency-pause.ts --network sepolia
```

### Oracle Override

```bash
# Manual oracle data submission if automated system fails
npx hardhat run scripts/manual-oracle.ts --network sepolia
```

### Reserve Emergency Withdrawal

```bash
# Emergency reserve withdrawal (admin only)
npx hardhat run scripts/emergency-withdraw.ts --network sepolia
```

## 📋 Maintenance Schedule

### Daily Tasks

- [ ] Monitor peg deviation
- [ ] Check oracle health
- [ ] Review operation logs
- [ ] Verify reserve ratios

### Weekly Tasks

- [ ] Update oracle data sources if needed
- [ ] Review governance proposals
- [ ] Analyze system performance metrics
- [ ] Check for security updates

### Monthly Tasks

- [ ] Comprehensive system health review
- [ ] Update documentation
- [ ] Review and update emergency procedures
- [ ] Stakeholder reporting

## 📞 Support and Resources

### Getting Help

- **Documentation**: Full technical documentation
- **Discord**: Community support and discussions
- **GitHub Issues**: Bug reports and feature requests
- **Email**: Technical support for critical issues

### Useful Commands

```bash
# Check system status
npm run status

# Generate health report
npm run health-check

# Backup configuration
npm run backup

# Update oracle agent
npm run oracle:update
```

## ✅ Deployment Verification

After successful deployment, verify:

- [ ] All contracts deployed and verified on Etherscan
- [ ] Oracle agent running and submitting data
- [ ] Peg maintenance functioning correctly
- [ ] Reserve management operational
- [ ] Emergency controls accessible
- [ ] Monitoring and alerts active

**Congratulations! Your FPAC system is now deployed and operational.** 🎉

---

_For additional support or questions, please refer to the documentation or contact the development team._
