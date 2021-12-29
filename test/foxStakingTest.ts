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
    it("User can stake, claim and unstake full amount when warmup period is 0", async () => {
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

      // unstake
      await sFOX.connect(staker1Signer as Signer).approve(foxStaking.address, stakingAmount);
      await foxStakingStaker1.unstake(stakingAmount, false);
      staker1sFOXBalance = await sFOX.balanceOf(staker1);
      expect(staker1sFOXBalance.eq(0)).true;

      staker1FoxBalance = await fox.balanceOf(staker1);
      expect(staker1FoxBalance.eq(transferAmount)).true;
    })
  });

  describe("reward", function (){
    it("Rewards can be added to contract and rebase rewards users", async () => {
      const { admin, staker1, staker2 } = await getNamedAccounts();
      // transfer FOX to staker 1
      const transferAmount = BigNumber.from("10000");
      await fox.transfer(staker1, transferAmount);
      await fox.transfer(staker2, transferAmount);
      
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const foxStakingStaker1 = foxStaking.connect(staker1Signer as Signer);

      const staker2Signer = accounts.find(
        (account) => account.address === staker2
      );
      const foxStakingStaker2 = foxStaking.connect(staker2Signer as Signer);

      const stakingAmount1 = BigNumber.from("10000");
      const stakingAmount2 = BigNumber.from("1000");

      const foxStaker1 = fox.connect(staker1Signer as Signer);
      await foxStaker1.approve(foxStaking.address, stakingAmount1);
      await foxStakingStaker1.stake(stakingAmount1, staker1);

      const foxStaker2 = fox.connect(staker2Signer as Signer);
      await foxStaker2.approve(foxStaking.address, stakingAmount2);
      await foxStakingStaker2.stake(stakingAmount2, staker2);

      // claim should move the sFOX from warmup to the staker
      await foxStakingStaker1.claim(staker1);
      await foxStakingStaker2.claim(staker2);

      let sFoxBalanceStaker1 = await sFOX.balanceOf(staker1);
      let sFoxBalanceStaker2 = await sFOX.balanceOf(staker2);

      expect(sFoxBalanceStaker1.eq(stakingAmount1)).true;
      expect(sFoxBalanceStaker2.eq(stakingAmount2)).true;

      // call rebase without rewards, no change should occur in balances.
      await foxStaking.rebase();

      sFoxBalanceStaker1 = await sFOX.balanceOf(staker1);
      sFoxBalanceStaker2 = await sFOX.balanceOf(staker2);

      expect(sFoxBalanceStaker1.eq(stakingAmount1)).true;
      expect(sFoxBalanceStaker2.eq(stakingAmount2)).true;

      // add rewards and trigger rebase, no rebase should occur due to scheduled block
      await fox.approve(foxStaking.address, ethers.constants.MaxUint256); // from admin
      const awardAmount = BigNumber.from("1000");
      await foxStaking.addRewardsForStakers(awardAmount, true);

      sFoxBalanceStaker1 = await sFOX.balanceOf(staker1);
      sFoxBalanceStaker2 = await sFOX.balanceOf(staker2);

      expect(sFoxBalanceStaker1.eq(stakingAmount1)).true;
      expect(sFoxBalanceStaker2.eq(stakingAmount2)).true;

      // fast forward to after reward block
      let currentBlock = await ethers.provider.getBlockNumber();
      let nextRewardBlock = ((await foxStaking.epoch()).endBlock).toNumber();

      for(let i = currentBlock; i <= nextRewardBlock; i++) {
        await ethers.provider.send('evm_mine', []);
      }

      // call rebase - no change still rewards are issued in a 1 period lagging fashion...
      await foxStaking.rebase();
      sFoxBalanceStaker1 = await sFOX.balanceOf(staker1);
      sFoxBalanceStaker2 = await sFOX.balanceOf(staker2);

      expect(sFoxBalanceStaker1.eq(stakingAmount1)).true;
      expect(sFoxBalanceStaker2.eq(stakingAmount2)).true;

      currentBlock = await ethers.provider.getBlockNumber();
      nextRewardBlock = ((await foxStaking.epoch()).endBlock).toNumber();

      for(let i = currentBlock; i <= nextRewardBlock; i++) {
        await ethers.provider.send('evm_mine', []);
      }

      // finally rewards should be issued
      await foxStaking.rebase();
      sFoxBalanceStaker1 = await sFOX.balanceOf(staker1);
      sFoxBalanceStaker2 = await sFOX.balanceOf(staker2);
      expect(sFoxBalanceStaker1.eq(stakingAmount1.add(909))).true;
      expect(sFoxBalanceStaker2.eq(stakingAmount2.add(90))).true;
    });
  });
});
