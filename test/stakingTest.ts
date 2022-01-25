import { ethers, deployments, getNamedAccounts, network } from "hardhat";
import { expect } from "chai";
import { Foxy } from "../typechain-types/Foxy";
import { Staking } from "../typechain-types/Staking";
import { Vesting } from "../typechain-types/Vesting";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Contract, Signer } from "ethers";
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20.json";
import { tokePoolAbi } from "./tokePoolAbi";
import { abi as vestingAbi } from "../artifacts/src/contracts/Vesting.sol/Vesting.json";

describe("Staking", function () {
  let accounts: SignerWithAddress[];
  let rewardToken: Foxy;
  let staking: Staking;
  let stakingToken: Contract;
  let tokePool: Contract;
  let stakingWarmup: Vesting;
  let stakingCooldown: Vesting;

  const STAKING_TOKEN_WHALE = "0xF152a54068c8eDDF5D537770985cA8c06ad78aBB";
  const STAKING_TOKEN = "0xc770EEfAd204B5180dF6a14Ee197D99d808ee52d";
  const TOKE_ADDRESS = "0x808D3E6b23516967ceAE4f17a5F9038383ED5311"; // tFOX Address

  beforeEach(async () => {
    const { admin } = await getNamedAccounts();
    await deployments.fixture();
    accounts = await ethers.getSigners();
    const rewardTokenDeployment = await deployments.get("Foxy");
    rewardToken = new ethers.Contract(
      rewardTokenDeployment.address,
      rewardTokenDeployment.abi,
      accounts[0]
    ) as Foxy;
    tokePool = new ethers.Contract(TOKE_ADDRESS, tokePoolAbi, accounts[0]);
    const stakingDeployment = await deployments.get("Staking");
    staking = new ethers.Contract(
      stakingDeployment.address,
      stakingDeployment.abi,
      accounts[0]
    ) as Staking; // is there a better way to avoid this cast?

    const warmupContract = await staking.warmupContract();
    stakingWarmup = new ethers.Contract(
      warmupContract,
      vestingAbi,
      accounts[0]
    ) as Vesting; // is there a better way to avoid this cast?
    const cooldownContract = await staking.cooldownContract();
    stakingCooldown = new ethers.Contract(
      cooldownContract,
      vestingAbi,
      accounts[0]
    ) as Vesting; // is there a better way to avoid this cast?

    await rewardToken.initialize(stakingDeployment.address); // initialize our contract

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [STAKING_TOKEN_WHALE],
    });
    stakingToken = new ethers.Contract(STAKING_TOKEN, ERC20.abi, accounts[0]);

    // Transfer to admin account for STAKING_TOKEN to be easily transferred to other accounts
    const transferAmount = BigNumber.from("1000000000");
    const whaleSigner = await ethers.getSigner(STAKING_TOKEN_WHALE);
    const stakingTokenWhale = stakingToken.connect(whaleSigner);
    await stakingTokenWhale.transfer(admin, transferAmount);
    const myBalance = await stakingToken.balanceOf(admin);

    expect(BigNumber.from(myBalance).toNumber()).gte(transferAmount.toNumber());
  });

  describe("initialize", function () {
    it("Should assign the total supply of rewardToken to the stakingContract", async () => {
      const stakingContractBalance = await rewardToken.balanceOf(staking.address);
      const supply = await rewardToken.totalSupply();
      expect(stakingContractBalance.eq(supply)).true;
    });
  });

  describe("stake", function () {
    it("User can stake, claim and unstake full amount when warmup period is 0", async () => {
      const { staker1 } = await getNamedAccounts();
      let staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance.eq(0)).true;
      // transfer STAKING_TOKEN to staker 1
      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance.eq(transferAmount)).true;

      let staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance.eq(0)).true;

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount = transferAmount.div(2);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      // balance should still be zero, until we claim the rewardToken.
      staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance.eq(0)).true;

      let warmupRewardTokenBalance = await rewardToken.balanceOf(stakingWarmup.address);
      expect(warmupRewardTokenBalance.eq(stakingAmount)).true;

      // claim should move the rewardToken from warmup to the staker
      await stakingStaker1.claim(staker1);
      staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance.eq(stakingAmount)).true;

      warmupRewardTokenBalance = await rewardToken.balanceOf(stakingWarmup.address);
      expect(warmupRewardTokenBalance.eq(0)).true;

      // unstake
      await rewardToken.connect(staker1Signer as Signer).approve(
        staking.address,
        stakingAmount
      );
      await stakingStaker1.unstake(stakingAmount, false);

      staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance.eq(0)).true;

      let cooldownRewardTokenBalance = await rewardToken.balanceOf(stakingCooldown.address);
      expect(cooldownRewardTokenBalance.eq(stakingAmount)).true;
    });
    it("Users have to wait for warmup period to unstake", async () => {
      const { staker1 } = await getNamedAccounts();

      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      let currentBlock = await ethers.provider.getBlockNumber();
      let nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

      await staking.setWarmup(1);
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount = transferAmount.div(2);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      let warmupRewardTokenBalance = await rewardToken.balanceOf(stakingWarmup.address);
      expect(warmupRewardTokenBalance.eq(stakingAmount)).true;

      // unstake
      await rewardToken.connect(staker1Signer as Signer).approve(
        staking.address,
        stakingAmount
      );

      // fails to claim
      await stakingStaker1.claim(staker1);
      warmupRewardTokenBalance = await rewardToken.balanceOf(stakingWarmup.address);
      expect(warmupRewardTokenBalance.eq(stakingAmount)).true;

      for (let i = currentBlock; i <= nextRewardBlock; i++) {
        await ethers.provider.send("evm_mine", []);
      }

      // need to rebase to increase epoch number
      await stakingStaker1.rebase();
      // claim succeeds now
      await stakingStaker1.claim(staker1);

      warmupRewardTokenBalance = await rewardToken.balanceOf(stakingWarmup.address);
      expect(warmupRewardTokenBalance.eq(0)).true;
      await stakingStaker1.unstake(stakingAmount, false);
    });
    it("Fails to unstake when calling more than what user has in wallet or warmup contract", async () => {
      const { staker1 } = await getNamedAccounts();
      let staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance.eq(0)).true;

      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount = transferAmount.div(2);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      let warmupRewardTokenBalance = await rewardToken.balanceOf(stakingWarmup.address);
      expect(warmupRewardTokenBalance.eq(stakingAmount)).true;

      await rewardToken.connect(staker1Signer as Signer).approve(
        staking.address,
        stakingAmount
      );

      // unstake fails due to too incorrect amount
      await expect(
        stakingStaker1.unstake(stakingAmount.add(1), false)
      ).to.be.revertedWith("SafeMath: subtraction overflow");
    });
    it("User can stake and unstake half amount without claiming when warmup period is 0", async () => {
      const { staker1 } = await getNamedAccounts();
      let staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance.eq(0)).true;
      // transfer STAKING_TOKEN to staker 1
      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance.eq(transferAmount)).true;

      let staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance.eq(0)).true;

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount = transferAmount.div(2);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      // warmupInfo for staker1 should be stakingAmount
      let warmupInfo = await staking.warmupInfo(staker1);
      expect(warmupInfo.amount).eq(stakingAmount);

      // balance should still be zero, until we unstake the rewardToken.
      staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance.eq(0)).true;

      let warmupRewardTokenBalance = await rewardToken.balanceOf(stakingWarmup.address);
      expect(warmupRewardTokenBalance.eq(stakingAmount)).true;

      // unstake
      await rewardToken.connect(staker1Signer as Signer).approve(
        staking.address,
        stakingAmount
      );

      await stakingStaker1.unstake(stakingAmount.div(2), false);

      staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance.eq(0)).true;

      let cooldownRewardTokenBalance = await rewardToken.balanceOf(stakingCooldown.address);
      expect(cooldownRewardTokenBalance).eq(stakingAmount.div(2));

      // warmupInfo for staker1 should be 2500
      warmupInfo = await staking.warmupInfo(staker1);
      expect(warmupInfo.amount).eq(stakingAmount.div(2));

      warmupRewardTokenBalance = await rewardToken.balanceOf(stakingWarmup.address);
      expect(warmupRewardTokenBalance).eq(stakingAmount.div(2));
    })
    it("User can stake and unstake full amount without claiming when warmup period is 0", async () => {
      const { staker1 } = await getNamedAccounts();
      let staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance.eq(0)).true;
      // transfer STAKING_TOKEN to staker 1
      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance.eq(transferAmount)).true;

      let staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance.eq(0)).true;

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount = transferAmount.div(2);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      // warmupInfo for staker1 should be stakingAmount
      let warmupInfo = await staking.warmupInfo(staker1);
      expect(warmupInfo.amount).eq(stakingAmount);

      // balance should still be zero, until we unstake the rewardToken.
      staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance.eq(0)).true;

      let warmupRewardTokenBalance = await rewardToken.balanceOf(stakingWarmup.address);
      expect(warmupRewardTokenBalance.eq(stakingAmount)).true;

      // unstake
      await rewardToken.connect(staker1Signer as Signer).approve(
        staking.address,
        stakingAmount
      );

      await stakingStaker1.unstake(stakingAmount, false);

      staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance.eq(0)).true;

      let cooldownRewardTokenBalance = await rewardToken.balanceOf(stakingCooldown.address);
      expect(cooldownRewardTokenBalance.eq(stakingAmount)).true;

      // warmupInfo for staker1 should have been deleted
      warmupInfo = await staking.warmupInfo(staker1);
      expect(warmupInfo.amount.eq(0)).true;

      warmupRewardTokenBalance = await rewardToken.balanceOf(stakingWarmup.address);
      expect(warmupRewardTokenBalance.eq(0)).true;
    });
  });

  describe("reward", function () {
    it("Rewards can be added to contract and rebase rewards users", async () => {
      const { staker1, staker2 } = await getNamedAccounts();
      // transfer STAKING_TOKEN to staker 1
      const transferAmount = BigNumber.from("10000");

      await stakingToken.transfer(staker1, transferAmount);
      await stakingToken.transfer(staker2, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const staker2Signer = accounts.find(
        (account) => account.address === staker2
      );
      const stakingStaker2 = staking.connect(staker2Signer as Signer);

      const stakingAmount1 = BigNumber.from("10000");
      const stakingAmount2 = BigNumber.from("1000");

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount1);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount1);

      const stakingTokenStaker2 = stakingToken.connect(staker2Signer as Signer);
      await stakingTokenStaker2.approve(staking.address, stakingAmount2);
      await stakingStaker2.functions["stake(uint256)"](stakingAmount2);

      // claim should move the rewardToken from warmup to the staker
      await stakingStaker1.claim(staker1);
      await stakingStaker2.claim(staker2);

      let rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      let rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);

      expect(rewardTokenBalanceStaker1.eq(stakingAmount1)).true;
      expect(rewardTokenBalanceStaker2.eq(stakingAmount2)).true;

      // call rebase without rewards, no change should occur in balances.
      await staking.rebase();

      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);

      expect(rewardTokenBalanceStaker1.eq(stakingAmount1)).true;
      expect(rewardTokenBalanceStaker2.eq(stakingAmount2)).true;

      // add rewards and trigger rebase, no rebase should occur due to scheduled block
      await stakingToken.approve(staking.address, ethers.constants.MaxUint256); // from admin
      const awardAmount = BigNumber.from("1000");
      await staking.addRewardsForStakers(awardAmount, true);

      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);

      expect(rewardTokenBalanceStaker1.eq(stakingAmount1)).true;
      expect(rewardTokenBalanceStaker2.eq(stakingAmount2)).true;

      // fast forward to after reward block
      let currentBlock = await ethers.provider.getBlockNumber();
      let nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

      for (let i = currentBlock; i <= nextRewardBlock; i++) {
        await ethers.provider.send("evm_mine", []);
      }

      // call rebase - no change still rewards are issued in a 1 period lagging fashion...
      await staking.rebase();
      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);

      expect(rewardTokenBalanceStaker1.eq(stakingAmount1)).true;
      expect(rewardTokenBalanceStaker2.eq(stakingAmount2)).true;

      currentBlock = await ethers.provider.getBlockNumber();
      nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

      for (let i = currentBlock; i <= nextRewardBlock; i++) {
        await ethers.provider.send("evm_mine", []);
      }

      // finally rewards should be issued
      await staking.rebase();
      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);
      expect(rewardTokenBalanceStaker1.eq(stakingAmount1.add(909))).true;
      expect(rewardTokenBalanceStaker2.eq(stakingAmount2.add(90))).true;
    });
  });

  describe("tokemak", function () {
    it("Staking gives tokePool to the Staking contract", async () => {
      const { staker1 } = await getNamedAccounts();

      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      // tokePool should be 0 when no TOKE deposits have been made
      let tokeBalance = await tokePool.balanceOf(stakingStaker1.address);
      expect(tokeBalance.eq(0)).true;

      const stakingAmount = transferAmount.div(2);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      // should receive 1:1 tokePool to STAKING_TOKEN
      tokeBalance = await tokePool.balanceOf(stakingStaker1.address);
      expect(tokeBalance.eq(stakingAmount)).true;
    });
    it("Unstaking creates requestedWithdrawals", async () => {
      const { staker1, staker2 } = await getNamedAccounts();

      const transferAmount = BigNumber.from("100000");
      await stakingToken.transfer(staker1, transferAmount);
      await stakingToken.transfer(staker2, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const staker2Signer = accounts.find(
        (account) => account.address === staker2
      );

      const stakingStaker1 = staking.connect(staker1Signer as Signer);
      const stakingAmount1 = transferAmount.div(4);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount1);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount1);
      await stakingStaker1.claim(staker1);

      const stakingStaker2 = staking.connect(staker2Signer as Signer);
      const stakingAmount2 = transferAmount.div(2);
      const stakingTokenStaker2 = stakingToken.connect(staker2Signer as Signer);
      await stakingTokenStaker2.approve(staking.address, stakingAmount2);
      await stakingStaker2.functions["stake(uint256)"](stakingAmount2);
      await stakingStaker2.claim(staker2);

      await rewardToken.connect(staker1Signer as Signer).approve(
        staking.address,
        stakingAmount1
      );
      await stakingStaker1.unstake(stakingAmount1, false);

      await rewardToken.connect(staker2Signer as Signer).approve(
        staking.address,
        stakingAmount2
      );
      await stakingStaker2.unstake(stakingAmount2, false);

      const requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      expect(requestedWithdrawals.amount.eq(stakingAmount2)).true; // TODO: fix once able to stack requestedWithdrawals
      expect(requestedWithdrawals.minCycle.eq(167)).true; // given block number 14043149 this is the cycle TOKE is on
    });
  });
});