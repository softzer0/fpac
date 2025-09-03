# FPAC Level Targeting Upgrade - Implementation Guide

## Overview

This upgrade transforms FPAC from a simple inflation-targeting system to a sophisticated **level targeting** system that implements **Flexible Average Targeting (FAIT)** and **NGDP Level Targeting (NGDPLT)**. The key innovation is **path-dependent adjustments** that ensure long-term peg trajectory maintenance.

## Core Concept Shift

### Before (PegEngineV1)

- Reacted only to current price vs target price
- No memory of past deviations
- Formula: `peg_next = peg_current * (1 + inflation_adj)`

### After (PegEngineV2)

- Tracks cumulative path deviations over time
- Maintains memory of all past gaps
- Formula: `peg_next = peg_current * (1 + inflation_adj) * (gap_ratio ^ α)`

## Key Features

### 1. Path Tracking System

```solidity
struct PathPoint {
    uint256 timestamp;
    uint256 targetValue;      // Expected value at this time
    uint256 actualValue;      // Realized value at this time
    uint256 cumulativeGap;    // Running total of all gaps
}
```

### 2. Three Targeting Modes

- **FAIT**: Standard flexible average inflation targeting
- **PLT**: Price level targeting with growth path
- **NGDPLT**: Nominal GDP level targeting

### 3. Gap-Based Adjustments

- **Cumulative Gap**: Sum of all period-by-period deviations
- **Gap Ratio**: `target_path_value / actual_path_value`
- **Aggressiveness (α)**: Controls how aggressively to close gaps

### 4. No Time Limits

- Traditional inflation targeting has "bygones are bygones"
- Level targeting: **"no bygones"** - all past deviations must be corrected
- System keeps adjusting until cumulative gap is within tolerance

## Example: 1:2 → 2:1 Recovery Pattern

This demonstrates the core difference from traditional targeting:

### Year 1: Undershoot Phase

- **Target Path**: $1.00 → $1.02 (2% growth)
- **Actual Path**: $1.00 → $0.51 (50% drop)
- **Cumulative Gap**: -50% (massive undershoot)
- **Status**: Gap not closed, system needs to compensate

### Year 2: Recovery Phase

- **Traditional System**: Would only care about current 2% inflation target
- **Level Targeting**: Must catch up the entire 50% shortfall
- **Gap Ratio**: 2.0 (target path is 2x actual path)
- **Adjusted Target**: Much higher than base target to force catch-up
- **Result**: System pushes for ~100% overshoot to restore path

### Key Benefits

1. **Long-term Price Stability**: Deviations are temporary, not permanent
2. **Credible Commitment**: Market knows all deviations will be corrected
3. **Path Restoration**: Returns to intended trajectory over time

## Technical Implementation

### Core State Variables

```solidity
// Path tracking
PathPoint[] public pricePath;
int256 public cumulativeGap;
bool public isGapClosed;

// Configuration
TargetingMode public targetingMode;
uint256 public targetGrowthRate;
uint256 public catchupAggressiveness; // α parameter
uint256 public gapTolerance;
```

### Key Functions

#### Path Updates

```solidity
function _updatePathIfNeeded() internal {
    // Adds new path points based on time intervals
    // Calculates period gaps and updates cumulative gap
    // Checks if gap is within tolerance
}
```

#### Adjusted Target Calculation

```solidity
function _calculateAdjustedTarget(uint256 currentPrice) internal view returns (uint256) {
    // If gap is closed, use base target
    // Otherwise, apply gap ratio adjustment
    // Formula: target * (gap_ratio ^ α)
}
```

#### Gap Ratio Calculation

```solidity
function _calculateGapRatio() internal view returns (uint256) {
    // gap_ratio = target_path_value / actual_path_value
    // > 1.0 = undershoot, need to catch up
    // < 1.0 = overshoot, need to slow down
}
```

## Configuration Parameters

### Path Parameters

- **Target Growth Rate**: Annual growth rate (basis points)
- **Path Update Interval**: How often to update path (default: daily)
- **Gap Tolerance**: When gap is considered "closed" (default: ±0.1%)

### Catchup Parameters

