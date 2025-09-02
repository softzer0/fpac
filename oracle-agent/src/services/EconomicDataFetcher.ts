import axios from 'axios';
import { addMonths, isAfter, setHours, setMinutes, setSeconds, setMilliseconds, differenceInHours, format } from 'date-fns';
import { Config } from '../config/config';

export interface CPIData {
    value: number;
    timestamp: number;
    source: string;
}

export interface BasketData {
    items: Array<{
        name: string;
        price: number;
        weight: number;
    }>;
    totalValue: number;
    timestamp: number;
}

export interface PriceData {
    price: number;
    timestamp: number;
    source: string;
}

export class EconomicDataFetcher {
    private config: Config;
    private cpiCache: { 
        data: CPIData | null; 
        fetchedAt: Date;
        period: string; // Store the data period (e.g., "2025M09") to detect new releases
    } = { 
        data: null, 
        fetchedAt: new Date(0),
        period: ''
    };
    
    constructor(config: Config) {
        this.config = config;
    }

    /**
     * Get the next expected CPI release date
     * CPI is typically released 10th-15th of each month at 8:30 AM ET
     */
    private getNextCPIReleaseDate(): Date {
        const now = new Date();
        let nextRelease = new Date(now.getFullYear(), now.getMonth(), 12);
        
        // Set to 8:30 AM ET (13:30 UTC)
        nextRelease = setHours(setMinutes(setSeconds(setMilliseconds(nextRelease, 0), 0), 30), 13);
        
        // If we're past the 15th, move to next month
        if (now.getDate() > 15) {
            nextRelease = addMonths(nextRelease, 1);
        }
        
        return nextRelease;
    }

