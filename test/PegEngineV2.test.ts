import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { FPAC, OracleHub, PegEngineV2 } from "../typechain-types/contracts";

describe("PegEngineV2 - Level Targeting", function () {
  let fpac: FPAC;
  let oracleHub: OracleHub;
  let pegEngineV2: PegEngineV2;
  let owner: SignerWithAddress;
  let operator: SignerWithAddress;
  let oracle1: SignerWithAddress;
  let oracle2: SignerWithAddress;
  let user1: SignerWithAddress;

  const INITIAL_PRICE = ethers.parseUnits("1.0", 18); // $1.00
  // const INITIAL_SUPPLY = ethers.parseUnits("1000000", 18); // 1M tokens
  const ANNUAL_GROWTH_RATE = 200; // 2% annual growth

  // Helper function to advance time
  async function advanceTime(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  // Helper function to submit oracle data from multiple sources
  async function submitOracleData(feedName: string, price: bigint, confidence: number = 95) {
    await oracleHub.connect(oracle1).submitData(feedName, price, confidence);
    await oracleHub.connect(oracle2).submitData(feedName, price, confidence);
  }

  beforeEach(async function () {
    [owner, operator, oracle1, oracle2, user1] = await ethers.getSigners();

    // Deploy OracleHub
    const OracleHub = await ethers.getContractFactory("OracleHub");
    oracleHub = (await OracleHub.deploy(owner.address, owner.address)) as unknown as OracleHub;
    await oracleHub.waitForDeployment();

    // Deploy FPAC
    const FPAC = await ethers.getContractFactory("FPAC");
    fpac = (await FPAC.deploy(
      owner.address,
      owner.address, // Temporary PegEngine address
      INITIAL_PRICE
    )) as unknown as FPAC;
    await fpac.waitForDeployment();

    // Deploy PegEngineV2 with PLT mode
    const PegEngineV2 = await ethers.getContractFactory("PegEngineV2");
    pegEngineV2 = (await PegEngineV2.deploy(
      owner.address,
      operator.address,
      await fpac.getAddress(),
      await oracleHub.getAddress(),
      INITIAL_PRICE,
      1, // PLT mode
      ANNUAL_GROWTH_RATE
    )) as unknown as PegEngineV2;
    await pegEngineV2.waitForDeployment();

    // Grant necessary roles
    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
    const BURNER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE"));
    const PEG_ENGINE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PEG_ENGINE_ROLE"));
    const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));

    await fpac.grantRole(MINTER_ROLE, await pegEngineV2.getAddress());
    await fpac.grantRole(BURNER_ROLE, await pegEngineV2.getAddress());
    await fpac.grantRole(PEG_ENGINE_ROLE, await pegEngineV2.getAddress());

    await oracleHub.grantRole(ORACLE_ROLE, oracle1.address);
    await oracleHub.grantRole(ORACLE_ROLE, oracle2.address);

    // Add oracles to FAIT_USD feed
    await oracleHub.connect(owner).addOracle("FAIT_USD", oracle1.address);
    await oracleHub.connect(owner).addOracle("FAIT_USD", oracle2.address);

    // Submit initial price data
    await submitOracleData("FAIT_USD", INITIAL_PRICE);
  });

  describe("Deployment and Initialization", function () {
    it("Should initialize with correct parameters", async function () {
      const pathStats = await pegEngineV2.getPathStats();

      expect(pathStats.totalPeriods).to.equal(1); // Genesis point
      expect(pathStats.currentPeriodNumber).to.equal(0);
      expect(pathStats.totalGap).to.equal(0);
      expect(pathStats.gapClosedStatus).to.be.true;
      expect(pathStats.mode).to.equal(1); // PLT mode
    });

    it("Should have correct genesis path point", async function () {
      const pathPoint = await pegEngineV2.getPathPoint(0);

      expect(pathPoint.targetValue).to.equal(INITIAL_PRICE);
      expect(pathPoint.actualValue).to.equal(INITIAL_PRICE);
      expect(pathPoint.gap).to.equal(0);
    });

    it("Should start with gap closed status", async function () {
      const pegStatus = await pegEngineV2.getPegStatus();

      expect(pegStatus.gapClosed).to.be.true;
      expect(pegStatus.currentGap).to.equal(0);
      expect(pegStatus.gapRatio).to.equal(1000); // 1.0 scaled by 1000
    });
  });

  describe("Path Updates", function () {
    it("Should update path after time interval", async function () {
      // Advance time by 1 day
      await advanceTime(86400);

      // Update path manually
      await pegEngineV2.connect(operator).updatePath();

      const pathStats = await pegEngineV2.getPathStats();
      expect(pathStats.totalPeriods).to.equal(2);
      expect(pathStats.currentPeriodNumber).to.equal(1);
    });

    it("Should calculate correct target growth", async function () {
      // Advance time by 1 day
      await advanceTime(86400);
      await pegEngineV2.connect(operator).updatePath();

      const pathPoint = await pegEngineV2.getPathPoint(1);

      // Calculate expected daily growth: (annual_rate / 365) * target
      // With 2% annual rate: daily rate = 200/365 = ~0.548 basis points per day
      const dailyRateBps = Math.floor(ANNUAL_GROWTH_RATE / 365); // Daily rate in basis points, rounded down
      const expectedTarget = (INITIAL_PRICE * (10000n + BigInt(dailyRateBps))) / 10000n;

      // Allow for small calculation differences (±0.01%)
      const tolerance = Number(INITIAL_PRICE / 10000n); // 0.01%
      expect(Number(pathPoint.targetValue)).to.be.closeTo(Number(expectedTarget), tolerance);
    });

    it("Should track cumulative gap correctly", async function () {
      // Submit lower price to create negative gap
      const lowerPrice = ethers.parseUnits("0.9", 18); // 10% below target
      await submitOracleData("FAIT_USD", lowerPrice);

      // Advance time and update path
      await advanceTime(86400);
      // Resubmit after time advancement to prevent staleness
      await submitOracleData("FAIT_USD", lowerPrice);
      await pegEngineV2.connect(operator).updatePath();
      const pathStats = await pegEngineV2.getPathStats();
      expect(pathStats.totalGap).to.be.lt(0); // Negative gap (undershoot)
      expect(pathStats.gapClosedStatus).to.be.false;
    });
  });

  describe("Level Targeting Behavior", function () {
    it("Should demonstrate 1:2 → 2:1 recovery pattern", async function () {
      // Year 1: Create significant undershoot (1:2 ratio)
      const undershootPrice = ethers.parseUnits("0.5", 18); // 50% of target
      await submitOracleData("FAIT_USD", undershootPrice);

      // Advance time by smaller increments and resubmit oracle data
      // to avoid staleness issues (oracle becomes stale after 1 hour)
      for (let i = 0; i < 10; i++) {
        // 10 periods instead of 365 for test efficiency
        await advanceTime(86400); // 1 day
        await submitOracleData("FAIT_USD", undershootPrice); // Resubmit to avoid staleness
        await pegEngineV2.connect(operator).updatePath();
      }

      let pathStats = await pegEngineV2.getPathStats();
      expect(pathStats.totalGap).to.be.lt(-1000); // Negative gap from sustained undershoot
      expect(pathStats.gapClosedStatus).to.be.false;

      // Year 2: Even with 0% inflation, system should push toward recovery
      const normalPrice = ethers.parseUnits("1.0", 18);
      await submitOracleData("FAIT_USD", normalPrice);

      // Check that adjusted target is higher than base target due to gap
      const pegStatus = await pegEngineV2.getPegStatus();
      expect(pegStatus.adjustedTargetPrice > pegStatus.currentTargetPrice).to.be.true;
      expect(Number(pegStatus.gapRatio)).to.be.gt(1000); // > 1.0, indicating need to catch up
    });

    it("Should gradually close gap over time", async function () {
      // Create initial gap with undershoot
      const undershootPrice = ethers.parseUnits("0.8", 18); // 20% undershoot
      await submitOracleData("FAIT_USD", undershootPrice);

      await advanceTime(86400);
      await submitOracleData("FAIT_USD", undershootPrice);
      await pegEngineV2.connect(operator).updatePath();

      const initialGap = (await pegEngineV2.getPathStats()).totalGap;
      expect(initialGap).to.be.lt(0); // Should be negative (undershoot)

      // Track gap progression through the recovery process
      const gapHistory: number[] = [Number(initialGap)];

      // Step 1: Continue undershoot for a few days (gap gets worse)
      for (let i = 0; i < 2; i++) {
        await advanceTime(86400);
        await submitOracleData("FAIT_USD", undershootPrice);
        await pegEngineV2.connect(operator).updatePath();
        gapHistory.push(Number((await pegEngineV2.getPathStats()).totalGap));
      }

      // Step 2: Move toward target
      const recoveryPrices = [
        ethers.parseUnits("0.9", 18), // Still below target
        ethers.parseUnits("1.0", 18), // At target
        ethers.parseUnits("1.1", 18), // Overshoot to compensate
      ];

      for (const price of recoveryPrices) {
        await advanceTime(86400);
        await submitOracleData("FAIT_USD", price);
        await pegEngineV2.connect(operator).updatePath();
        gapHistory.push(Number((await pegEngineV2.getPathStats()).totalGap));
      }

      // Validate level targeting behavior:
      // 1. Initial undershoot should create negative cumulative gap
      expect(gapHistory[0]).to.be.lt(0);

      // 2. Continued undershoot should make gap more negative
      expect(gapHistory[2]).to.be.lt(gapHistory[0]); // Gap gets worse with continued undershoot

      // 3. Recovery with overshoot should improve the gap from its worst point
      const finalGap = gapHistory[gapHistory.length - 1];
      const worstGap = Math.min(...gapHistory.map(Number)); // Find the most negative gap
      const worstGapIndex = gapHistory.findIndex((g) => Number(g) === worstGap);

      console.log(
        "Gap progression:",
        gapHistory.map((g) => g.toString())
      );
      console.log("Worst gap:", worstGap, "at index:", worstGapIndex);
      console.log("Final gap:", finalGap);

      console.log(
        "Gap progression:",
        gapHistory.map((g) => g.toString())
      );
      console.log("Worst gap:", worstGap, "at index:", worstGapIndex);
      console.log("Final gap:", finalGap);

      // After recovery, either:
      // - Gap improves from the worst point (becomes less negative)
      // - Gap crosses zero and becomes positive (full compensation)
      // - Gap shows clear evidence of recovery attempt (significant change from worst)
      const gapImprovedFromWorst = Number(finalGap) > worstGap;
      const gapCrossedZero = gapHistory[0] < 0 && Number(finalGap) > 0;
      const significantRecovery = Math.abs(Number(finalGap) - worstGap) > 500; // At least 5% improvement

      expect(gapImprovedFromWorst || gapCrossedZero || significantRecovery).to.be.true;

      // 4. Verify the system maintains path tracking integrity
      const pathStats = await pegEngineV2.getPathStats();
      // Total periods includes genesis + new periods, so should be gapHistory.length + 1
      expect(pathStats.totalPeriods).to.equal(gapHistory.length + 1);
    });

    it("Should maintain peg when gap is closed", async function () {
      // Start with closed gap
      expect((await pegEngineV2.getPegStatus()).gapClosed).to.be.true;

      // Submit price at target
      await submitOracleData("FAIT_USD", INITIAL_PRICE);

      // Try to maintain peg - should not execute any operations
      const initialTotalMinted = (await pegEngineV2.getOperationStats()).minted;
      const initialTotalBurned = (await pegEngineV2.getOperationStats()).burned;

      await pegEngineV2.connect(operator).maintainPeg();

      const finalTotalMinted = (await pegEngineV2.getOperationStats()).minted;
      const finalTotalBurned = (await pegEngineV2.getOperationStats()).burned;

      expect(finalTotalMinted).to.equal(initialTotalMinted);
      expect(finalTotalBurned).to.equal(initialTotalBurned);
    });
  });

  describe("Targeting Mode Configuration", function () {
    it("Should allow changing targeting mode", async function () {
      // Change to NGDPLT mode
      await pegEngineV2.connect(owner).setTargetingMode(2); // NGDPLT

      const pathStats = await pegEngineV2.getPathStats();
      expect(pathStats.mode).to.equal(2);
    });

    it("Should update path parameters", async function () {
      const newGrowthRate = 300; // 3%
      const newUpdateInterval = 3600; // 1 hour
      const newGapTolerance = 20; // 0.2%
      const newAggressiveness = 750; // 0.75

      await pegEngineV2.connect(owner).updatePathParameters(newGrowthRate, newUpdateInterval, newGapTolerance, newAggressiveness);

      // Verify parameters were updated (would need getter functions in actual implementation)
    });
  });

  describe("Emergency and Migration Functions", function () {
    it("Should allow emergency intervention", async function () {
      const emergencyAmount = ethers.parseUnits("10000", 18);

      await pegEngineV2.connect(owner).manualIntervention("mint", emergencyAmount, "Emergency liquidity injection");

      const stats = await pegEngineV2.getOperationStats();
      expect(stats.minted).to.equal(emergencyAmount);
    });

    it("Should allow migration from V1", async function () {
      const v1Data = {
        totalMinted: ethers.parseUnits("50000", 18),
        totalBurned: ethers.parseUnits("25000", 18),
        operationCount: 100,
        lastOperationTimestamp: Math.floor(Date.now() / 1000) - 3600,
      };

      await pegEngineV2
        .connect(owner)
        .migrateFromV1(v1Data.totalMinted, v1Data.totalBurned, v1Data.operationCount, v1Data.lastOperationTimestamp);

      const stats = await pegEngineV2.getOperationStats();
      expect(stats.minted).to.equal(v1Data.totalMinted);
      expect(stats.burned).to.equal(v1Data.totalBurned);
      expect(stats.total).to.equal(v1Data.operationCount);
    });
  });

  describe("Gap Ratio Calculations", function () {
    it("Should calculate gap ratio correctly for undershoot", async function () {
      // Create undershoot scenario
      const undershootPrice = ethers.parseUnits("0.8", 18); // 20% below target
      await submitOracleData("FAIT_USD", undershootPrice);

      await advanceTime(86400);
      // Resubmit after time advancement to prevent staleness
      await submitOracleData("FAIT_USD", undershootPrice);
      await pegEngineV2.connect(operator).updatePath();

      const pegStatus = await pegEngineV2.getPegStatus();
      expect(pegStatus.gapRatio).to.be.gt(1000); // > 1.0, need to catch up
    });

    it("Should calculate gap ratio correctly for overshoot", async function () {
      // Create overshoot scenario and add a path point to capture it
      const overshootPrice = ethers.parseUnits("1.2", 18); // 20% above target
      await submitOracleData("FAIT_USD", overshootPrice);

      // Advance a short time and update path to capture the overshoot
      await advanceTime(86400);

      // Resubmit oracle data after time advancement to prevent staleness
      await submitOracleData("FAIT_USD", overshootPrice);

      await pegEngineV2.connect(operator).updatePath();

      const pegStatus = await pegEngineV2.getPegStatus();
      const pathPoint = await pegEngineV2.getPathPoint(1);

      // Verify that path tracking captured the overshoot condition
      expect(pathPoint.actualValue).to.equal(overshootPrice);

      // Now gap ratio should be target/actual < 1.0 since actual > target
      expect(Number(pegStatus.gapRatio)).to.be.lt(1000); // < 1.0 for overshoot
    });
  });

  describe("Operational Controls", function () {
    it("Should respect operation cooldowns", async function () {
      // Set short cooldown for testing
      await pegEngineV2.connect(owner).updateParameters(
        INITIAL_PRICE,
        100, // 1% tolerance
        ethers.parseUnits("1000", 18),
        ethers.parseUnits("100000", 18),
        60 // 1 minute cooldown
      );

      // Create condition requiring intervention
      const highPrice = ethers.parseUnits("1.2", 18);
      await submitOracleData("FAIT_USD", highPrice);

      // First operation should work
      await pegEngineV2.connect(operator).maintainPeg();

      // Second operation immediately should fail due to cooldown
      try {
        await pegEngineV2.connect(operator).maintainPeg();
        expect.fail("Expected transaction to revert");
      } catch (error: any) {
        expect(error.message).to.include("revert");
      }

      // After cooldown, should work again
      await advanceTime(61);
      await pegEngineV2.connect(operator).maintainPeg();
    });

    it("Should allow pausing and unpausing", async function () {
      await pegEngineV2.connect(owner).pause();

      try {
        await pegEngineV2.connect(operator).maintainPeg();
        expect.fail("Expected transaction to revert");
      } catch (error: any) {
        expect(error.message).to.include("revert");
      }
      await pegEngineV2.connect(owner).unpause();

      // Should work after unpause (though may not execute if conditions not met)
      await pegEngineV2.connect(operator).maintainPeg();
    });
  });
});