- **Aggressiveness (α)**: How aggressively to close gaps (default: 0.5)
  - 0.0 = No gap adjustment (behaves like V1)
  - 1.0 = Direct gap closure attempt
  - 2.0 = Aggressive over-adjustment

### Operational Parameters

- **Peg Tolerance**: Allowed deviation before intervention (default: 1%)
- **Operation Cooldown**: Time between interventions (default: 5 minutes)
- **Daily Operation Limit**: Max operations per day (default: 48)

## Migration from V1

### State Migration

```solidity
function migrateFromV1(
    uint256 v1TotalMinted,
    uint256 v1TotalBurned,
    uint256 v1OperationCount,
    uint256 v1LastOperationTimestamp
) external onlyRole(MIGRATION_ROLE)
```

### Migration Steps

1. Deploy PegEngineV2 with desired parameters
2. Grant necessary roles (MINTER_ROLE, BURNER_ROLE)
3. Call `migrateFromV1()` with V1 state data
4. Transfer any remaining V1 token balances
5. Revoke V1 permissions and update FPAC references

## Oracle Requirements

### Standard Mode (PLT/FAIT)

- **Feed**: `FAIT_USD` - US Dollar price data
- **Frequency**: At least daily updates
- **Confidence**: Minimum 70%
- **Sources**: Minimum 2 oracle sources

### NGDP Mode (NGDPLT)

- **Feed**: `NGDP_USD` - Nominal GDP data
- **Frequency**: Quarterly (official releases)
- **Confidence**: Minimum 70%
- **Sources**: Government statistical agencies

## Testing Strategy

### Unit Tests

- Path tracking accuracy
- Gap calculation correctness
- Adjustment formula validation
- Mode switching functionality

### Integration Tests

- Oracle data integration
- Role permission verification
- Migration process validation
- Emergency intervention capabilities

### Scenario Tests

- **1:2 → 2:1 Recovery**: Major undershoot and recovery
- **Gradual Gap Closure**: Slow convergence to target path
- **Mode Switching**: Changing between FAIT/PLT/NGDPLT
- **Long-term Stability**: Multi-year path maintenance

## Deployment Strategy

### Testnet Deployment

1. Deploy contracts on Sepolia testnet
2. Configure oracle feeds with test data
3. Run scenario simulations
4. Validate gap behavior over time
5. Test migration procedures

### Mainnet Deployment

1. Deploy PegEngineV2 with conservative parameters
2. Run parallel to V1 for observation period
3. Execute migration during low-volatility period
4. Monitor path tracking for first week
5. Gradually increase aggressiveness parameter

## Risk Considerations

### Technical Risks

- **Path Calculation Errors**: Incorrect gap accumulation
- **Oracle Manipulation**: Bad data affecting path tracking
- **Gas Costs**: Complex calculations may increase costs

### Economic Risks

- **Over-Adjustment**: Too aggressive catchup causing volatility
- **Market Confusion**: New behavior may surprise market participants
- **Parameter Miscalibration**: Wrong α or tolerance settings

### Mitigation Strategies

- **Gradual Rollout**: Start with low aggressiveness
- **Circuit Breakers**: Emergency pause functionality
- **Parameter Adjustment**: Admin ability to fine-tune settings
- **Oracle Redundancy**: Multiple data sources and validation

## Expected Benefits

### Short-term

- **Better Peg Maintenance**: More responsive to sustained deviations
- **Reduced Volatility**: Predictable adjustment patterns
- **Market Confidence**: Clear commitment to path restoration

### Long-term

- **Superior Price Stability**: Level targeting prevents drift
- **Economic Efficiency**: Better nominal anchoring
- **Policy Credibility**: Mathematical commitment to targets

## Conclusion

This upgrade represents a fundamental evolution from basic inflation targeting to sophisticated level targeting. The **path-dependent adjustment mechanism** ensures that FPAC maintains its intended trajectory over time, providing superior long-term stability and market confidence.

The **1:2 → 2:1 recovery pattern** demonstrates the system's commitment to correcting all deviations, making FPAC a more credible and stable currency for the DeFi ecosystem.
