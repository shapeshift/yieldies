import { ethers, deployments, getNamedAccounts, network } from "hardhat";
import { expect } from "chai";
import { Foxy } from "../typechain-types/Foxy";
import { FoxStaking } from "../typechain-types/FoxStaking";
import { StakingWarmup } from "../typechain-types/StakingWarmup";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Contract, Signer } from "ethers";
import { foxAbi } from "./fox-abi";
import { ERC20 } from "../typechain-types";

describe("FoxStaking", function () {
  let accounts: SignerWithAddress[];
  let FOXy: Foxy;
  let foxStaking: FoxStaking;
  let fox: Contract;
  let stakingWarmup: StakingWarmup;

  const FOX_WHALE = "0xF152a54068c8eDDF5D537770985cA8c06ad78aBB"; // Keep updated with a whale's FOX address.  Address must have ETH
  const FOX = "0xc770EEfAd204B5180dF6a14Ee197D99d808ee52d";

  beforeEach(async () => {
    const { admin } = await getNamedAccounts();
    await deployments.fixture();
    accounts = await ethers.getSigners();
    const FoxyDeployment = await deployments.get("Foxy");
    FOXy = new ethers.Contract(
      FoxyDeployment.address,
      FoxyDeployment.abi,
      accounts[0]
    ) as Foxy;
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

    await FOXy.initialize(foxStakingDeployment.address); // initialize our contract
    await foxStaking.setWarmupContract(stakingWarmup.address);
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [FOX_WHALE],
    });
    fox = new ethers.Contract(FOX, foxAbi, accounts[0]);

    // Transfer to admin account for FOX to be easily transferred to other accounts
    const transferAmount = BigNumber.from("1000000000");
    const whaleSigner = await ethers.getSigner(FOX_WHALE);
    const foxWhale = fox.connect(whaleSigner);
    await foxWhale.transfer(admin, transferAmount);
    const myBalance = await fox.balanceOf(admin);

    expect(BigNumber.from(myBalance).toNumber()).gte(
      transferAmount.toNumber()
    );
  });

  describe("initialize", function () {
    it("Should assign the total supply of FOXy to the stakingContract", async () => {
      const stakingContractBalance = await FOXy.balanceOf(foxStaking.address);
      const supply = await FOXy.totalSupply();
      expect(stakingContractBalance.eq(supply)).true;
    });
  });

  describe("stake", function () {
    it("User can stake, claim and unstake full amount when warmup period is 0", async () => {
      const { admin, staker1 } = await getNamedAccounts();
      let staker1FoxBalance = await fox.balanceOf(staker1);
      expect(staker1FoxBalance.eq(0)).true;
      // transfer FOX to staker 1
      const transferAmount = BigNumber.from("10000");
      await fox.transfer(staker1, transferAmount);

      staker1FoxBalance = await fox.balanceOf(staker1);
      expect(staker1FoxBalance.eq(transferAmount)).true;

      let staker1FOXyBalance = await FOXy.balanceOf(staker1);
      expect(staker1FOXyBalance.eq(0)).true;

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const foxStakingStaker1 = foxStaking.connect(staker1Signer as Signer);

      const stakingAmount = transferAmount.div(2);
      const foxStaker1 = fox.connect(staker1Signer as Signer);
      await foxStaker1.approve(foxStaking.address, stakingAmount);
      await foxStakingStaker1.stake(stakingAmount, staker1);

      // balance should still be zero, until we claim the FOXy.
      staker1FOXyBalance = await FOXy.balanceOf(staker1);
      expect(staker1FOXyBalance.eq(0)).true;

      let warmupFoxyBalance = await FOXy.balanceOf(stakingWarmup.address);
      expect(warmupFoxyBalance.eq(stakingAmount)).true;

      // claim should move the FOXy from warmup to the staker
      await foxStakingStaker1.claim(staker1);
      staker1FOXyBalance = await FOXy.balanceOf(staker1);
      expect(staker1FOXyBalance.eq(stakingAmount)).true;

      warmupFoxyBalance = await FOXy.balanceOf(stakingWarmup.address);
      expect(warmupFoxyBalance.eq(0)).true;

      // unstake
      await FOXy.connect(staker1Signer as Signer).approve(
        foxStaking.address,
        stakingAmount
      );
      await foxStakingStaker1.unstake(stakingAmount, false);
      staker1FOXyBalance = await FOXy.balanceOf(staker1);
      expect(staker1FOXyBalance.eq(0)).true;

      staker1FoxBalance = await fox.balanceOf(staker1);
      expect(staker1FoxBalance.eq(transferAmount)).true;
    });
  });

  describe("reward", function () {
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

      // claim should move the FOXy from warmup to the staker
      await foxStakingStaker1.claim(staker1);
      await foxStakingStaker2.claim(staker2);

      let foxyBalanceStaker1 = await FOXy.balanceOf(staker1);
      let foxyBalanceStaker2 = await FOXy.balanceOf(staker2);

      expect(foxyBalanceStaker1.eq(stakingAmount1)).true;
      expect(foxyBalanceStaker2.eq(stakingAmount2)).true;

      // call rebase without rewards, no change should occur in balances.
      await foxStaking.rebase();

      foxyBalanceStaker1 = await FOXy.balanceOf(staker1);
      foxyBalanceStaker2 = await FOXy.balanceOf(staker2);

      expect(foxyBalanceStaker1.eq(stakingAmount1)).true;
      expect(foxyBalanceStaker2.eq(stakingAmount2)).true;

      // add rewards and trigger rebase, no rebase should occur due to scheduled block
      await fox.approve(foxStaking.address, ethers.constants.MaxUint256); // from admin   
      const awardAmount = BigNumber.from("1000");
      await foxStaking.addRewardsForStakers(awardAmount, true); // TODO: Fix transferring mainnet FOX

      foxyBalanceStaker1 = await FOXy.balanceOf(staker1);
      foxyBalanceStaker2 = await FOXy.balanceOf(staker2);

      expect(foxyBalanceStaker1.eq(stakingAmount1)).true;
      expect(foxyBalanceStaker2.eq(stakingAmount2)).true;

      // fast forward to after reward block
      let currentBlock = await ethers.provider.getBlockNumber();
      let nextRewardBlock = (await foxStaking.epoch()).endBlock.toNumber();

      for (let i = currentBlock; i <= nextRewardBlock; i++) {
        await ethers.provider.send("evm_mine", []);
      }

      // call rebase - no change still rewards are issued in a 1 period lagging fashion...
      await foxStaking.rebase();
      foxyBalanceStaker1 = await FOXy.balanceOf(staker1);
      foxyBalanceStaker2 = await FOXy.balanceOf(staker2);

      expect(foxyBalanceStaker1.eq(stakingAmount1)).true;
      expect(foxyBalanceStaker2.eq(stakingAmount2)).true;

      currentBlock = await ethers.provider.getBlockNumber();
      nextRewardBlock = (await foxStaking.epoch()).endBlock.toNumber();

      for (let i = currentBlock; i <= nextRewardBlock; i++) {
        await ethers.provider.send("evm_mine", []);
      }

      // finally rewards should be issued
      await foxStaking.rebase();
      foxyBalanceStaker1 = await FOXy.balanceOf(staker1);
      foxyBalanceStaker2 = await FOXy.balanceOf(staker2);
      expect(foxyBalanceStaker1.eq(stakingAmount1.add(909))).true;
      expect(foxyBalanceStaker2.eq(stakingAmount2.add(90))).true;
    });
  });
});