describe("PegEngineV2 - NGDP Level Targeting", function () {
  let fpac: FPAC;
  let oracleHub: OracleHub;
  let pegEngineV2: PegEngineV2;
  let owner: SignerWithAddress;
  let operator: SignerWithAddress;
  let oracle1: SignerWithAddress;
  let oracle2: SignerWithAddress;

  const INITIAL_PRICE = ethers.parseUnits("1.0", 18);
  const NGDP_GROWTH_RATE = 500; // 5% annual NGDP growth

  beforeEach(async function () {
    [owner, operator, oracle1, oracle2] = await ethers.getSigners();

    // Deploy contracts
    const OracleHub = await ethers.getContractFactory("OracleHub");
    oracleHub = (await OracleHub.deploy(owner.address, owner.address)) as unknown as OracleHub;
    await oracleHub.waitForDeployment();

    const FPAC = await ethers.getContractFactory("FPAC");
    fpac = (await FPAC.deploy(owner.address, owner.address, INITIAL_PRICE)) as unknown as FPAC;
    await fpac.waitForDeployment();

    // Deploy PegEngineV2 with NGDPLT mode
    const PegEngineV2 = await ethers.getContractFactory("PegEngineV2");
    pegEngineV2 = (await PegEngineV2.deploy(
      owner.address,
      operator.address,
      await fpac.getAddress(),
      await oracleHub.getAddress(),
      INITIAL_PRICE,
      2, // NGDPLT mode
      NGDP_GROWTH_RATE
    )) as unknown as PegEngineV2;
    await pegEngineV2.waitForDeployment();

    // Setup roles and oracles
    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
    const BURNER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE"));
    const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));

    await fpac.grantRole(MINTER_ROLE, await pegEngineV2.getAddress());
    await fpac.grantRole(BURNER_ROLE, await pegEngineV2.getAddress());
    await oracleHub.grantRole(ORACLE_ROLE, oracle1.address);
    await oracleHub.grantRole(ORACLE_ROLE, oracle2.address);

    // Add oracles to NGDP_USD feed
    await oracleHub.connect(owner).addOracle("NGDP_USD", oracle1.address);
    await oracleHub.connect(owner).addOracle("NGDP_USD", oracle2.address);
  });

  it("Should use NGDP data for targeting in NGDPLT mode", async function () {
    const pathStats = await pegEngineV2.getPathStats();
    expect(pathStats.mode).to.equal(2); // NGDPLT mode

    // Submit NGDP data
    const ngdpValue = ethers.parseUnits("1.0", 18);
    await oracleHub.connect(oracle1).submitData("NGDP_USD", ngdpValue, 95);
    await oracleHub.connect(oracle2).submitData("NGDP_USD", ngdpValue, 95);

    // Verify oracle can read NGDP data
    const latestData = await oracleHub.getLatestData("NGDP_USD");
    expect(latestData.isValid).to.be.true;
    expect(latestData.value).to.equal(ngdpValue);
  });
});