    async fetchCPIData(forceRefresh: boolean = false): Promise<CPIData> {
        const now = new Date();
        const nextExpectedRelease = this.getNextCPIReleaseDate();
        
        // For financial precision: always check for new data if we're past expected release time
        // or if explicitly requested, or if cache is older than 1 hour (safety margin)
        const hoursSinceLastFetch = differenceInHours(now, this.cpiCache.fetchedAt);
        const shouldCheckForNewData = forceRefresh || 
            isAfter(now, nextExpectedRelease) || 
            hoursSinceLastFetch > 1 ||
            !this.cpiCache.data;

        if (!shouldCheckForNewData && this.cpiCache.data) {
            return this.cpiCache.data;
        }

        try {
            // Fetch real CPI data from Bureau of Labor Statistics API
            // NOTE: Using v1.0 (25 requests/day limit). For production, register for v2.0 (500/day)
            // Registration: https://data.bls.gov/registrationEngine/
            const response = await axios.get('https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0');
            
            if (response.data.status !== 'REQUEST_SUCCEEDED') {
                throw new Error(`BLS API error: ${response.data.message}`);
            }
            
            const series = response.data.Results.series[0];
            if (!series || !series.data || series.data.length === 0) {
                throw new Error('No CPI data available from BLS API');
            }
            
            // Get the latest data point (first in array is most recent)
            const latestData = series.data.find((item: any) => item.latest === "true") || series.data[0];
            
            const cpiData: CPIData = {
                value: parseFloat(latestData.value),
                timestamp: now.getTime(), // Keep as number for blockchain compatibility
                source: 'BLS'
            };

            // Check if this is actually new data (different period)
            const currentPeriod = `${latestData.year}M${latestData.period.padStart(2, '0')}`;
            if (this.cpiCache.period === currentPeriod && this.cpiCache.data && !forceRefresh) {
                // Same data period, return cached data
                return this.cpiCache.data;
            }

            // Cache the new data with period tracking for precision
            this.cpiCache = { 
                data: cpiData, 
                fetchedAt: now,
                period: currentPeriod
            };
            
            console.log(`New CPI data fetched for period ${currentPeriod}: ${cpiData.value}`);
            return cpiData;
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 429) {
                throw new Error('BLS API rate limit exceeded (25/day for v1.0). Consider registering for v2.0 (500/day)');
            }
            throw new Error(`Failed to fetch CPI data: ${error}`);
        }
    }

    /**
     * Force refresh CPI data - useful when you need the absolute latest data
     * for critical financial operations
     */
    async refreshCPIData(): Promise<CPIData> {
        return this.fetchCPIData(true);
    }

    /**
     * Get cached CPI data info for debugging
     */
    getCacheInfo(): { hasData: boolean; fetchedAt: string; period: string; ageInHours: number } {
        const now = new Date();
        const ageInHours = differenceInHours(now, this.cpiCache.fetchedAt);
        
        return {
            hasData: !!this.cpiCache.data,
            fetchedAt: format(this.cpiCache.fetchedAt, 'yyyy-MM-dd HH:mm:ss'),
            period: this.cpiCache.period,
            ageInHours: Math.round(ageInHours * 100) / 100
        };
    }

    async fetchBasketPrices(): Promise<BasketData> {
        try {
            // Mock implementation - replace with actual basket price API
            // This would typically aggregate prices from multiple sources
            
            const mockBasketItems = [
                { name: 'Housing', price: 1500, weight: 0.42 },
                { name: 'Transportation', price: 450, weight: 0.17 },
                { name: 'Food', price: 350, weight: 0.13 },
                { name: 'Healthcare', price: 400, weight: 0.08 },
                { name: 'Recreation', price: 250, weight: 0.06 },
                { name: 'Education', price: 200, weight: 0.03 },
                { name: 'Apparel', price: 100, weight: 0.03 },
                { name: 'Other', price: 300, weight: 0.08 }
            ];

            // Add some random variation
            const items = mockBasketItems.map(item => ({
                ...item,
                price: item.price * (0.95 + Math.random() * 0.1) // ±5% variation
            }));

            const totalValue = items.reduce((sum, item) => sum + (item.price * item.weight), 0);

            return {
                items,
                totalValue: Math.round(totalValue * 100) / 100,
                timestamp: new Date().getTime()
            };

        } catch (error) {
            throw new Error(`Failed to fetch basket prices: ${error}`);
        }
    }

    async fetchFAITPrice(): Promise<PriceData> {
        try {
            // Mock implementation - replace with actual FAIT price API
            // This would integrate with exchanges or price aggregators
            
            const mockFAITPrice = 1.00 + (Math.random() - 0.5) * 0.02; // Mock around $1.00 ±1 cent

            return {
                price: Math.round(mockFAITPrice * 10000) / 10000, // Round to 4 decimals
                timestamp: new Date().getTime(), // Keep as number for consistency
                source: 'EXCHANGE_MOCK'
            };

            // Real implementation would look like:
            /*
            const response = await axios.get(this.config.api.faitPriceApiUrl, {
                headers: {
                    'Authorization': `Bearer ${this.config.api.economicDataApiKey}`
                }
            });
            
            return {
                price: response.data.price,
                timestamp: response.data.timestamp,
                source: response.data.source
            };
            */
        } catch (error) {
            throw new Error(`Failed to fetch FAIT price: ${error}`);
        }
    }

    async fetchExchangeRates(): Promise<{ [currency: string]: number }> {
        try {
            // Mock implementation for currency exchange rates
            return {
                'EUR': 0.85 + (Math.random() - 0.5) * 0.02,
                'GBP': 0.75 + (Math.random() - 0.5) * 0.02,
                'JPY': 110 + (Math.random() - 0.5) * 2,
                'CAD': 1.25 + (Math.random() - 0.5) * 0.02,
                'AUD': 1.35 + (Math.random() - 0.5) * 0.02
            };
        } catch (error) {
            throw new Error(`Failed to fetch exchange rates: ${error}`);
        }
    }

    async fetchInflationData(): Promise<{ rate: number; timestamp: number }> {
        try {
            // Mock implementation for inflation rate
            const mockInflationRate = 0.025 + (Math.random() - 0.5) * 0.005; // Around 2.5%

            return {
                rate: Math.round(mockInflationRate * 10000) / 10000,
                timestamp: new Date().getTime()
            };
        } catch (error) {
            throw new Error(`Failed to fetch inflation data: ${error}`);
        }
    }
}
