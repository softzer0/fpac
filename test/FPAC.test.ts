import { expect } from "chai";
import { ethers } from "hardhat";
import { FPAC, OracleHub, PegEngine } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("FPAC Token", function () {
  let fpac: FPAC;
  let oracleHub: OracleHub;
  let pegEngine: PegEngine;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  const INITIAL_PRICE = ethers.parseUnits("1.0", 18); // $1.00
  const INITIAL_SUPPLY = ethers.parseUnits("1000000", 18); // 1M tokens

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy OracleHub
    const OracleHub = await ethers.getContractFactory("OracleHub");
    oracleHub = await OracleHub.deploy(owner.address, owner.address);
    await oracleHub.waitForDeployment();

    // Deploy FPAC
    const FPAC = await ethers.getContractFactory("FPAC");
    fpac = await FPAC.deploy(
      owner.address,
      owner.address, // Temporary PegEngine address
      INITIAL_PRICE
    );
    await fpac.waitForDeployment();

    // Deploy PegEngine
    const PegEngine = await ethers.getContractFactory("PegEngine");
    pegEngine = await PegEngine.deploy(
      owner.address,
      owner.address,
      await fpac.getAddress(),
      await oracleHub.getAddress(),
      INITIAL_PRICE
    );
    await pegEngine.waitForDeployment();

    // Grant PegEngine roles
    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
    const BURNER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE"));
    const PEG_ENGINE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PEG_ENGINE_ROLE"));
    
    await fpac.grantRole(MINTER_ROLE, await pegEngine.getAddress());
    await fpac.grantRole(BURNER_ROLE, await pegEngine.getAddress());
    await fpac.grantRole(PEG_ENGINE_ROLE, await pegEngine.getAddress());
  });

  describe("Deployment", function () {
    it("Should have correct name and symbol", async function () {
      expect(await fpac.name()).to.equal("FAIT-Pegged Autonomous Currency");
      expect(await fpac.symbol()).to.equal("FPAC");
    });

    it("Should mint initial supply to owner", async function () {
      expect(await fpac.totalSupply()).to.equal(INITIAL_SUPPLY);
      expect(await fpac.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY);
    });

    it("Should set correct initial target price", async function () {
      expect(await fpac.getTargetPrice()).to.equal(INITIAL_PRICE);
      expect(await fpac.getCurrentPrice()).to.equal(INITIAL_PRICE);
    });

    it("Should grant correct roles", async function () {
      const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
      const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
      
      expect(await fpac.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
      expect(await fpac.hasRole(MINTER_ROLE, await pegEngine.getAddress())).to.be.true;
    });
  });

  describe("Minting", function () {
    it("Should allow authorized minter to mint tokens", async function () {
      const mintAmount = ethers.parseUnits("1000", 18);
      
      await pegEngine.connect(owner).manualIntervention(
        "mint",
        mintAmount,
        "Test mint"
      );

      expect(await fpac.totalSupply()).to.equal(INITIAL_SUPPLY + mintAmount);
    });

    it("Should not allow unauthorized minting", async function () {
      const mintAmount = ethers.parseUnits("1000", 18);
      
      await expect(
        fpac.connect(user1).mint(user1.address, mintAmount)
      ).to.be.reverted;
    });

    it("Should not exceed max supply", async function () {
      const MAX_SUPPLY = ethers.parseUnits("100000000", 18); // 100M
      const excessiveAmount = MAX_SUPPLY;

      await expect(
        pegEngine.connect(owner).manualIntervention(
          "mint",
          excessiveAmount,
          "Test excessive mint"
        )
      ).to.be.reverted;
    });
  });

  describe("Peg Maintenance", function () {
    it("Should detect when peg is maintained", async function () {
      expect(await fpac.isPegMaintained()).to.be.true;
    });

    it("Should calculate peg deviation correctly", async function () {
      const deviation = await fpac.getPegDeviation();
      expect(deviation).to.equal(0); // No deviation at start
    });

    it("Should allow PegEngine to maintain peg", async function () {
      // Grant OPERATOR_ROLE to owner so we can call maintainPeg
      const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
      await pegEngine.grantRole(OPERATOR_ROLE, owner.address);
      
      // Grant oracle role to both owner and user1 so we can submit data from multiple sources
      const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
      await oracleHub.grantRole(ORACLE_ROLE, owner.address);
      await oracleHub.grantRole(ORACLE_ROLE, user1.address);
      
      // Add both owner and user1 as oracles for the FAIT_USD feed (need MIN_SOURCES = 2)
      await oracleHub.connect(owner).addOracle("FAIT_USD", owner.address);
      await oracleHub.connect(owner).addOracle("FAIT_USD", user1.address);
      
      // Submit price data from both sources
      await oracleHub.connect(owner).submitData(
        "FAIT_USD", // feedName
        INITIAL_PRICE, // Same as target price
        95          // confidence (95%)
      );
      
      await oracleHub.connect(user1).submitData(
        "FAIT_USD", // feedName
        INITIAL_PRICE, // Same as target price
        95          // confidence (95%)
      );
      
      // Verify the data was submitted correctly
      const latestData = await oracleHub.getLatestData("FAIT_USD");
      expect(latestData.value).to.equal(INITIAL_PRICE);
      expect(latestData.isValid).to.be.true;
      
      // Call maintainPeg - should not change anything since price is at target
      await pegEngine.connect(owner).maintainPeg();
      
      // Price should remain the same
      expect(await fpac.getCurrentPrice()).to.equal(INITIAL_PRICE);
    });
  });

  describe("Emergency Functions", function () {
    it("Should allow admin to emergency mint", async function () {
      const mintAmount = ethers.parseUnits("1000", 18);
      
      await fpac.connect(owner).emergencyMint(
        user1.address,
        mintAmount,
        "Emergency mint test"
      );

      expect(await fpac.balanceOf(user1.address)).to.equal(mintAmount);
    });

    it("Should allow admin to pause contract", async function () {
      await fpac.connect(owner).pause();
      expect(await fpac.paused()).to.be.true;

      await expect(
        fpac.connect(user1).transfer(user2.address, 100)
      ).to.be.reverted;
    });

    it("Should allow admin to unpause contract", async function () {
      await fpac.connect(owner).pause();
      await fpac.connect(owner).unpause();
      expect(await fpac.paused()).to.be.false;
    });
  });

  describe("Parameter Updates", function () {
    it("Should allow admin to update peg parameters", async function () {
      const newTargetPrice = ethers.parseUnits("1.05", 18);
      const newTolerance = 200; // 2%

      await fpac.connect(owner).updatePegParameters(newTargetPrice, newTolerance);

      expect(await fpac.getTargetPrice()).to.equal(newTargetPrice);
      expect(await fpac.getPegTolerance()).to.equal(newTolerance);
    });

    it("Should not allow invalid peg parameters", async function () {
      await expect(
        fpac.connect(owner).updatePegParameters(0, 100)
      ).to.be.reverted; // Invalid target price

      await expect(
        fpac.connect(owner).updatePegParameters(INITIAL_PRICE, 1001)
      ).to.be.reverted; // Tolerance too high
    });
  });

  describe("Access Control", function () {
    it("Should only allow admin to grant roles", async function () {
      const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
      
      await expect(
        fpac.connect(user1).grantRole(MINTER_ROLE, user2.address)
      ).to.be.reverted;
    });

    it("Should allow admin to revoke roles", async function () {
      const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
      
      await fpac.connect(owner).revokeRole(MINTER_ROLE, await pegEngine.getAddress());
      expect(await fpac.hasRole(MINTER_ROLE, await pegEngine.getAddress())).to.be.false;
    });
  });
});
