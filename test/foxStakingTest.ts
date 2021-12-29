import { ethers, deployments, getNamedAccounts } from "hardhat";
import { expect } from "chai";
import { SFox } from "../typechain-types/SFox";
import { FoxStaking } from "../typechain-types/FoxStaking";
import { StakingWarmup } from "../typechain-types/StakingWarmup";
import { ERC20 } from "../typechain-types/ERC20";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Signer } from "ethers";

describe("FoxStaking", function () {
  let accounts: SignerWithAddress[];
  let sFOX: SFox;
  let foxStaking: FoxStaking;
  let fox: ERC20;
  let stakingWarmup: StakingWarmup;

  beforeEach(async () => {
    await deployments.fixture();
    accounts = await ethers.getSigners();
    const sFOXDeployment = await deployments.get("sFox");
    sFOX = new ethers.Contract(
      sFOXDeployment.address,
      sFOXDeployment.abi,
      accounts[0]
    ) as SFox;
    const foxStakingDeployment = await deployments.get("FoxStaking");
    foxStaking = new ethers.Contract(
      foxStakingDeployment.address,
      foxStakingDeployment.abi,
      accounts[0]
    ) as FoxStaking; // is there a better way to avoid this cast?
    const stakingWarmupDeployment = await deployments.get("StakingWarmup");
    stakingWarmup = new ethers.Contract(
      stakingWarmupDeployment.address,
      stakingWarmupDeployment.abi,
      accounts[0]
    ) as StakingWarmup; // is there a better way to avoid this cast?

    await sFOX.initialize(foxStakingDeployment.address); // initialize our contract
    await foxStaking.setWarmupContract(stakingWarmup.address);

    const foxDeployment = await deployments.get("Fox");
    fox = new ethers.Contract(
      foxDeployment.address,
      foxDeployment.abi,
      accounts[0]
    ) as ERC20; 
  });

  describe("initialize", function () {
    it("Should assign the total supply of sFOX to the stakingContract", async () => {
      const stakingContractBalance = await sFOX.balanceOf(foxStaking.address);
      const supply = await sFOX.totalSupply();
      expect(stakingContractBalance.eq(supply)).true;
    });
  });

  describe("rebase", function () {
    // TODO
  });
});
