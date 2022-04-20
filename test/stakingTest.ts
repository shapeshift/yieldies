import {
  ethers,
  deployments,
  getNamedAccounts,
  network,
  upgrades,
} from "hardhat";
import { expect } from "chai";
import { Yieldy } from "../typechain-types/Yieldy";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Contract, Signer } from "ethers";
import { tokePoolAbi } from "../src/abis/tokePoolAbi";
import { tokeManagerAbi } from "../src/abis/tokeManagerAbi";
import { abi as vestingAbi } from "../artifacts/src/contracts/Vesting.sol/Vesting.json";
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20.json";
import {
  LiquidityReserve,
  Vesting,
  Staking,
  StakingV2Test,
} from "../typechain-types";
import * as constants from "./constants";

describe("Staking", function () {
  let accounts: SignerWithAddress[];
  let rewardToken: Yieldy;
  let staking: Staking;
  let liquidityReserve: LiquidityReserve;
  let stakingToken: Contract;
  let tokeToken: Contract;
  let tokePool: Contract;
  let tokeManager: Contract;
  let stakingWarmup: Vesting;
  let stakingCooldown: Vesting;

  // mines blocks to the next TOKE cycle
  async function mineBlocksToNextCycle() {
    let currentBlock = await ethers.provider.getBlockNumber();
    let currentTime = (await ethers.provider.getBlock(currentBlock)).timestamp;
    const cycleDuration = await tokeManager.getCycleDuration();
    const cycleStart = await tokeManager.getCurrentCycle();
    const nextCycleTime = cycleStart.toNumber() + cycleDuration.toNumber();
    while (currentTime <= nextCycleTime) {
      await network.provider.send("hardhat_mine", ["0x100"]);
      const block = await ethers.provider.getBlockNumber();
      currentTime = (await ethers.provider.getBlock(block)).timestamp;
    }

    currentBlock = await ethers.provider.getBlockNumber();
    const nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

    // mining 256 blocks at a time
    for (let i = currentBlock / 256; i <= nextRewardBlock / 256; i++) {
      await network.provider.send("hardhat_mine", ["0x100"]);
      currentBlock = await ethers.provider.getBlockNumber();
    }
  }

  beforeEach(async () => {
    const { admin } = await getNamedAccounts();

    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.MAINNET_URL,
            blockNumber: Number(process.env.BLOCK_NUMBER),
          },
        },
      ],
    });

    await deployments.fixture();
    accounts = await ethers.getSigners();
    stakingToken = new ethers.Contract(
      constants.STAKING_TOKEN,
      ERC20.abi,
      accounts[0]
    );
    tokeToken = new ethers.Contract(
      constants.TOKE_TOKEN,
      ERC20.abi,
      accounts[0]
    );
    tokePool = new ethers.Contract(
      constants.TOKE_ADDRESS,
      tokePoolAbi,
      accounts[0]
    );

    const rewardTokenDeployment = await ethers.getContractFactory("Yieldy");
    rewardToken = (await upgrades.deployProxy(rewardTokenDeployment, [
      "Fox Yieldy",
      "FOXy",
    ])) as Yieldy;
    await rewardToken.deployed();

    const liquidityReserveDeployment = await ethers.getContractFactory(
      "LiquidityReserve"
    );
    liquidityReserve = (await upgrades.deployProxy(liquidityReserveDeployment, [
      "Liquidity Reserve FOX",
      "lrFOX",
      constants.STAKING_TOKEN,
      rewardToken.address,
    ])) as LiquidityReserve;

    const currentBlock = await ethers.provider.getBlockNumber();
    const firstEpochBlock = currentBlock + constants.EPOCH_LENGTH;

    const stakingDeployment = await ethers.getContractFactory("Staking");
    staking = (await upgrades.deployProxy(stakingDeployment, [
      stakingToken.address,
      rewardToken.address,
      constants.TOKE_TOKEN,
      constants.TOKE_ADDRESS,
      constants.TOKE_MANAGER,
      constants.TOKE_REWARD,
      liquidityReserve.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      constants.EPOCH_LENGTH,
      constants.FIRST_EPOCH_NUMBER,
      firstEpochBlock,
    ])) as Staking;

    const warmUpAddress = await staking.WARM_UP_CONTRACT();
    stakingWarmup = new ethers.Contract(
      warmUpAddress,
      vestingAbi,
      accounts[0]
    ) as Vesting;

    const coolDownAddress = await staking.COOL_DOWN_CONTRACT();
    stakingCooldown = new ethers.Contract(
      coolDownAddress,
      vestingAbi,
      accounts[0]
    ) as Vesting;

    const tokeManagerAddress = await tokePool.manager();
    tokeManager = new ethers.Contract(
      tokeManagerAddress,
      tokeManagerAbi,
      accounts[0]
    );

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [constants.STAKING_TOKEN_WHALE],
    });

    // Transfer to admin account for STAKING_TOKEN to be easily transferred to other accounts
    const transferAmount = BigNumber.from("9000000000000000");
    const whaleSigner = await ethers.getSigner(constants.STAKING_TOKEN_WHALE);
    const stakingTokenWhale = stakingToken.connect(whaleSigner);
    await stakingTokenWhale.transfer(admin, transferAmount);
    const stakingTokenBalance = await stakingToken.balanceOf(admin);
    expect(BigNumber.from(stakingTokenBalance).toNumber()).gte(
      transferAmount.toNumber()
    );

    await rewardToken.initializeStakingContract(staking.address); // initialize reward contract
    await stakingToken.approve(
      liquidityReserve.address,
      BigNumber.from("1000000000000000")
    ); // approve initial liquidity amount
    await liquidityReserve.enableLiquidityReserve(staking.address);
    await liquidityReserve.setFee(constants.INSTANT_UNSTAKE_FEE);
  });

  describe("initialize", function () {
    it("Yieldy and Staking can be upgraded", async () => {
      const { staker1 } = await getNamedAccounts();
      await staking.setWarmUpPeriod(1);
      await staking.setCoolDownPeriod(2);

      let staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);
      // transfer STAKING_TOKEN to staker 1
      const transferAmount = BigNumber.from("10000000");
      const stakingAmount = transferAmount.div(4);

      await stakingToken.transfer(staker1, transferAmount);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      let currentBlock = await ethers.provider.getBlockNumber();
      let nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

      // mining 256 blocks at a time
      for (let i = currentBlock / 256; i <= nextRewardBlock / 256; i++) {
        await network.provider.send("hardhat_mine", ["0x100"]);
        currentBlock = await ethers.provider.getBlockNumber();
      }
      await stakingStaker1.rebase();

      // warmUpInfo for staker1 should be stakingAmount
      let warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount);

      let warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      await stakingStaker1.claim(staker1);

      let rewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(rewardTokenBalance).eq(stakingAmount);

      warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(0);

      // stake again after claiming
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount);

      warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      currentBlock = await ethers.provider.getBlockNumber();
      nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

      // mining 256 blocks at a time
      for (let i = currentBlock / 256; i <= nextRewardBlock / 256; i++) {
        await network.provider.send("hardhat_mine", ["0x100"]);
        currentBlock = await ethers.provider.getBlockNumber();
      }
      await stakingStaker1.rebase();

      // should auto claim the current warmup rewards when staking again
      warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      // warmup reward token balance stays same due to previous staking amount being claimed
      warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      // staker1 reward balance doubles due to being claimed
      rewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(rewardTokenBalance).eq(stakingAmount.mul(2));

      // warmupInfo should match stakingAmount since previous balance was claimed
      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount);

      // should be able to stake again with rewards in warmup during same epoch
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      // warmup reward token balance should double
      warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount.mul(2));

      // staker1 reward balance should stay the same
      rewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(rewardTokenBalance).eq(stakingAmount.mul(2));

      // warmupInfo should should double
      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount.mul(2));

      // able to unstake with warmup & wallet balance
      await mineBlocksToNextCycle();

      let coolDownInfo = await staking.coolDownInfo(staker1);
      expect(coolDownInfo.amount).eq(0);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, transferAmount);
      await stakingStaker1.unstake(stakingAmount, false);

      coolDownInfo = await staking.coolDownInfo(staker1);
      expect(coolDownInfo.amount).eq(stakingAmount);

      let cooldownRewardTokenBalance = await rewardToken.balanceOf(
        stakingCooldown.address
      );
      expect(cooldownRewardTokenBalance).eq(stakingAmount);

      // warmUpInfo & rewardToken balance had 2x stakingAmount, should now have 1x staking amount
      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount);

      warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      // able to unstake with warmup & cooldown & wallet balance
      await stakingStaker1.unstake(stakingAmount.mul(2), false);

      coolDownInfo = await staking.coolDownInfo(staker1);
      expect(coolDownInfo.amount).eq(stakingAmount.mul(3));

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      // cooldown should be 3x stakingAmount
      cooldownRewardTokenBalance = await rewardToken.balanceOf(
        stakingCooldown.address
      );
      expect(cooldownRewardTokenBalance).eq(stakingAmount.mul(3));

      // warmUpInfo & rewardToken balance should be empty now
      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(0);

      warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(0);

      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
      await mineBlocksToNextCycle();
      await stakingStaker1.rebase();

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);

      // upgrade contracts

      let index = await rewardToken.getIndex();
      expect(index).eq("1000000000000000000");
      let circulatingSupply = await rewardToken.circulatingSupply();
      expect(circulatingSupply).eq("10000000");

      const rewardTokenDeployment = await ethers.getContractFactory(
        "YieldyV2Test"
      );
      (await upgrades.upgradeProxy(
        rewardToken.address,
        rewardTokenDeployment
      )) as Yieldy;

      // YieldyV2 has hardcoded index/circulatingSupply
      index = await rewardToken.getIndex();
      expect(index).eq(123456);
      circulatingSupply = await rewardToken.circulatingSupply();
      expect(circulatingSupply).eq(7777777);

      const stakingDeployment = await ethers.getContractFactory(
        "StakingV2Test"
      );
      const StakingV2 = (await upgrades.upgradeProxy(
        staking.address,
        stakingDeployment
      )) as StakingV2Test;

      const newFunctionResult = await StakingV2.newFunction();
      expect(newFunctionResult).eq("123456789");

      // can't claim yet due to cooldown period being 2
      await StakingV2.claimWithdraw(staker1);
      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);
      coolDownInfo = await staking.coolDownInfo(staker1);
      // expect(coolDownInfo.amount).eq(stakingAmount.mul(3)); // TODO: migrate Vesting

      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
      await mineBlocksToNextCycle();
      await stakingStaker1.rebase();

      // can claim now
      await stakingStaker1.claimWithdraw(staker1);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(stakingAmount.mul(3));

      coolDownInfo = await staking.coolDownInfo(staker1);
      expect(coolDownInfo.amount).eq(0);

      // should still have some reward tokens left
      rewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(rewardTokenBalance).eq(stakingAmount);
    });
    it("Should assign the total supply of rewardToken to the stakingContract", async () => {
      const stakingContractBalance = await rewardToken.balanceOf(
        staking.address
      );
      const supply = await rewardToken.totalSupply();
      expect(stakingContractBalance).eq(supply);
    });
    it("Fails when no staking/reward token or staking contract is passed in", async () => {
      const stakingFactory = await ethers.getContractFactory("Staking");
      const currentBlock = await ethers.provider.getBlockNumber();
      const firstEpochBlock = currentBlock + constants.EPOCH_LENGTH;

      // fail due to bad addresses
      await expect(
        upgrades.deployProxy(stakingFactory, [
          stakingToken.address,
          ethers.constants.AddressZero,
          constants.TOKE_TOKEN,
          constants.TOKE_ADDRESS,
          constants.TOKE_MANAGER,
          constants.TOKE_REWARD,
          liquidityReserve.address,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          constants.EPOCH_LENGTH,
          constants.FIRST_EPOCH_NUMBER,
          firstEpochBlock,
        ])
      ).to.be.reverted;
      await expect(
        upgrades.deployProxy(stakingFactory, [
          stakingToken.address,
          ethers.constants.AddressZero,
          constants.TOKE_TOKEN,
          constants.TOKE_ADDRESS,
          constants.TOKE_MANAGER,
          constants.TOKE_REWARD,
          liquidityReserve.address,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          constants.EPOCH_LENGTH,
          constants.FIRST_EPOCH_NUMBER,
          firstEpochBlock,
        ])
      ).to.be.reverted;
      await expect(
        upgrades.deployProxy(stakingFactory, [
          stakingToken.address,
          rewardToken.address,
          ethers.constants.AddressZero,
          constants.TOKE_ADDRESS,
          constants.TOKE_MANAGER,
          constants.TOKE_REWARD,
          liquidityReserve.address,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          constants.EPOCH_LENGTH,
          constants.FIRST_EPOCH_NUMBER,
          firstEpochBlock,
        ])
      ).to.be.reverted;
      await expect(
        upgrades.deployProxy(stakingFactory, [
          stakingToken.address,
          rewardToken.address,
          constants.TOKE_TOKEN,
          ethers.constants.AddressZero,
          constants.TOKE_MANAGER,
          constants.TOKE_REWARD,
          liquidityReserve.address,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          constants.EPOCH_LENGTH,
          constants.FIRST_EPOCH_NUMBER,
          firstEpochBlock,
        ])
      ).to.be.reverted;
      await expect(
        upgrades.deployProxy(stakingFactory, [
          stakingToken.address,
          rewardToken.address,
          constants.TOKE_TOKEN,
          constants.TOKE_ADDRESS,
          ethers.constants.AddressZero,
          constants.TOKE_REWARD,
          liquidityReserve.address,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          constants.EPOCH_LENGTH,
          constants.FIRST_EPOCH_NUMBER,
          firstEpochBlock,
        ])
      ).to.be.reverted;
      await expect(
        upgrades.deployProxy(stakingFactory, [
          stakingToken.address,
          rewardToken.address,
          constants.TOKE_TOKEN,
          constants.TOKE_ADDRESS,
          constants.TOKE_MANAGER,
          ethers.constants.AddressZero,
          liquidityReserve.address,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          constants.EPOCH_LENGTH,
          constants.FIRST_EPOCH_NUMBER,
          firstEpochBlock,
        ])
      ).to.be.reverted;
    });
  });

  describe("stake", function () {
    it("User can stake, claim and unstake full amount when warmup period is 0", async () => {
      const { staker1 } = await getNamedAccounts();
      let staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);
      // transfer STAKING_TOKEN to staker 1
      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(transferAmount);

      let staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(0);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount = transferAmount.div(2);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await expect(
        stakingStaker1.functions["stake(uint256)"](0)
      ).to.be.revertedWith("Must have valid amount");
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(stakingAmount);

      // shouldn't go to warmup contract
      const warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(0);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);
      await stakingStaker1.unstake(stakingAmount, false);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(0);

      const cooldownRewardTokenBalance = await rewardToken.balanceOf(
        stakingCooldown.address
      );
      expect(cooldownRewardTokenBalance).eq(stakingAmount);
    });
    it("Users have to wait for warmup period to claim and cooldown period to withdraw", async () => {
      const { staker1 } = await getNamedAccounts();

      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      await staking.setWarmUpPeriod(1);
      await staking.setCoolDownPeriod(1);
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount = transferAmount;
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      // balance should still be zero, until we claim the rewardToken.
      let staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(0);

      let warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);

      // fails to claim
      await stakingStaker1.claim(staker1);
      warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      let currentBlock = await ethers.provider.getBlockNumber();
      const nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

      // mining 256 blocks at a time
      for (let i = currentBlock / 256; i <= nextRewardBlock / 256; i++) {
        await network.provider.send("hardhat_mine", ["0x100"]);
        currentBlock = await ethers.provider.getBlockNumber();
      }

      // need to rebase to increase epoch number
      await stakingStaker1.rebase();

      // claim succeeds now
      await stakingStaker1.claim(staker1);

      staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(stakingAmount);

      warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(0);

      await stakingStaker1.unstake(stakingAmount, false);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      // shouldn't have stakingToken balance
      let stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      await stakingStaker1.claimWithdraw(staker1);

      // epoch hasn't increased yet so claimWithdraw doesn't work yet
      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      // need to rebase to increase epoch number
      await stakingStaker1.rebase();
      await stakingStaker1.claimWithdraw(staker1);

      // has stakingBalance after withdrawal
      stakingTokenBalance = await stakingToken.balanceOf(staker1);

      expect(stakingTokenBalance).eq(stakingAmount);
    });
    it("Fails to unstake when calling more than what user has in wallet or warmup contract", async () => {
      const { staker1 } = await getNamedAccounts();
      await staking.setWarmUpPeriod(1);

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

      const warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);

      // unstake fails due to too incorrect amount
      await expect(
        stakingStaker1.unstake(stakingAmount.add(1), false)
      ).to.be.revertedWith("Insufficient Balance");
    });
    it("Users can unstake using funds from both wallet and warmup", async () => {
      const { staker1 } = await getNamedAccounts();
      await staking.setWarmUpPeriod(1);

      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount = transferAmount.div(2);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      let warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      let staker1RewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardTokenBalance).eq(0);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);

      let currentBlock = await ethers.provider.getBlockNumber();
      const nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

      // mining 256 blocks at a time
      for (let i = currentBlock / 256; i <= nextRewardBlock / 256; i++) {
        await network.provider.send("hardhat_mine", ["0x100"]);
        currentBlock = await ethers.provider.getBlockNumber();
      }

      // need to rebase to increase epoch number
      await stakingStaker1.rebase();

      await stakingStaker1.claim(staker1);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      staker1RewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardTokenBalance).eq(stakingAmount);

      // unstake will grab rewardTokens from both warmup & wallet
      await stakingStaker1.unstake(transferAmount, false);

      warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(0);

      staker1RewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardTokenBalance).eq(0);
    });
    it("User can stake and unstake half amount without claiming", async () => {
      const { staker1 } = await getNamedAccounts();
      await staking.setWarmUpPeriod(1);

      let staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);
      // transfer STAKING_TOKEN to staker 1
      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount = transferAmount.div(2);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      let currentBlock = await ethers.provider.getBlockNumber();
      const nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

      // mining 256 blocks at a time
      for (let i = currentBlock / 256; i <= nextRewardBlock / 256; i++) {
        await network.provider.send("hardhat_mine", ["0x100"]);
        currentBlock = await ethers.provider.getBlockNumber();
      }

      // need to rebase to increase epoch number
      await stakingStaker1.rebase();

      // warmUpInfo for staker1 should be stakingAmount
      let warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount);

      let warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);
      await stakingStaker1.unstake(stakingAmount.div(2), false);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      const cooldownRewardTokenBalance = await rewardToken.balanceOf(
        stakingCooldown.address
      );
      expect(cooldownRewardTokenBalance).eq(stakingAmount.div(2));

      // warmUpInfo for staker1 should be 2500
      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount.div(2));

      warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount.div(2));
    });
    it("User can stake and unstake full amount without claiming", async () => {
      const { staker1 } = await getNamedAccounts();
      await staking.setWarmUpPeriod(1);

      let staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);
      // transfer STAKING_TOKEN to staker 1
      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount = transferAmount.div(2);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      let currentBlock = await ethers.provider.getBlockNumber();
      const nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

      // mining 256 blocks at a time
      for (let i = currentBlock / 256; i <= nextRewardBlock / 256; i++) {
        await network.provider.send("hardhat_mine", ["0x100"]);
        currentBlock = await ethers.provider.getBlockNumber();
      }
      await stakingStaker1.rebase();

      // warmUpInfo for staker1 should be stakingAmount
      let warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount);

      let warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      // no need to call sendWithdrawalRequests if previously mined to next block
      await mineBlocksToNextCycle();

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);
      await stakingStaker1.unstake(stakingAmount, false);

      const cooldownRewardTokenBalance = await rewardToken.balanceOf(
        stakingCooldown.address
      );
      expect(cooldownRewardTokenBalance).eq(stakingAmount);

      // warmUpInfo for staker1 should have been deleted
      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(0);

      warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(0);
    });
    it("Warmup period changing doesn't break stuff", async () => {
      const { staker1 } = await getNamedAccounts();
      await staking.setWarmUpPeriod(1);

      // transfer STAKING_TOKEN to staker 1
      const stakingAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, stakingAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      await staking.setWarmUpPeriod(0);

      let stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      let rewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(rewardTokenBalance).eq(0);

      // can't claim because users Claim expiry didn't actually change
      stakingStaker1.claim(staker1);

      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      rewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(rewardTokenBalance).eq(0);

      let currentBlock = await ethers.provider.getBlockNumber();
      const nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

      // mining 256 blocks at a time
      for (let i = currentBlock / 256; i <= nextRewardBlock / 256; i++) {
        await network.provider.send("hardhat_mine", ["0x100"]);
        currentBlock = await ethers.provider.getBlockNumber();
      }
      await stakingStaker1.rebase();

      // can claim now due to expiry passing
      stakingStaker1.claim(staker1);

      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      rewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(rewardTokenBalance).eq(stakingAmount);
    });
    it("RequestedWithdrawals are 0 until sendWithdrawalRequests is called", async () => {
      const { staker1 } = await getNamedAccounts();

      // transfer STAKING_TOKEN to staker 1
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

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);
      await stakingStaker1.unstake(stakingAmount, false);

      let requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );

      // has no requestedWithdrawals
      expect(requestedWithdrawals.amount).eq(0);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      // has no requestedWithdrawals
      expect(requestedWithdrawals.amount).eq(stakingAmount);
    });
    it("Can instant unstake with liquidity reserve", async () => {
      const { staker1 } = await getNamedAccounts();

      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      // can't instantUnstake without reward tokens
      await expect(stakingStaker1.instantUnstake(false)).to.be.reverted;

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);
      await stakingStaker1.functions["stake(uint256)"](transferAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, transferAmount);

      let rewardBalance = await rewardToken.balanceOf(staker1);
      expect(rewardBalance).eq(transferAmount);

      let stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      await stakingStaker1.instantUnstake(false);

      rewardBalance = await rewardToken.balanceOf(staker1);
      expect(rewardBalance).eq(0);

      const amountMinusFee = transferAmount.sub(
        transferAmount.mul(constants.INSTANT_UNSTAKE_FEE).div(10000)
      );
      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(amountMinusFee);
    });
    it("Can instant unstake without claiming", async () => {
      const { staker1 } = await getNamedAccounts();
      await staking.setWarmUpPeriod(1);

      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);
      await stakingStaker1.functions["stake(uint256)"](transferAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, transferAmount);

      let rewardBalance = await rewardToken.balanceOf(staker1);
      expect(rewardBalance).eq(0);

      let stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      await stakingStaker1.instantUnstake(true);

      rewardBalance = await rewardToken.balanceOf(staker1);
      expect(rewardBalance).eq(0);

      const amountMinusFee = transferAmount.sub(
        transferAmount.mul(constants.INSTANT_UNSTAKE_FEE).div(10000)
      );
      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(amountMinusFee);
    });
    it("User can stake and unstake multiple times with and without claiming", async () => {
      const { staker1 } = await getNamedAccounts();
      await staking.setWarmUpPeriod(1);
      await staking.setCoolDownPeriod(2);

      let staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);
      // transfer STAKING_TOKEN to staker 1
      const transferAmount = BigNumber.from("10000000");
      const stakingAmount = transferAmount.div(4);

      await stakingToken.transfer(staker1, transferAmount);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      let currentBlock = await ethers.provider.getBlockNumber();
      let nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

      // mining 256 blocks at a time
      for (let i = currentBlock / 256; i <= nextRewardBlock / 256; i++) {
        await network.provider.send("hardhat_mine", ["0x100"]);
        currentBlock = await ethers.provider.getBlockNumber();
      }
      await stakingStaker1.rebase();

      // warmUpInfo for staker1 should be stakingAmount
      let warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount);

      let warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      await stakingStaker1.claim(staker1);

      let rewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(rewardTokenBalance).eq(stakingAmount);

      warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(0);

      // stake again after claiming
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount);

      warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      currentBlock = await ethers.provider.getBlockNumber();
      nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

      // mining 256 blocks at a time
      for (let i = currentBlock / 256; i <= nextRewardBlock / 256; i++) {
        await network.provider.send("hardhat_mine", ["0x100"]);
        currentBlock = await ethers.provider.getBlockNumber();
      }
      await stakingStaker1.rebase();

      // should auto claim the current warmup rewards when staking again
      warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      // warmup reward token balance stays same due to previous staking amount being claimed
      warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      // staker1 reward balance doubles due to being claimed
      rewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(rewardTokenBalance).eq(stakingAmount.mul(2));

      // warmupInfo should match stakingAmount since previous balance was claimed
      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount);

      // should be able to stake again with rewards in warmup during same epoch
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      // warmup reward token balance should double
      warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount.mul(2));

      // staker1 reward balance should stay the same
      rewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(rewardTokenBalance).eq(stakingAmount.mul(2));

      // warmupInfo should should double
      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount.mul(2));

      // able to unstake with warmup & wallet balance
      await mineBlocksToNextCycle();

      let coolDownInfo = await staking.coolDownInfo(staker1);
      expect(coolDownInfo.amount).eq(0);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, transferAmount);
      await stakingStaker1.unstake(stakingAmount, false);

      coolDownInfo = await staking.coolDownInfo(staker1);
      expect(coolDownInfo.amount).eq(stakingAmount);

      let cooldownRewardTokenBalance = await rewardToken.balanceOf(
        stakingCooldown.address
      );
      expect(cooldownRewardTokenBalance).eq(stakingAmount);

      // warmUpInfo & rewardToken balance had 2x stakingAmount, should now have 1x staking amount
      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount);

      warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      // able to unstake with warmup & cooldown & wallet balance
      await stakingStaker1.unstake(stakingAmount.mul(2), false);

      coolDownInfo = await staking.coolDownInfo(staker1);
      expect(coolDownInfo.amount).eq(stakingAmount.mul(3));

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      // cooldown should be 3x stakingAmount
      cooldownRewardTokenBalance = await rewardToken.balanceOf(
        stakingCooldown.address
      );
      expect(cooldownRewardTokenBalance).eq(stakingAmount.mul(3));

      // warmUpInfo & rewardToken balance should be empty now
      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(0);

      warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(0);

      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
      await mineBlocksToNextCycle();
      await stakingStaker1.rebase();

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);

      // can't claim yet due to cooldown period being 2
      await stakingStaker1.claimWithdraw(staker1);
      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);
      coolDownInfo = await staking.coolDownInfo(staker1);
      expect(coolDownInfo.amount).eq(stakingAmount.mul(3));

      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
      await mineBlocksToNextCycle();
      await stakingStaker1.rebase();

      // can claim now
      await stakingStaker1.claimWithdraw(staker1);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(stakingAmount.mul(3));

      coolDownInfo = await staking.coolDownInfo(staker1);
      expect(coolDownInfo.amount).eq(0);

      // should still have some reward tokens left
      rewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(rewardTokenBalance).eq(stakingAmount);
    });
    it("Can't instant unstake if not enough liquidity reserve", async () => {
      const { staker1 } = await getNamedAccounts();
      await staking.setWarmUpPeriod(1);

      const balance = await stakingToken.balanceOf(liquidityReserve.address);
      const transferAmount = balance.add(1);
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);
      await stakingStaker1.functions["stake(uint256)"](transferAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, transferAmount);

      const rewardBalance = await rewardToken.balanceOf(staker1);
      expect(rewardBalance).eq(0);

      const stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      await expect(stakingStaker1.instantUnstake(true)).to.be.revertedWith(
        "Not enough funds in reserve"
      );
    });
    it("when unstaking again without claimWithdraw it auto claims withdraw", async () => {
      const { staker1 } = await getNamedAccounts();

      let staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);
      // transfer STAKING_TOKEN to staker 1
      const stakingAmount = BigNumber.from("10000");
      const unStakingAmount = stakingAmount.div(2);

      await stakingToken.transfer(staker1, stakingAmount);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(stakingAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      let currentBlock = await ethers.provider.getBlockNumber();
      const nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

      // mining 256 blocks at a time
      for (let i = currentBlock / 256; i <= nextRewardBlock / 256; i++) {
        await network.provider.send("hardhat_mine", ["0x100"]);
        currentBlock = await ethers.provider.getBlockNumber();
      }
      await stakingStaker1.rebase();

      // no need to call sendWithdrawalRequests if previously mined to next block
      await mineBlocksToNextCycle();

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);
      await stakingStaker1.unstake(unStakingAmount, false);

      let cooldownRewardTokenBalance = await rewardToken.balanceOf(
        stakingCooldown.address
      );
      expect(cooldownRewardTokenBalance).eq(unStakingAmount);

      let stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      // do rollover
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      await stakingStaker1.rebase();

      await stakingStaker1.unstake(unStakingAmount, false);

      // rest of unstaking reward goes into cooldown
      cooldownRewardTokenBalance = await rewardToken.balanceOf(
        stakingCooldown.address
      );
      expect(cooldownRewardTokenBalance).eq(unStakingAmount);

      // automatically claims previous cooldown rewards
      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(unStakingAmount);
    });
    it("can unstake multiple times and get full amount", async () => {
      const { staker1 } = await getNamedAccounts();

      let staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);
      // transfer STAKING_TOKEN to staker 1
      const stakingAmount = BigNumber.from("10000");
      const unStakingAmount = stakingAmount.div(2);

      await stakingToken.transfer(staker1, stakingAmount);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(stakingAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);
      await stakingStaker1.unstake(unStakingAmount, false);
      await stakingStaker1.unstake(unStakingAmount, false);

      // full amount in cooldown contract
      let cooldownRewardTokenBalance = await rewardToken.balanceOf(
        stakingCooldown.address
      );
      expect(cooldownRewardTokenBalance).eq(stakingAmount);

      // nothing in users wallet
      let stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      // do rollover
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      await stakingStaker1.claimWithdraw(staker1);

      cooldownRewardTokenBalance = await rewardToken.balanceOf(
        stakingCooldown.address
      );
      expect(cooldownRewardTokenBalance).eq(0);

      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(stakingAmount);
    });
    it("unstakeAllFromTokemak allows users to unstake and claim rewards", async () => {
      const { staker1, admin } = await getNamedAccounts();
      let staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);
      // transfer STAKING_TOKEN to staker 1
      const stakingAmount = BigNumber.from("100000");

      await stakingToken.transfer(staker1, stakingAmount);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(stakingAmount);

      const staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(0);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);

      await mineBlocksToNextCycle();

      const stakingContractStakingBalance = await stakingToken.balanceOf(
        staking.address
      );
      expect(stakingContractStakingBalance).eq(0);

      // call unstakeAllFromTokemak
      const adminSigner = accounts.find((account) => account.address === admin);
      const stakingAdmin = staking.connect(adminSigner as Signer);
      await stakingAdmin.unstakeAllFromTokemak();

      // do rollover
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      // user can still unstake and claim without sendWithdrawalRequest
      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);

      // user should now be able to unstake + claim in one action
      await stakingStaker1.unstake(stakingAmount, false);
      await stakingStaker1.claimWithdraw(staker1);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(stakingAmount);
    });
    it("unstakeAllFromTokemak allows users to unstake and claim rewards with cooldown", async () => {
      const { staker1, admin } = await getNamedAccounts();
      let staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);
      // transfer STAKING_TOKEN to staker 1
      const stakingAmount = BigNumber.from("100000");

      await stakingToken.transfer(staker1, stakingAmount);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(stakingAmount);

      const staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(0);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);

      await mineBlocksToNextCycle();

      const stakingContractStakingBalance = await stakingToken.balanceOf(
        staking.address
      );
      expect(stakingContractStakingBalance).eq(0);

      // call unstakeAllFromTokemak
      const adminSigner = accounts.find((account) => account.address === admin);
      const stakingAdmin = staking.connect(adminSigner as Signer);
      await stakingAdmin.unstakeAllFromTokemak();

      // do rollover
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      // user can still unstake and claim without sendWithdrawalRequest
      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);

      // user should now be able to unstake + claim in one action
      await stakingStaker1.unstake(stakingAmount, false);
      await stakingStaker1.claimWithdraw(staker1);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(stakingAmount);
    });
  });

  describe("reward", function () {
    it("Reward indexes are set correctly", async () => {
      const { staker1, staker2 } = await getNamedAccounts();
      // transfer STAKING_TOKEN to staker 1
      const transferAmount = BigNumber.from("1000000000000000");

      expect(await rewardToken.getIndex()).eq("1000000000000000000");

      await stakingToken.transfer(staker1, transferAmount);
      await stakingToken.transfer(staker2, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount1 = BigNumber.from("1000");

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount1);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount1);

      // claim should move the rewardToken from warmup to the staker
      await stakingStaker1.claim(staker1);

      let rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);

      // call rebase without rewards, no change should occur in balances.
      await staking.rebase();

      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);

      // add rewards and trigger rebase, no rebase should occur due to scheduled block
      await stakingToken.approve(staking.address, ethers.constants.MaxUint256); // from admin
      const awardAmount = BigNumber.from("1000");

      // can't send more than balance
      await expect(
        stakingStaker1.addRewardsForStakers(transferAmount.add(1), false)
      ).to.be.reverted;

      await staking.addRewardsForStakers(awardAmount, false);

      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);

      // fast forward to after reward block
      let currentBlock = await ethers.provider.getBlockNumber();
      let nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

      // mining 256 blocks at a time
      for (let i = currentBlock / 256; i <= nextRewardBlock / 256; i++) {
        await network.provider.send("hardhat_mine", ["0x100"]);
        currentBlock = await ethers.provider.getBlockNumber();
      }

      // call rebase - no change still rewards are issued in a 1 period lagging fashion...
      await staking.rebase();
      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);

      currentBlock = await ethers.provider.getBlockNumber();
      nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

      // mining 256 blocks at a time
      for (let i = currentBlock / 256; i <= nextRewardBlock / 256; i++) {
        await network.provider.send("hardhat_mine", ["0x100"]);
        currentBlock = await ethers.provider.getBlockNumber();
      }

      // finally rewards should be issued
      await staking.rebase();
      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      expect(rewardTokenBalanceStaker1).eq(stakingAmount1.add(awardAmount));
      expect(await rewardToken.getIndex()).eq("2000000000000000000");
    });
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

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);
      expect(rewardTokenBalanceStaker2).eq(stakingAmount2);

      // call rebase without rewards, no change should occur in balances.
      await staking.rebase();

      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);
      expect(rewardTokenBalanceStaker2).eq(stakingAmount2);

      // add rewards and trigger rebase, no rebase should occur due to scheduled block
      await stakingToken.approve(staking.address, ethers.constants.MaxUint256); // from admin
      const awardAmount = BigNumber.from("1000");

      // can't send more than balance
      await expect(
        stakingStaker1.addRewardsForStakers(transferAmount.add(1), false)
      ).to.be.reverted;

      await staking.addRewardsForStakers(awardAmount, false);

      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);
      expect(rewardTokenBalanceStaker2).eq(stakingAmount2);

      // fast forward to after reward block
      let currentBlock = await ethers.provider.getBlockNumber();
      let nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

      // mining 256 blocks at a time
      for (let i = currentBlock / 256; i <= nextRewardBlock / 256; i++) {
        await network.provider.send("hardhat_mine", ["0x100"]);
        currentBlock = await ethers.provider.getBlockNumber();
      }

      // call rebase - no change still rewards are issued in a 1 period lagging fashion...
      await staking.rebase();
      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);
      expect(rewardTokenBalanceStaker2).eq(stakingAmount2);

      currentBlock = await ethers.provider.getBlockNumber();
      nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

      // mining 256 blocks at a time
      for (let i = currentBlock / 256; i <= nextRewardBlock / 256; i++) {
        await network.provider.send("hardhat_mine", ["0x100"]);
        currentBlock = await ethers.provider.getBlockNumber();
      }

      // finally rewards should be issued
      await staking.rebase();
      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);
      expect(rewardTokenBalanceStaker1).eq(stakingAmount1.add(909));
      expect(rewardTokenBalanceStaker2).eq(stakingAmount2.add(90));
    });
    it("Unstakes correct amounts with rewards", async () => {
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

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);
      expect(rewardTokenBalanceStaker2).eq(stakingAmount2);

      // call rebase without rewards, no change should occur in balances.
      await staking.rebase();

      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);
      expect(rewardTokenBalanceStaker2).eq(stakingAmount2);

      // add rewards and trigger rebase, no rebase should occur due to scheduled block
      await stakingToken.approve(staking.address, ethers.constants.MaxUint256); // from admin
      const awardAmount = BigNumber.from("1000");
      await staking.addRewardsForStakers(awardAmount, true);

      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);
      expect(rewardTokenBalanceStaker2).eq(stakingAmount2);

      // fast forward to after reward block
      let currentBlock = await ethers.provider.getBlockNumber();
      let nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

      // mining 256 blocks at a time
      for (let i = currentBlock / 256; i <= nextRewardBlock / 256; i++) {
        await network.provider.send("hardhat_mine", ["0x100"]);
        currentBlock = await ethers.provider.getBlockNumber();
      }

      // call rebase - no change still rewards are issued in a 1 period lagging fashion...
      await staking.rebase();
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);
      expect(rewardTokenBalanceStaker2).eq(stakingAmount2);

      currentBlock = await ethers.provider.getBlockNumber();
      nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

      // mining 256 blocks at a time
      for (let i = currentBlock / 256; i <= nextRewardBlock / 256; i++) {
        await network.provider.send("hardhat_mine", ["0x100"]);
        currentBlock = await ethers.provider.getBlockNumber();
      }

      const newStakingAmount1 = stakingAmount1.add(909);
      const newStakingAmount2 = stakingAmount2.add(90);

      // finally rewards should be issued
      await staking.rebase();
      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);
      expect(rewardTokenBalanceStaker1).eq(newStakingAmount1);
      expect(rewardTokenBalanceStaker2).eq(newStakingAmount2);

      // unstake with new amounts
      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, newStakingAmount1);
      await stakingStaker1.unstake(newStakingAmount1, false);

      await rewardToken
        .connect(staker2Signer as Signer)
        .approve(staking.address, newStakingAmount2);
      await stakingStaker2.unstake(newStakingAmount2, false);

      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);
      expect(rewardTokenBalanceStaker1).eq(0);
      expect(rewardTokenBalanceStaker2).eq(0);

      const cooldownRewardTokenBalance = await rewardToken.balanceOf(
        stakingCooldown.address
      );
      expect(cooldownRewardTokenBalance).eq(
        newStakingAmount1.add(newStakingAmount2)
      );
    });
    it("Gives the correct amount of rewards ", async () => {
      const { staker1, staker2 } = await getNamedAccounts();
      // transfer STAKING_TOKEN to staker 1
      const transferAmount = BigNumber.from("10000000000");

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

      const stakingAmount1 = BigNumber.from("1000");
      const stakingAmount2 = BigNumber.from("10000000000");

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount1);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount1);

      const stakingTokenStaker2 = stakingToken.connect(staker2Signer as Signer);
      await stakingTokenStaker2.approve(staking.address, stakingAmount2);
      await stakingStaker2.functions["stake(uint256)"](stakingAmount2);

      const rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      const rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);
      expect(rewardTokenBalanceStaker2).eq(stakingAmount2);

      // call rebase without rewards, no change should occur in balances.
      await staking.rebase();

      await rewardToken
        .connect(staker2Signer as Signer)
        .approve(staking.address, stakingAmount2);
      await stakingStaker2.unstake(stakingAmount2, false);

      // initial withdraw request sets lastTokeCycleIndex
      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      let stakingContractBalance = await stakingToken.balanceOf(
        staking.address
      );
      expect(stakingContractBalance).eq(stakingAmount2);

      const withdrawalAmount = await staking.withdrawalAmount();
      expect(withdrawalAmount).eq(stakingAmount2);

      await stakingToken.approve(staking.address, ethers.constants.MaxUint256); // from admin
      const awardAmount = BigNumber.from("100000");
      await staking.addRewardsForStakers(awardAmount, true);

      stakingContractBalance = await stakingToken.balanceOf(staking.address);
      expect(stakingContractBalance).eq(stakingAmount2);

      const epoch = await staking.epoch();
      expect(epoch.distribute).eq(awardAmount);
    });
  });

  describe("vesting", function () {
    it("Fails when no staking contract or reward token is passed in", async () => {
      const { staker1 } = await getNamedAccounts();
      const vestingFactory = await ethers.getContractFactory("Vesting");

      await expect(
        vestingFactory.deploy(staking.address, ethers.constants.AddressZero)
      ).to.be.reverted;
      await expect(
        vestingFactory.deploy(ethers.constants.AddressZero, rewardToken.address)
      ).to.be.reverted;

      const vestingContract = await vestingFactory.deploy(
        staking.address,
        rewardToken.address
      );
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const staker1Vesting = await vestingContract.connect(
        staker1Signer as Signer
      );

      await expect(staker1Vesting.retrieve(staker1, BigNumber.from("10000"))).to
        .be.reverted;
    });
  });
  describe("sendWithdrawalRequest", function () {
    it("requestWithdrawalAmount is correct", async () => {
      const { staker1, staker2, staker3 } = await getNamedAccounts();

      const transferAmount = BigNumber.from("100000");
      const stakingAmount1 = transferAmount.div(4);
      const stakingAmount2 = transferAmount.div(2);
      const stakingAmount3 = transferAmount.div(3);

      await stakingToken.transfer(staker1, stakingAmount1);
      await stakingToken.transfer(staker2, stakingAmount2);
      await stakingToken.transfer(staker3, stakingAmount3);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const staker2Signer = accounts.find(
        (account) => account.address === staker2
      );
      const staker3Signer = accounts.find(
        (account) => account.address === staker3
      );

      const stakingStaker1 = staking.connect(staker1Signer as Signer);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount1);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount1);
      await stakingStaker1.claim(staker1);

      const stakingStaker2 = staking.connect(staker2Signer as Signer);
      const stakingTokenStaker2 = stakingToken.connect(staker2Signer as Signer);
      await stakingTokenStaker2.approve(staking.address, stakingAmount2);
      await stakingStaker2.functions["stake(uint256)"](stakingAmount2);
      await stakingStaker2.claim(staker2);

      const stakingStaker3 = staking.connect(staker3Signer as Signer);
      const stakingTokenStaker3 = stakingToken.connect(staker3Signer as Signer);
      await stakingTokenStaker3.approve(staking.address, stakingAmount3);
      await stakingStaker3.functions["stake(uint256)"](stakingAmount3);
      await stakingStaker3.claim(staker3);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount1);
      await stakingStaker1.unstake(stakingAmount1, false);

      // initial withdraw request sets lastTokeCycleIndex
      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      let requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      expect(requestedWithdrawals.amount).eq(stakingAmount1);

      await rewardToken
        .connect(staker2Signer as Signer)
        .approve(staking.address, stakingAmount2);
      await stakingStaker2.unstake(stakingAmount2, false);

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
      await mineBlocksToNextCycle();

      await stakingStaker1.sendWithdrawalRequests();

      let stakingTokenBalance = await stakingToken.balanceOf(staking.address);
      requestedWithdrawals = await tokePool.requestedWithdrawals(
        staking.address
      );
      expect(requestedWithdrawals.amount.add(stakingTokenBalance)).eq(
        stakingAmount1.add(stakingAmount2)
      );

      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
      await mineBlocksToNextCycle();

      await stakingStaker2.claimWithdraw(staker2);

      stakingTokenBalance = await stakingToken.balanceOf(staking.address);
      requestedWithdrawals = await tokePool.requestedWithdrawals(
        staking.address
      );
      expect(requestedWithdrawals.amount.add(stakingTokenBalance)).eq(
        stakingAmount1
      );

      await rewardToken
        .connect(staker3Signer as Signer)
        .approve(staking.address, stakingAmount3);
      await stakingStaker3.unstake(stakingAmount3, false);

      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
      await mineBlocksToNextCycle();
      await stakingStaker3.sendWithdrawalRequests();

      // finally, it goes through
      stakingTokenBalance = await stakingToken.balanceOf(staking.address);
      requestedWithdrawals = await tokePool.requestedWithdrawals(
        staking.address
      );
      expect(requestedWithdrawals.amount.add(stakingTokenBalance)).eq(
        stakingAmount1.add(stakingAmount3)
      );
    });
    it("fails if either index isn't increased or batch period hasn't hit", async () => {
      const { staker1, staker2, staker3 } = await getNamedAccounts();

      const transferAmount = BigNumber.from("100000");
      const stakingAmount1 = transferAmount.div(4);
      const stakingAmount2 = transferAmount.div(2);
      const stakingAmount3 = transferAmount.div(3);

      await stakingToken.transfer(staker1, stakingAmount1);
      await stakingToken.transfer(staker2, stakingAmount2);
      await stakingToken.transfer(staker3, stakingAmount3);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const staker2Signer = accounts.find(
        (account) => account.address === staker2
      );
      const staker3Signer = accounts.find(
        (account) => account.address === staker3
      );

      const stakingStaker1 = staking.connect(staker1Signer as Signer);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount1);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount1);
      await stakingStaker1.claim(staker1);

      const stakingStaker2 = staking.connect(staker2Signer as Signer);
      const stakingTokenStaker2 = stakingToken.connect(staker2Signer as Signer);
      await stakingTokenStaker2.approve(staking.address, stakingAmount2);
      await stakingStaker2.functions["stake(uint256)"](stakingAmount2);
      await stakingStaker2.claim(staker2);

      const stakingStaker3 = staking.connect(staker3Signer as Signer);
      const stakingTokenStaker3 = stakingToken.connect(staker3Signer as Signer);
      await stakingTokenStaker3.approve(staking.address, stakingAmount3);
      await stakingStaker3.functions["stake(uint256)"](stakingAmount3);
      await stakingStaker3.claim(staker3);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount1);
      await stakingStaker1.unstake(stakingAmount1, false);

      // initial withdraw request sets lastTokeCycleIndex
      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      let requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      expect(requestedWithdrawals.amount).eq(stakingAmount1);

      await rewardToken
        .connect(staker2Signer as Signer)
        .approve(staking.address, stakingAmount2);
      await stakingStaker2.unstake(stakingAmount2, false);

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      await stakingStaker1.sendWithdrawalRequests();

      // requestedWithdrawals doesn't change due to not within batch window
      requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      expect(requestedWithdrawals.amount).eq(stakingAmount1);

      await mineBlocksToNextCycle();

      // sendWithdrawalRequests work now
      await stakingStaker1.sendWithdrawalRequests();

      let stakingContractTokenBalance = await stakingToken.balanceOf(
        staking.address
      );
      requestedWithdrawals = await tokePool.requestedWithdrawals(
        staking.address
      );
      expect(requestedWithdrawals.amount.add(stakingContractTokenBalance)).eq(
        stakingAmount1.add(stakingAmount2)
      );

      await rewardToken
        .connect(staker3Signer as Signer)
        .approve(staking.address, stakingAmount3);
      await stakingStaker3.unstake(stakingAmount3, false);

      await mineBlocksToNextCycle();
      await stakingStaker3.sendWithdrawalRequests();

      // requestedWithdrawals not updated due to cycle index not being updated
      stakingContractTokenBalance = await stakingToken.balanceOf(
        staking.address
      );
      requestedWithdrawals = await tokePool.requestedWithdrawals(
        staking.address
      );
      expect(requestedWithdrawals.amount.add(stakingContractTokenBalance)).eq(
        stakingAmount1.add(stakingAmount2)
      );

      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
      await mineBlocksToNextCycle();
      await stakingStaker3.sendWithdrawalRequests();

      // finally, it goes through
      stakingContractTokenBalance = await stakingToken.balanceOf(
        staking.address
      );
      requestedWithdrawals = await tokePool.requestedWithdrawals(
        staking.address
      );
      expect(requestedWithdrawals.amount.add(stakingContractTokenBalance)).eq(
        stakingAmount1.add(stakingAmount2).add(stakingAmount3)
      );
    });
    it("still sends if missed window", async () => {
      const { staker1, staker2 } = await getNamedAccounts();

      const transferAmount = BigNumber.from("100000");
      const stakingAmount1 = transferAmount.div(4);
      const stakingAmount2 = transferAmount.div(2);

      await stakingToken.transfer(staker1, stakingAmount1);
      await stakingToken.transfer(staker2, stakingAmount2);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const staker2Signer = accounts.find(
        (account) => account.address === staker2
      );

      const stakingStaker1 = staking.connect(staker1Signer as Signer);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount1);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount1);
      await stakingStaker1.claim(staker1);

      const stakingStaker2 = staking.connect(staker2Signer as Signer);
      const stakingTokenStaker2 = stakingToken.connect(staker2Signer as Signer);
      await stakingTokenStaker2.approve(staking.address, stakingAmount2);
      await stakingStaker2.functions["stake(uint256)"](stakingAmount2);
      await stakingStaker2.claim(staker2);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount1);
      await stakingStaker1.unstake(stakingAmount1, false);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      await rewardToken
        .connect(staker2Signer as Signer)
        .approve(staking.address, stakingAmount2);
      await stakingStaker2.unstake(stakingAmount2, false);

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
      await mineBlocksToNextCycle();
      await mineBlocksToNextCycle();

      // get current lastTokeCycleIndex
      const lastCycle = await stakingStaker1.lastTokeCycleIndex();
      // withdraw even though missed window
      await stakingStaker1.sendWithdrawalRequests();
      // lastTokeCycleIndex should but updated
      const nextCycle = await stakingStaker1.lastTokeCycleIndex();

      expect(lastCycle.toNumber()).lessThan(nextCycle.toNumber());

      // next requestedWithdrawals should be
      const stakingContractTokenBalance = await stakingToken.balanceOf(
        staking.address
      );
      const requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );

      const totalStakingAmount = stakingAmount2.add(stakingAmount1);
      expect(requestedWithdrawals.amount.add(stakingContractTokenBalance)).eq(
        totalStakingAmount
      );

      // both should be able to claim
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      await stakingStaker1.claimWithdraw(staker1);
      await stakingStaker2.claimWithdraw(staker2);

      const staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(stakingAmount1);

      const staker2StakingBalance = await stakingToken.balanceOf(staker2);
      expect(staker2StakingBalance).eq(stakingAmount2);
    });
  });

  describe("tokemak", function () {
    it("Fails when incorrectly claims/transfer TOKE", async () => {
      const { staker1 } = await getNamedAccounts();

      const v = 28;
      const r =
        "0x0402de926473b79c91b67a49a931108c4c593442ce63193d9c35a9ef12c7d495";
      const s =
        "0x2c3d7cf17e33eb30408a4fb266a812008a35a9e8987e841eecb92504620f55bd";
      let recipient = {
        chainId: 1,
        cycle: 167,
        wallet: staking.address,
        amount: 0,
      };
      // must have amount > 0
      await expect(
        staking.claimFromTokemak(recipient, v, r, s)
      ).to.be.revertedWith("Must enter valid amount");
      recipient = {
        chainId: 1,
        cycle: 167,
        wallet: staking.address,
        amount: 1000,
      };
      // can't actually claim rewards, invalid signature returned from Tokemak
      await expect(
        staking.claimFromTokemak(recipient, v, r, s)
      ).to.be.revertedWith("'ECDSA: invalid signature'");

      // transferToke fails on 0 address
      await expect(staking.transferToke(ethers.constants.AddressZero)).to.be
        .reverted;

      // tries to transfer toke, but to staker1 but none exists
      await staking.transferToke(staker1);
    });
    it("Sends correct amount to affiliate", async () => {
      const { staker1, staker2 } = await getNamedAccounts();
      const transferAmount = BigNumber.from("1000000");

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_TOKEN_WHALE],
      });

      const whaleSigner = await ethers.getSigner(constants.TOKE_TOKEN_WHALE);
      const tokeTokenWhale = tokeToken.connect(whaleSigner);
      await tokeTokenWhale.transfer(staking.address, transferAmount);

      let tokeTokenBalance = await tokeToken.balanceOf(staking.address);
      expect(BigNumber.from(tokeTokenBalance).toNumber()).gte(
        transferAmount.toNumber()
      );

      await staking.setAffiliateAddress(staker2);
      await staking.setAffiliateFee(1000);

      // tries to transfer toke, but to staker1 but none exists
      await staking.transferToke(staker1);
      const fee = transferAmount.mul(await staking.affiliateFee()).div(10000);

      // staker1 balance
      tokeTokenBalance = await tokeToken.balanceOf(staker1);
      expect(tokeTokenBalance).eq(transferAmount.sub(fee));

      // affiliate balance
      tokeTokenBalance = await tokeToken.balanceOf(staker2);
      expect(tokeTokenBalance).eq(fee);
    });
    it("Staking gives tStakingToken to the Staking contract", async () => {
      const { staker1 } = await getNamedAccounts();

      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      // tokePool should be 0 when no TOKE deposits have been made
      let tokeBalance = await tokePool.balanceOf(stakingStaker1.address);
      expect(tokeBalance).eq(0);

      const stakingAmount = transferAmount.div(2);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      // should receive 1:1 tokePool to STAKING_TOKEN
      tokeBalance = await tokePool.balanceOf(stakingStaker1.address);
      expect(tokeBalance).eq(stakingAmount);
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

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount1);
      await stakingStaker1.unstake(stakingAmount1, false);

      await rewardToken
        .connect(staker2Signer as Signer)
        .approve(staking.address, stakingAmount2);
      await stakingStaker2.unstake(stakingAmount2, false);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      const requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );

      const totalStakingAmount = stakingAmount2.add(stakingAmount1);
      expect(requestedWithdrawals.amount).eq(totalStakingAmount);
    });
    it("Withdrawing gives the user their stakingToken back from Tokemak", async () => {
      const { staker1 } = await getNamedAccounts();

      const stakingAmount = BigNumber.from("100000");
      await stakingToken.transfer(staker1, stakingAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );

      // user starts out with stakingToken balance
      let stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(stakingAmount);

      const stakingStaker1 = staking.connect(staker1Signer as Signer);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);
      await stakingStaker1.claim(staker1);

      // user stakes all of his stakingTokens
      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);
      await stakingStaker1.unstake(stakingAmount, false);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      const requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      expect(requestedWithdrawals.amount).eq(stakingAmount);

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      // shouldn't have stakingToken balance
      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      await stakingStaker1.claimWithdraw(staker1);

      // has stakingBalance after withdrawal
      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(stakingAmount);
    });
    it("Can't withdraw without first creating a withdrawRequest", async () => {
      const { staker1 } = await getNamedAccounts();

      const stakingAmount = BigNumber.from("100000");
      await stakingToken.transfer(staker1, stakingAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );

      const stakingStaker1 = staking.connect(staker1Signer as Signer);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);
      await stakingStaker1.claim(staker1);

      const requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      // has no requestedWithdrawals
      expect(requestedWithdrawals.amount).eq(0);

      await mineBlocksToNextCycle();

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);

      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
      await stakingStaker1.claimWithdraw(staker1);

      // has no stakingBalance after withdrawal
      const stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);
    });
    it("Must wait for new index to send batched withdrawalRequests", async () => {
      const { staker1 } = await getNamedAccounts();
      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount1 = transferAmount.div(4);
      const stakingAmount2 = transferAmount.div(2);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount1);

      const staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(stakingAmount1);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, transferAmount);

      await stakingStaker1.unstake(stakingAmount1, false);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      // requestedWithdrawals is set to stakingAmount1 after request
      let requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      expect(requestedWithdrawals.amount).eq(stakingAmount1);

      await stakingStaker1.functions["stake(uint256)"](stakingAmount2);

      await stakingStaker1.unstake(stakingAmount2, false);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      // requestedWithdrawals is set to stakingAmount1 because rollover hasn't happened yet
      requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      expect(requestedWithdrawals.amount).eq(stakingAmount1);

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);

      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      // requestedWithdrawals is set to stakingAmount2 because rollover happened and lastTokeCycleIndex was updated
      requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      const stakingTokenBalance = await stakingToken.balanceOf(staking.address);

      expect(requestedWithdrawals.amount.add(stakingTokenBalance)).eq(
        stakingAmount2.add(stakingAmount1)
      );
    });
    it("canBatchTransactions is handled appropriately", async () => {
      const { staker1 } = await getNamedAccounts();

      // transfer STAKING_TOKEN to staker 1
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

      // has no requestedWithdrawals or cooldown amounts
      let requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      expect(requestedWithdrawals.amount).eq(0);

      const staker1RewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardTokenBalance).eq(stakingAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);

      await stakingStaker1.unstake(stakingAmount, false);

      await stakingStaker1.sendWithdrawalRequests();

      // no withdrawal requests or cooldowns should be created
      requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );

      expect(requestedWithdrawals.amount).eq(0);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      // requestWithdrawal and cooldown should be created
      requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      expect(requestedWithdrawals.amount).eq(stakingAmount);
    });
  });
  describe("admin", () => {
    it("Admin functions work correctly", async () => {
      const { admin, staker1 } = await getNamedAccounts();
      const adminSigner = accounts.find((account) => account.address === admin);
      const stakingAdmin = staking.connect(adminSigner as Signer);

      await stakingAdmin.shouldPauseStaking(true);
      await stakingAdmin.shouldPauseUnstaking(true);
      await stakingAdmin.setCoolDownPeriod(99999999999999);

      await stakingAdmin.setTimeLeftToRequestWithdrawal(10);
      const timeLeftToRequest = await staking.timeLeftToRequestWithdrawal();
      await expect(timeLeftToRequest).eq(10);

      // transfer STAKING_TOKEN to staker 1
      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount = transferAmount;
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);

      // fails due to staking being paused
      await expect(
        stakingStaker1.functions["stake(uint256)"](stakingAmount)
      ).to.be.revertedWith("Staking is paused");
      await stakingAdmin.shouldPauseStaking(false);

      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);

      // fails due to unstaking being paused
      await expect(
        stakingStaker1.unstake(stakingAmount, true)
      ).to.be.revertedWith("Unstaking is paused");
      await expect(stakingStaker1.instantUnstake(true)).to.be.revertedWith(
        "Unstaking is paused"
      );

      await stakingAdmin.shouldPauseInstantUnstaking(true);
      await stakingAdmin.shouldPauseUnstaking(false);

      await expect(stakingStaker1.instantUnstake(true)).to.be.revertedWith(
        "Unstaking is paused"
      );
      await stakingStaker1.unstake(stakingAmount, true);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      await stakingStaker1.claimWithdraw(staker1);

      // doesn't have staking balance due to cooldown period not expired
      const stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      let epoch = await staking.epoch();
      // @ts-ignore
      expect(epoch._length).eq(44800);

      await stakingAdmin.setEpochLength(1000);

      epoch = await staking.epoch();
      // @ts-ignore
      expect(epoch._length).eq(1000);

      // test unstakAllFromTokemak

      let requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      expect(requestedWithdrawals.amount).eq(stakingAmount);

      // stake a bunch of stuff
      await stakingToken.transfer(staker1, stakingAmount);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);

      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      // unstake all tfox from tokemak
      const tokeBalance = await tokePool.balanceOf(staking.address);
      await stakingAdmin.unstakeAllFromTokemak();

      requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      expect(requestedWithdrawals.amount).eq(tokeBalance);
    });
    it("Emergency exit is working", async () => {
      const { staker1, staker2, staker3 } = await getNamedAccounts();

      const transferAmount = BigNumber.from("100000");
      const stakingAmount1 = transferAmount.div(4);
      const stakingAmount2 = transferAmount.div(2);
      const stakingAmount3 = transferAmount.div(3);
      const totalStaking = stakingAmount1
        .add(stakingAmount2)
        .add(stakingAmount3);

      await stakingToken.transfer(staker1, stakingAmount1);
      await stakingToken.transfer(staker2, stakingAmount2);
      await stakingToken.transfer(staker3, stakingAmount3);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const staker2Signer = accounts.find(
        (account) => account.address === staker2
      );
      const staker3Signer = accounts.find(
        (account) => account.address === staker3
      );

      const stakingStaker1 = staking.connect(staker1Signer as Signer);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount1);
      await stakingStaker1.claim(staker1);

      const stakingStaker2 = staking.connect(staker2Signer as Signer);
      const stakingTokenStaker2 = stakingToken.connect(staker2Signer as Signer);
      await stakingTokenStaker2.approve(staking.address, stakingAmount2);
      await stakingStaker2.functions["stake(uint256)"](stakingAmount2);
      await stakingStaker2.claim(staker2);

      const stakingStaker3 = staking.connect(staker3Signer as Signer);
      const stakingTokenStaker3 = stakingToken.connect(staker3Signer as Signer);
      await stakingTokenStaker3.approve(staking.address, stakingAmount3);
      await stakingStaker3.functions["stake(uint256)"](stakingAmount3);
      await stakingStaker3.claim(staker3);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount1);
      await stakingStaker1.unstake(stakingAmount1, false);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      const stakingContractTokenBalance = await stakingToken.balanceOf(
        staking.address
      );
      let requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      expect(requestedWithdrawals.amount.add(stakingContractTokenBalance)).eq(
        stakingAmount1
      );

      await staking.unstakeAllFromTokemak();

      // entire pool being unstaked
      requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      expect(requestedWithdrawals.amount.add(stakingContractTokenBalance)).eq(
        totalStaking
      );

      // can't stake
      await expect(
        stakingStaker1.functions["stake(uint256)"](stakingAmount1)
      ).to.be.revertedWith("Staking is paused");

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await mineBlocksToNextCycle();
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      // staker1 doesn't need to unstake since they already did
      await stakingStaker1.claimWithdraw(staker1);
      let stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(stakingAmount1);

      // staker2 can unstake and withdraw
      await rewardToken
        .connect(staker2Signer as Signer)
        .approve(staking.address, stakingAmount2);
      await stakingStaker2.unstake(stakingAmount2, false);
      await stakingStaker2.claimWithdraw(staker2);
      stakingTokenBalance = await stakingToken.balanceOf(staker2);
      expect(stakingTokenBalance).eq(stakingAmount2);

      staking.setCoolDownPeriod(1);

      // staker3 will need to wait for the cooldown period
      await rewardToken
        .connect(staker3Signer as Signer)
        .approve(staking.address, stakingAmount3);
      await stakingStaker3.unstake(stakingAmount3, false);
      await stakingStaker3.claimWithdraw(staker3);

      // no withdrawal due to cooldown
      stakingTokenBalance = await stakingToken.balanceOf(staker3);
      expect(stakingTokenBalance).eq(0);

      // rebase so staker3 can claim
      await mineBlocksToNextCycle();
      await stakingStaker1.rebase();

      await stakingStaker3.claimWithdraw(staker3);

      stakingTokenBalance = await stakingToken.balanceOf(staker3);
      expect(stakingTokenBalance).eq(stakingAmount3);
    });
  });
});
