import { ethers, getNamedAccounts, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Yieldy } from "../../typechain-types/Yieldy";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Contract, Signer } from "ethers";
import { tokePoolAbi } from "../../src/abis/tokePoolAbi";
import { tokeManagerAbi } from "../../src/abis/tokeManagerAbi";
import { abi as vestingAbi } from "../../artifacts/src/contracts/Vesting.sol/Vesting.json";
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20.json";
import { LiquidityReserve, Vesting, Staking } from "../../typechain-types";
import * as constants from "../constants";

describe.only("Integration", function () {
  let accounts: SignerWithAddress[];
  let rewardToken: Yieldy;
  let staking: Staking;
  let liquidityReserve: LiquidityReserve;
  let stakingToken: Contract;
  let tokePool: Contract;
  let tokeManager: Contract;
  let stakingWarmup: Vesting;
  let stakingCooldown: Vesting;

  // mines blocks to the next TOKE cycle
  async function mineBlocksToNextCycle() {
    const currentBlock = await ethers.provider.getBlockNumber();
    let currentTime = (await ethers.provider.getBlock(currentBlock)).timestamp;
    const cycleDuration = await tokeManager.getCycleDuration();
    const cycleStart = await tokeManager.getCurrentCycle();
    const nextCycleTime = cycleStart.toNumber() + cycleDuration.toNumber();

    while (currentTime <= nextCycleTime) {
      await network.provider.send("hardhat_mine", ["0x100"]);
      const block = await ethers.provider.getBlockNumber();
      currentTime = (await ethers.provider.getBlock(block)).timestamp;
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

    accounts = await ethers.getSigners();
    stakingToken = new ethers.Contract(constants.STAKING_TOKEN, ERC20.abi, accounts[0]);
    tokePool = new ethers.Contract(constants.TOKE_ADDRESS, tokePoolAbi, accounts[0]);

    const rewardTokenDeployment = await ethers.getContractFactory("Yieldy");
    rewardToken =  await upgrades.deployProxy(rewardTokenDeployment, [
      "Fox Yieldy",
      "FOXy",
    ]) as Yieldy;
    await rewardToken.deployed();

    const liquidityReserveDeployment =  await ethers.getContractFactory("LiquidityReserve");
    liquidityReserve = await upgrades.deployProxy(liquidityReserveDeployment, [
      "Liquidity Reserve FOX",
      "lrFOX",
      constants.STAKING_TOKEN,
      rewardToken.address
    ]) as LiquidityReserve;

    const currentBlock = await ethers.provider.getBlockNumber();
    const firstEpochBlock = currentBlock + constants.EPOCH_LENGTH;
    const stakingDeployment = await ethers.getContractFactory("Staking");
    staking = await upgrades.deployProxy(stakingDeployment, [
      stakingToken.address,
      rewardToken.address,
      constants.TOKE_TOKEN,
      constants.TOKE_ADDRESS,
      constants.TOKE_MANAGER,
      constants.TOKE_REWARD,
      liquidityReserve.address,
      constants.EPOCH_LENGTH,
      constants.FIRST_EPOCH_NUMBER,
      firstEpochBlock,
    ]) as Staking;


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

    // Transfer to admin account for constants.STAKING_TOKEN to be easily transferred to other accounts
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

  it("Should do everything", async () => {
    const {
      staker1,
      staker2,
      staker3,
      liquidityProvider1,
      liquidityProvider2,
      liquidityProvider3,
    } = await getNamedAccounts();
    await staking.setCoolDownPeriod(1);
    await staking.setWarmUpPeriod(1);

    const stakingAmount1 = BigNumber.from("80000000000000");
    const stakingAmount2 = BigNumber.from("60000000000000");
    const stakingAmount3 = BigNumber.from("20000000000000");
    const liquidityAmount1 = BigNumber.from("100000000");
    const liquidityAmount2 = BigNumber.from("888888888888888");
    const liquidityAmount3 = BigNumber.from("777777777777778");
    const awardAmount = BigNumber.from("22222222222222");

    // fund addresses with stakingTokens
    await stakingToken.transfer(liquidityProvider1, liquidityAmount1);
    await stakingToken.transfer(liquidityProvider2, liquidityAmount2);
    await stakingToken.transfer(liquidityProvider3, liquidityAmount3);
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
    const liquidityProvider1Signer = accounts.find(
      (account) => account.address === liquidityProvider1
    );
    const liquidityProvider2Signer = accounts.find(
      (account) => account.address === liquidityProvider2
    );
    const liquidityProvider3Signer = accounts.find(
      (account) => account.address === liquidityProvider3
    );

    // approvals
    await stakingToken.approve(staking.address, ethers.constants.MaxUint256);
    await stakingToken
      .connect(liquidityProvider1Signer as Signer)
      .approve(liquidityReserve.address, ethers.constants.MaxUint256);
    await stakingToken
      .connect(liquidityProvider2Signer as Signer)
      .approve(liquidityReserve.address, ethers.constants.MaxUint256);
    await stakingToken
      .connect(liquidityProvider3Signer as Signer)
      .approve(liquidityReserve.address, ethers.constants.MaxUint256);
    await rewardToken
      .connect(staker1Signer as Signer)
      .approve(staking.address, ethers.constants.MaxUint256);
    await rewardToken
      .connect(staker2Signer as Signer)
      .approve(staking.address, ethers.constants.MaxUint256);
    await rewardToken
      .connect(staker3Signer as Signer)
      .approve(staking.address, ethers.constants.MaxUint256);

    const stakingStaker1 = staking.connect(staker1Signer as Signer);
    const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
    await stakingTokenStaker1.approve(
      staking.address,
      ethers.constants.MaxUint256
    );

    const stakingStaker2 = staking.connect(staker2Signer as Signer);
    const stakingTokenStaker2 = stakingToken.connect(staker2Signer as Signer);
    await stakingTokenStaker2.approve(
      staking.address,
      ethers.constants.MaxUint256
    );

    const stakingStaker3 = staking.connect(staker3Signer as Signer);
    const stakingTokenStaker3 = stakingToken.connect(staker3Signer as Signer);
    await stakingTokenStaker3.approve(
      staking.address,
      ethers.constants.MaxUint256
    );

    // stake with staker1
    await stakingStaker1.functions["stake(uint256)"](stakingAmount1);
    let warmUpInfo = await staking.warmUpInfo(staker1);
    expect(warmUpInfo.amount).eq(stakingAmount1);
    let warmupRewardTokenBalance = await rewardToken.balanceOf(
      stakingWarmup.address
    );
    expect(warmupRewardTokenBalance).eq(stakingAmount1);

    // add liquidity with lp1
    await liquidityReserve
      .connect(liquidityProvider1Signer as Signer)
      .addLiquidity(liquidityAmount1);
    expect(await liquidityReserve.balanceOf(liquidityProvider1)).eq(
      liquidityAmount1
    );

    // stake with staker 2
    await stakingStaker2.functions["stake(uint256)"](stakingAmount2);
    warmUpInfo = await staking.warmUpInfo(staker2);
    expect(warmUpInfo.amount).eq(stakingAmount2);
    warmupRewardTokenBalance = await rewardToken.balanceOf(
      stakingWarmup.address
    );
    expect(warmupRewardTokenBalance).eq(stakingAmount2.add(stakingAmount1));

    // add liquidity twice with lp2
    await liquidityReserve
      .connect(liquidityProvider2Signer as Signer)
      .addLiquidity(liquidityAmount2.div(2));
    expect(await liquidityReserve.balanceOf(liquidityProvider2)).eq(
      liquidityAmount2.div(2)
    );
    await liquidityReserve
      .connect(liquidityProvider2Signer as Signer)
      .addLiquidity(liquidityAmount2.div(2));
    expect(await liquidityReserve.balanceOf(liquidityProvider2)).eq(
      liquidityAmount2
    );

    // add rewards
    await staking.addRewardsForStakers(awardAmount, true);

    // rebase
    let currentBlock = await ethers.provider.getBlockNumber();
    let nextRewardBlock = (await staking.epoch()).endBlock.toNumber();
    for (let i = currentBlock; i <= nextRewardBlock; i++) {
      await ethers.provider.send("evm_mine", []);
    }
    await staking.rebase();
    currentBlock = await ethers.provider.getBlockNumber();
    nextRewardBlock = (await staking.epoch()).endBlock.toNumber();
    for (let i = currentBlock; i <= nextRewardBlock; i++) {
      await ethers.provider.send("evm_mine", []);
    }
    await staking.rebase();

    // instantUnstake with staker1
    await rewardToken
      .connect(staker1Signer as Signer)
      .approve(staking.address, ethers.constants.MaxUint256);
    await stakingStaker1.instantUnstake(true);
    const rewardBalanceStaker1 = await rewardToken.balanceOf(staker1);
    expect(rewardBalanceStaker1).eq(0);
    const stakingBalanceStaker1 = await stakingToken.balanceOf(staker1);
    expect(stakingBalanceStaker1).eq(74158730158730);

    // stake with staker3
    await stakingStaker3.functions["stake(uint256)"](stakingAmount3);
    warmUpInfo = await staking.warmUpInfo(staker3);
    expect(warmUpInfo.amount).eq(stakingAmount3);
    warmupRewardTokenBalance = await rewardToken.balanceOf(
      stakingWarmup.address
    );
    expect(warmupRewardTokenBalance).eq(89523809523809); // stakingAmount3 + stakingAmount2 + rewards

    // claim and unstake with staker2
    await stakingStaker2.claim(staker2);
    const rewardBalanceStaker2 = await rewardToken.balanceOf(staker2);
    await stakingStaker2.unstake(rewardBalanceStaker2, true);
    let coolDownInfo = await staking.coolDownInfo(staker2);
    expect(coolDownInfo.amount).eq(rewardBalanceStaker2);
    let cooldownRewardTokenBalance = await rewardToken.balanceOf(
      stakingCooldown.address
    );
    expect(cooldownRewardTokenBalance).eq(162222222222221);

    // check warmup is correct after unstake
    warmUpInfo = await staking.warmUpInfo(staker3);
    expect(warmUpInfo.amount).eq(stakingAmount3); // staker3 didn't get rewards because they staked after
    const warmUpStaker3Reward = await rewardToken.balanceForGons(
      warmUpInfo.gons
    );

    // unstake with staker3
    await stakingStaker3.unstake(warmUpStaker3Reward, true);

    // add another set of rewards with belong to no one due to all FOXy being locked in cooldown
    await staking.addRewardsForStakers(awardAmount, true);
    cooldownRewardTokenBalance = await rewardToken.balanceOf(
      stakingCooldown.address
    );
    expect(cooldownRewardTokenBalance).eq(182222222222221);

    // rebase
    currentBlock = await ethers.provider.getBlockNumber();
    nextRewardBlock = (await staking.epoch()).endBlock.toNumber();
    for (let i = currentBlock; i <= nextRewardBlock; i++) {
      await ethers.provider.send("evm_mine", []);
    }

    await staking.rebase();
    currentBlock = await ethers.provider.getBlockNumber();
    nextRewardBlock = (await staking.epoch()).endBlock.toNumber();
    for (let i = currentBlock; i <= nextRewardBlock; i++) {
      await ethers.provider.send("evm_mine", []);
    }

    await staking.rebase();

    // complete rollover & send withdraw requests to read withdraw for
    // staker2 & staker3 & liquidity reserve contract
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [constants.TOKE_ADDRESS],
    });
    const tokeSigner = await ethers.getSigner(constants.TOKE_ADDRESS);
    const tokeManagerOwner = tokeManager.connect(tokeSigner);
    await mineBlocksToNextCycle();
    await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
    await mineBlocksToNextCycle();
    await stakingStaker1.sendWithdrawalRequests();
    await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

    let stakingBalance = await stakingToken.balanceOf(staker2);
    expect(stakingBalance).eq(0);
    let rewardBalance = await rewardToken.balanceOf(staker2);
    expect(rewardBalance).eq(0);
    coolDownInfo = await staking.coolDownInfo(staker2);
    expect(await rewardToken.balanceForGons(coolDownInfo.gons)).eq(
      78002322880370
    );

    // remove liquidity with lp1 + rewards from instantUnstake
    await liquidityReserve
      .connect(liquidityProvider1Signer as Signer)
      .removeLiquidity(liquidityAmount1);
    let lpStakingBalance = await stakingToken.balanceOf(liquidityProvider1);
    expect(lpStakingBalance).eq(100981512);

    // remove liquidity with lp2 + rewards from instantUnstake
    await liquidityReserve
      .connect(liquidityProvider2Signer as Signer)
      .removeLiquidity(liquidityAmount2);
    lpStakingBalance = await stakingToken.balanceOf(liquidityProvider2);
    expect(lpStakingBalance).eq(897613444916262);

    // rebase
    currentBlock = await ethers.provider.getBlockNumber();
    nextRewardBlock = (await staking.epoch()).endBlock.toNumber();
    for (let i = currentBlock; i <= nextRewardBlock; i++) {
      await ethers.provider.send("evm_mine", []);
    }
    await staking.rebase();
    currentBlock = await ethers.provider.getBlockNumber();
    nextRewardBlock = (await staking.epoch()).endBlock.toNumber();
    for (let i = currentBlock; i <= nextRewardBlock; i++) {
      await ethers.provider.send("evm_mine", []);
    }
    await staking.rebase();

    // stake with lp2
    await stakingToken
      .connect(liquidityProvider2Signer as Signer)
      .approve(staking.address, ethers.constants.MaxUint256);
    const stakingLiquidityProvider2 = staking.connect(
      liquidityProvider2Signer as Signer
    );
    await stakingLiquidityProvider2.functions["stake(uint256)"](
      897613444916262
    );
    warmUpInfo = await staking.warmUpInfo(liquidityProvider2);
    let warmUpLP2Reward = await rewardToken.balanceForGons(warmUpInfo.gons);
    expect(warmUpLP2Reward).eq(897613444916262);

    // claim with staker2
    await stakingStaker2.claimWithdraw(staker2);
    stakingBalance = await stakingToken.balanceOf(staker2);
    expect(stakingBalance).eq(69523809523809); // stakingAmount2 + rewards
    expect(stakingBalance).eq(coolDownInfo.amount);
    rewardBalance = await rewardToken.balanceOf(staker2);
    expect(rewardBalance).eq(0);
    coolDownInfo = await staking.coolDownInfo(staker2);
    expect(coolDownInfo.amount).eq(0);

    // claim with staker3
    await stakingStaker3.claimWithdraw(staker3);
    stakingBalance = await stakingToken.balanceOf(staker3);
    expect(stakingBalance).eq(stakingAmount3); // staker3 never got rewards because they staked after rewards and unstaked before next rewards
    rewardBalance = await rewardToken.balanceOf(staker3);
    expect(rewardBalance).eq(0);
    coolDownInfo = await staking.coolDownInfo(staker3);
    expect(coolDownInfo.amount).eq(0);

    // liquidity reserve claimed due to claimWithdraw inside instantUnstake
    cooldownRewardTokenBalance = await rewardToken.balanceOf(
      stakingCooldown.address
    );
    expect(cooldownRewardTokenBalance).eq(2); // small amount left over after calculation.  seems within the percentage of error
    coolDownInfo = await staking.coolDownInfo(liquidityReserve.address);
    expect(await rewardToken.balanceForGons(coolDownInfo.gons)).eq(0);

    // add rewards for a third time.  This time liquidityProvider2 should full amount for last two rebases
    // due to no circulating supply outside of cooldown when second reward rebase happened
    // rewardTokens in cooldown does not generate rewards
    await staking.addRewardsForStakers(awardAmount, false);

    // rebase
    currentBlock = await ethers.provider.getBlockNumber();
    nextRewardBlock = (await staking.epoch()).endBlock.toNumber();
    for (let i = currentBlock; i <= nextRewardBlock; i++) {
      await ethers.provider.send("evm_mine", []);
    }
    await staking.rebase();

    currentBlock = await ethers.provider.getBlockNumber();
    nextRewardBlock = (await staking.epoch()).endBlock.toNumber();
    for (let i = currentBlock; i <= nextRewardBlock; i++) {
      await ethers.provider.send("evm_mine", []);
    }
    await staking.rebase();

    // complete rollover to increase tokeIndex
    await mineBlocksToNextCycle();
    await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

    // claimWithdraw from liquidityProvider2
    warmUpInfo = await staking.warmUpInfo(liquidityProvider2);
    warmUpLP2Reward = await rewardToken.balanceForGons(warmUpInfo.gons);
    expect(warmUpLP2Reward).eq(942057889360702);
    await staking.claimWithdraw(liquidityReserve.address);

    // instantUnstake with liquidityProvider2
    await stakingLiquidityProvider2.instantUnstake(true);
    warmUpInfo = await staking.warmUpInfo(liquidityProvider2);
    warmUpLP2Reward = await rewardToken.balanceForGons(warmUpInfo.gons);
    expect(warmUpLP2Reward).eq(0);
    const stakingBalanceLP2 = await stakingToken.balanceOf(liquidityProvider2);
    expect(stakingBalanceLP2).eq(753646311488562); // 80% of 942057889360702
  });
});
