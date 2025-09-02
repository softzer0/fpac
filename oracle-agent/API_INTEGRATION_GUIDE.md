# FPAC Oracle Agent - API Integration Guide

This guide explains how to set up and use the real API integrations in the FPAC oracle system.

## 📊 Integrated APIs

### 1. Bureau of Labor Statistics (BLS) - CPI Data ✅
- **Purpose**: Real-time Consumer Price Index data
- **Cost**: Free (25 requests/day for v1.0)
- **Setup**: No API key required for basic usage
- **Upgrade**: Register at [BLS Registration](https://data.bls.gov/registrationEngine/) for 500 requests/day
- **Smart Caching**: Reduces usage to ~1-2 calls per month based on release schedule

### 2. CoinGecko - Cryptocurrency Prices ✅  
- **Purpose**: FAIT token price data
- **Cost**: Free (10,000 calls/month)
- **Setup**: No API key required
- **Fallback**: Mock data if FAIT token not listed
- **Documentation**: [CoinGecko API Docs](https://www.coingecko.com/en/api/documentation)

### 3. ExchangeRate-API - Foreign Exchange Rates ✅
- **Purpose**: Real-time forex rates for multiple currencies
- **Cost**: Free (1,500 requests/month via open access)
- **Setup**: No API key required for basic usage
- **Upgrade**: $10/month for 30,000 requests
- **Documentation**: [ExchangeRate-API Docs](https://www.exchangerate-api.com/docs/free)

### 4. Alpha Vantage - Commodity Data ✅
- **Purpose**: Oil prices and commodity indices for basket pricing
- **Cost**: Free (25 requests/day)
- **Setup**: Register for API key at [Alpha Vantage](https://www.alphavantage.co/support/#api-key)
- **Environment Variable**: `ALPHA_VANTAGE_API_KEY`

### 5. World Bank API - Inflation Data ✅
- **Purpose**: Global inflation rates
- **Cost**: Free, no limits
- **Setup**: No API key required
- **Fallback**: FRED API with optional API key
- **Documentation**: [World Bank API](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392)

## 🚀 Quick Setup

### 1. Install Dependencies
```bash
cd oracle-agent
npm install
```

### 2. Set up Environment Variables
```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and add your API keys (optional for most services)
```

### 3. Required API Keys (Optional)
Most services work without API keys, but for production use:

```bash
# Alpha Vantage (for better commodity data)
ALPHA_VANTAGE_API_KEY=your_key_here

# FRED (for inflation data fallback)
FRED_API_KEY=your_key_here
```

### 4. Test the APIs
```bash
# Run the oracle agent
npm start

# Check logs for API status
# ✅ = Real data successfully fetched
# ⚠️ = Fallback to mock data
```

## 📈 API Rate Limits & Costs

| API | Free Tier | Paid Options | Our Usage |
|-----|-----------|--------------|-----------|
| BLS | 25/day | 500/day ($0) | ~1-2/month |
| CoinGecko | 10,000/month | Various plans | ~1,440/month |
| ExchangeRate-API | 1,500/month | $10/month | ~1,440/month |
| Alpha Vantage | 25/day | $50/month | ~1/day |
| World Bank | Unlimited | Free | ~30/month |

**Total Monthly Cost**: $0 (all free tiers sufficient for our usage)

## 🔧 Configuration Options

### Cache Settings
- **CPI Data**: Cached based on release periods, smart invalidation
- **Exchange Rates**: Daily updates sufficient (rates don't change hourly)
- **Commodity Data**: Used for basket pricing variation, updated daily

### Error Handling
All APIs include:
- Timeout protection (10 seconds)
- Graceful fallback to mock data
- Detailed error logging
- Rate limit detection and warnings

### Production Recommendations

1. **Register for API keys** to get higher rate limits
2. **Enable monitoring** for API health checks
3. **Set up alerts** for API failures
4. **Consider paid tiers** for mission-critical applications

## 🛠️ API Integration Details

### CPI Data Integration
```typescript
// Smart caching with period detection
const cpiData = await fetcher.fetchCPIData();
// Returns: { value: 310.3, timestamp: 1640995200000, source: 'BLS' }

// Force refresh for critical operations
const freshData = await fetcher.refreshCPIData();
```

### FAIT Price Integration  
```typescript
// Real price from CoinGecko or fallback
const faitPrice = await fetcher.fetchFAITPrice();
// Returns: { price: 1.002, timestamp: 1640995200000, source: 'COINGECKO' }
```

### Exchange Rates Integration
```typescript
// Multiple currencies in one call
const rates = await fetcher.fetchExchangeRates();
// Returns: { EUR: 0.85, GBP: 0.75, JPY: 110, ... }
```

## 🔍 Monitoring & Debugging

### Check API Status
```typescript
// Get cache information
const cacheInfo = fetcher.getCacheInfo();
console.log(`CPI data age: ${cacheInfo.ageInHours} hours`);
```

### Enable Debug Logging
```bash
# In .env file
DEBUG=true

# View detailed API logs
npm start
```

### API Health Dashboard
Monitor API status and response times:
- BLS API: [Status Page](https://www.bls.gov/developers/api_signature_v2.htm)
- CoinGecko: [Status Page](https://status.coingecko.com/)
- ExchangeRate-API: [Status Page](http://stats.pingdom.com/qv69spvrz94m)

## 🚨 Troubleshooting

### Common Issues

1. **BLS Rate Limit Exceeded**
   ```
   Error: BLS API rate limit exceeded (25/day for v1.0)
   Solution: Register for v2.0 API key for 500/day limit
   ```

2. **FAIT Token Not Found**
   ```
   Warning: FAIT token not found on CoinGecko, using mock data
   Solution: Update token ID once FAIT is listed on CoinGecko
   ```

3. **Network Timeouts**
   ```
   Error: timeout of 10000ms exceeded
   Solution: APIs will fallback to mock data, check network connectivity
   ```

### API Key Setup Issues
```bash
# Verify API keys are loaded
echo $ALPHA_VANTAGE_API_KEY
echo $FRED_API_KEY

# Test API connectivity
curl "https://www.alphavantage.co/query?function=WTI&apikey=YOUR_KEY"
```

## 📚 Further Resources

- [BLS API Documentation](https://www.bls.gov/developers/api_signature_v2.htm)
- [CoinGecko API Documentation](https://www.coingecko.com/en/api/documentation)
- [ExchangeRate-API Documentation](https://www.exchangerate-api.com/docs)
- [Alpha Vantage Documentation](https://www.alphavantage.co/documentation/)
- [World Bank API Documentation](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392)

## 💡 Next Steps

1. **Test API integrations** in development environment
2. **Register for API keys** for production deployment
3. **Set up monitoring** for API health and rate limits
4. **Configure alerts** for API failures or rate limit warnings
5. **Consider paid tiers** based on actual usage patterns

The oracle system is now ready to use real economic data from multiple reliable sources! 🎉
