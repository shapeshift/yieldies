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

  describe("stake", function () {
    it("User can stake and claim when warmup period is 0", async () => {
      const { staker1 } = await getNamedAccounts();
      let staker1FoxBalance = await fox.balanceOf(staker1);
      expect(staker1FoxBalance.eq(0)).true;
      // transfer FOX to staker 1
      const transferAmount = BigNumber.from("10000");
      await fox.transfer(staker1, transferAmount);

      staker1FoxBalance = await fox.balanceOf(staker1);
      expect(staker1FoxBalance.eq(transferAmount)).true;

      let staker1sFOXBalance = await sFOX.balanceOf(staker1);
      expect(staker1sFOXBalance.eq(0)).true;

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const foxStakingStaker1 = foxStaking.connect(staker1Signer as Signer);

      const stakingAmount = transferAmount.div(2);
      const foxStaker1 = fox.connect(staker1Signer as Signer);
      await foxStaker1.approve(foxStaking.address, stakingAmount);
      await foxStakingStaker1.stake(stakingAmount, staker1);

      // balance should still be zero, until we claim the sfox.
      staker1sFOXBalance = await sFOX.balanceOf(staker1);
      expect(staker1sFOXBalance.eq(0)).true;

      let warmupsFoxBalance = await sFOX.balanceOf(stakingWarmup.address);
      expect(warmupsFoxBalance.eq(stakingAmount)).true;

      // claim should move the sFOX from warmup to the staker
      await foxStakingStaker1.claim(staker1);
      staker1sFOXBalance = await sFOX.balanceOf(staker1);
      expect(staker1sFOXBalance.eq(stakingAmount)).true;

      warmupsFoxBalance = await sFOX.balanceOf(stakingWarmup.address);
      expect(warmupsFoxBalance.eq(0)).true;
    })
  });
});
