import { CPIData, BasketData, PriceData } from './EconomicDataFetcher';

export class DataValidator {
    private readonly MIN_CONFIDENCE = 70;
    private readonly MAX_PRICE_DEVIATION = 0.1; // 10%
    private readonly MIN_CPI_VALUE = 100;
    private readonly MAX_CPI_VALUE = 500;

    validateCPIData(data: CPIData): boolean {
        if (!data || typeof data.value !== 'number') {
            return false;
        }

        // Check if CPI value is within reasonable bounds
        if (data.value < this.MIN_CPI_VALUE || data.value > this.MAX_CPI_VALUE) {
            return false;
        }

        // Check timestamp is recent (within last 24 hours)
        const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
        if (data.timestamp < dayAgo) {
            return false;
        }

        return true;
    }

    validateBasketData(data: BasketData): boolean {
        if (!data || !Array.isArray(data.items) || data.items.length === 0) {
            return false;
        }

        // Validate each basket item
        for (const item of data.items) {
            if (!item.name || typeof item.price !== 'number' || typeof item.weight !== 'number') {
                return false;
            }

            if (item.price <= 0 || item.weight < 0 || item.weight > 1) {
                return false;
            }
        }

        // Check if weights sum to approximately 1 (within 1% tolerance)
        const totalWeight = data.items.reduce((sum, item) => sum + item.weight, 0);
        if (Math.abs(totalWeight - 1) > 0.01) {
            return false;
        }

        // Validate total value calculation
        const calculatedTotal = data.items.reduce((sum, item) => sum + (item.price * item.weight), 0);
        const difference = Math.abs(calculatedTotal - data.totalValue);
        if (difference / data.totalValue > 0.001) { // 0.1% tolerance
            return false;
        }

        return true;
    }

    validatePriceData(data: PriceData): boolean {
        if (!data || typeof data.price !== 'number') {
            return false;
        }

        // Check if price is positive and reasonable
        if (data.price <= 0 || data.price > 10) { // FAIT should be around $1, max $10
            return false;
        }

        // Check timestamp is recent (within last hour for price data)
        const hourAgo = Date.now() - (60 * 60 * 1000);
        if (data.timestamp < hourAgo) {
            return false;
        }

        return true;
    }

    calculateConfidence(data: any, dataType: string): number {
        let confidence = 100; // Start with maximum confidence

        switch (dataType) {
            case 'CPI':
                confidence = this.calculateCPIConfidence(data as CPIData);
                break;
            case 'BASKET':
                confidence = this.calculateBasketConfidence(data as BasketData);
                break;
            case 'PRICE':
                confidence = this.calculatePriceConfidence(data as PriceData);
                break;
            default:
                confidence = 80; // Default confidence
        }

        return Math.max(this.MIN_CONFIDENCE, Math.min(100, confidence));
    }

    private calculateCPIConfidence(data: CPIData): number {
        let confidence = 95; // Base confidence for CPI data

        // Reduce confidence based on data age
        const ageHours = (Date.now() - data.timestamp) / (1000 * 60 * 60);
        if (ageHours > 1) {
            confidence -= Math.min(20, ageHours * 2); // -2 per hour, max -20
        }

        // Check data source reliability
        if (data.source === 'BLS') {
            confidence += 5; // Official source bonus
        } else if (data.source.includes('MOCK')) {
            confidence -= 15; // Mock data penalty
        }

        return Math.round(confidence);
    }

    private calculateBasketConfidence(data: BasketData): number {
        let confidence = 90; // Base confidence for basket data

        // Check number of items
        if (data.items.length < 5) {
            confidence -= 10; // Fewer items = less confidence
        } else if (data.items.length > 10) {
            confidence += 5; // More items = higher confidence
        }

        // Check weight distribution (prefer more balanced weights)
        const weights = data.items.map(item => item.weight);
        const maxWeight = Math.max(...weights);
        if (maxWeight > 0.5) {
            confidence -= 5; // Too much weight on single item
        }

        // Reduce confidence based on data age
        const ageHours = (Date.now() - data.timestamp) / (1000 * 60 * 60);
        if (ageHours > 0.5) {
            confidence -= Math.min(15, ageHours * 3); // -3 per hour, max -15
        }

        return Math.round(confidence);
    }

    private calculatePriceConfidence(data: PriceData): number {
        let confidence = 85; // Base confidence for price data

        // Check how close to expected value ($1 for FAIT)
        const expectedPrice = 1.0;
        const deviation = Math.abs(data.price - expectedPrice) / expectedPrice;
        
        if (deviation > 0.05) { // More than 5% from expected
            confidence -= Math.min(20, deviation * 100); // Reduce based on deviation
        }

        // Reduce confidence based on data age
        const ageMinutes = (Date.now() - data.timestamp) / (1000 * 60);
        if (ageMinutes > 5) {
            confidence -= Math.min(10, ageMinutes / 5); // -1 per 5 minutes, max -10
        }

        // Check data source reliability
        if (data.source.includes('EXCHANGE')) {
            confidence += 5; // Exchange data bonus
        } else if (data.source.includes('MOCK')) {
            confidence -= 10; // Mock data penalty
        }

        return Math.round(confidence);
    }

    validateDataConsistency(currentData: any, previousData: any, dataType: string): boolean {
        if (!previousData) {
            return true; // No previous data to compare
        }

        switch (dataType) {
            case 'CPI':
                return this.validateCPIConsistency(currentData as CPIData, previousData as CPIData);
            case 'PRICE':
                return this.validatePriceConsistency(currentData as PriceData, previousData as PriceData);
            default:
                return true;
        }
    }

    private validateCPIConsistency(current: CPIData, previous: CPIData): boolean {
        // CPI should not change by more than 1% in a short period
        const change = Math.abs(current.value - previous.value) / previous.value;
        const timeDiff = current.timestamp - previous.timestamp;
        
        // Allow larger changes over longer periods
        const maxChangePerHour = 0.001; // 0.1% per hour
        const hours = timeDiff / (1000 * 60 * 60);
        const maxAllowedChange = maxChangePerHour * hours;
        
        return change <= Math.max(0.01, maxAllowedChange); // At least 1% allowed
    }

    private validatePriceConsistency(current: PriceData, previous: PriceData): boolean {
        // Price should not change by more than 10% suddenly
        const change = Math.abs(current.price - previous.price) / previous.price;
        return change <= this.MAX_PRICE_DEVIATION;
    }

    isDataRecentEnough(timestamp: number, maxAgeMinutes: number): boolean {
        const ageMinutes = (Date.now() - timestamp) / (1000 * 60);
        return ageMinutes <= maxAgeMinutes;
    }

    sanitizeDataValue(value: number, min: number, max: number): number {
        return Math.min(Math.max(value, min), max);
    }
}
