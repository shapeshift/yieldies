import { ethers, deployments, getNamedAccounts, network } from "hardhat";
import { expect } from "chai";
import { Foxy } from "../typechain-types/Foxy";
import { Staking } from "../typechain-types/Staking";
import { Vesting } from "../typechain-types/Vesting";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Contract, Signer } from "ethers";
import { tokePoolAbi } from "./abis/tokePoolAbi";
import { tokeManagerAbi } from "./abis/tokeManagerAbi";
import { abi as vestingAbi } from "../artifacts/src/contracts/Vesting.sol/Vesting.json";
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20.json";
import { LiquidityReserve } from "../typechain-types";

describe("Staking", function () {
  let accounts: SignerWithAddress[];
  let rewardToken: Foxy;
  let staking: Staking;
  let liquidityReserve: LiquidityReserve;
  let stakingToken: Contract;
  let tokePool: Contract;
  let tokeManager: Contract;
  let stakingWarmup: Vesting;
  let stakingCooldown: Vesting;

  const STAKING_TOKEN_WHALE = "0xF152a54068c8eDDF5D537770985cA8c06ad78aBB"; // FOX Whale
  const STAKING_TOKEN = "0xc770EEfAd204B5180dF6a14Ee197D99d808ee52d"; // FOX Address
  const TOKE_ADDRESS = "0x808D3E6b23516967ceAE4f17a5F9038383ED5311"; // tFOX Address
  const TOKE_OWNER = "0x90b6c61b102ea260131ab48377e143d6eb3a9d4b";
  const LATEST_CLAIMABLE_HASH =
    "QmWCH3fhEfceBYQhC1hkeM7RZ8FtDeZxSF4hDnpkogXM6W";
  const CYCLE_HASH = "QmZfyx21SzdqpqQeQWNsBUDVJQ7cmTqELo5y5dCPQMQqgn";

  // mines blocks to the next TOKE cycle
  async function mineBlocksToNextCycle() {
    const currentBlock = await ethers.provider.getBlockNumber();
    const cycleDuration = await tokeManager.getCycleDuration();
    const cycleStart = await tokeManager.getCurrentCycle();
    let blocksTilNextCycle =
      cycleStart.toNumber() + cycleDuration.toNumber() - currentBlock;
    while (blocksTilNextCycle > 0) {
      blocksTilNextCycle--;
      await network.provider.request({
        method: "evm_mine",
        params: [],
      });
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
            blockNumber: 14101169,
          },
        },
      ],
    });

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

    const liquidityReserveDeployment = await deployments.get(
      "LiquidityReserve"
    );
    liquidityReserve = new ethers.Contract(
      liquidityReserveDeployment.address,
      liquidityReserveDeployment.abi,
      accounts[0]
    ) as LiquidityReserve;

    const warmUpContract = await staking.warmUpContract();
    stakingWarmup = new ethers.Contract(
      warmUpContract,
      vestingAbi,
      accounts[0]
    ) as Vesting; // is there a better way to avoid this cast?
    const coolDownContract = await staking.coolDownContract();
    stakingCooldown = new ethers.Contract(
      coolDownContract,
      vestingAbi,
      accounts[0]
    ) as Vesting; // is there a better way to avoid this cast?

    const tokeManagerAddress = await tokePool.manager();
    tokeManager = new ethers.Contract(
      tokeManagerAddress,
      tokeManagerAbi,
      accounts[0]
    );

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
    const stakingTokenBalance = await stakingToken.balanceOf(admin);
    const liquidityReserveStakingWhale = liquidityReserve.connect(whaleSigner);
    console.log(1)
    await stakingTokenWhale.transfer(liquidityReserve.address, transferAmount);
    console.log(2)

    expect(BigNumber.from(stakingTokenBalance).toNumber()).gte(
      transferAmount.toNumber()
    );
  });

  describe("initialize", function () {
    it("Should assign the total supply of rewardToken to the stakingContract", async () => {
      const stakingContractBalance = await rewardToken.balanceOf(
        staking.address
      );
      const supply = await rewardToken.totalSupply();
      expect(stakingContractBalance).eq(supply);
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
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      // balance should still be zero, until we claim the rewardToken.
      staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(0);

      let warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      // claim should move the rewardToken from warmup to the staker
      await stakingStaker1.claim(staker1);

      staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(stakingAmount);

      warmupRewardTokenBalance = await rewardToken.balanceOf(
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

      let cooldownRewardTokenBalance = await rewardToken.balanceOf(
        stakingCooldown.address
      );
      expect(cooldownRewardTokenBalance).eq(stakingAmount);
    });
    it("Users have to wait for warmup period to claim", async () => {
      const { staker1 } = await getNamedAccounts();

      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      let currentBlock = await ethers.provider.getBlockNumber();
      let nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

      await staking.setVesting(1);
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount = transferAmount.div(2);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

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

      for (let i = currentBlock; i <= nextRewardBlock; i++) {
        await ethers.provider.send("evm_mine", []);
      }

      // need to rebase to increase epoch number
      await stakingStaker1.rebase();

      // claim succeeds now
      await stakingStaker1.claim(staker1);

      warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(0);
    });
    it("Fails to unstake when calling more than what user has in wallet or warmup contract", async () => {
      const { staker1 } = await getNamedAccounts();

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

      let warmupRewardTokenBalance = await rewardToken.balanceOf(
        stakingWarmup.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);

      // unstake fails due to too incorrect amount
      await expect(
        stakingStaker1.unstake(stakingAmount.add(1), false)
      ).to.be.revertedWith(
        "reverted with panic code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)"
      );
    });
    it("User can stake and unstake half amount without claiming when warmup period is 0", async () => {
      const { staker1 } = await getNamedAccounts();
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

      let cooldownRewardTokenBalance = await rewardToken.balanceOf(
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
    it("User can stake and unstake full amount without claiming when warmup period is 0", async () => {
      const { staker1 } = await getNamedAccounts();
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
      await stakingStaker1.unstake(stakingAmount, false);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      let cooldownRewardTokenBalance = await rewardToken.balanceOf(
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
    it("requestedWithdrawals are 0 until sendWithdrawalRequests is called", async () => {
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
    it.only("can instant unstake", async () => {
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
      await stakingStaker1.claim(staker1);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);
        
      const rewardBalance = await rewardToken.balanceOf(staker1);
      console.log("rewardBalance", rewardBalance);
      console.log("stakingAmount", stakingAmount);
      await stakingStaker1.instantUnstake(stakingAmount, false);
    });
    it.skip("can instant unstake without claiming", async () => {
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
      const rewardBalance = await rewardToken.balanceOf(staker1);
      console.log("rewardBalance", rewardBalance);
      await stakingStaker1.instantUnstake(stakingAmount, false);
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

      for (let i = currentBlock; i <= nextRewardBlock; i++) {
        await ethers.provider.send("evm_mine", []);
      }

      // call rebase - no change still rewards are issued in a 1 period lagging fashion...
      await staking.rebase();
      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);
      expect(rewardTokenBalanceStaker2).eq(stakingAmount2);

      currentBlock = await ethers.provider.getBlockNumber();
      nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

      for (let i = currentBlock; i <= nextRewardBlock; i++) {
        await ethers.provider.send("evm_mine", []);
      }

      // finally rewards should be issued
      await staking.rebase();
      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);
      expect(rewardTokenBalanceStaker1).eq(stakingAmount1.add(909));
      expect(rewardTokenBalanceStaker2).eq(stakingAmount2.add(90));
    });
  });

  describe("tokemak", function () {
    describe("stake", function () {
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
        expect(tokeBalance).eq(0);

        const stakingAmount = transferAmount.div(2);
        const stakingTokenStaker1 = stakingToken.connect(
          staker1Signer as Signer
        );
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
        const stakingTokenStaker1 = stakingToken.connect(
          staker1Signer as Signer
        );
        await stakingTokenStaker1.approve(staking.address, stakingAmount1);
        await stakingStaker1.functions["stake(uint256)"](stakingAmount1);
        await stakingStaker1.claim(staker1);

        const stakingStaker2 = staking.connect(staker2Signer as Signer);
        const stakingAmount2 = transferAmount.div(2);
        const stakingTokenStaker2 = stakingToken.connect(
          staker2Signer as Signer
        );
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
        const stakingTokenStaker1 = stakingToken.connect(
          staker1Signer as Signer
        );
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
          params: [TOKE_OWNER],
        });
        const tokeSigner = await ethers.getSigner(TOKE_OWNER);
        const tokeManagerOwner = tokeManager.connect(tokeSigner);
        await tokeManagerOwner.completeRollover(LATEST_CLAIMABLE_HASH);

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
        const stakingTokenStaker1 = stakingToken.connect(
          staker1Signer as Signer
        );
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
          params: [TOKE_OWNER],
        });
        const tokeSigner = await ethers.getSigner(TOKE_OWNER);
        const tokeManagerOwner = tokeManager.connect(tokeSigner);

        await tokeManagerOwner.completeRollover(LATEST_CLAIMABLE_HASH);
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
        const stakingTokenStaker1 = stakingToken.connect(
          staker1Signer as Signer
        );
        await stakingTokenStaker1.approve(staking.address, transferAmount);
        await stakingStaker1.functions["stake(uint256)"](stakingAmount1);

        await rewardToken
          .connect(staker1Signer as Signer)
          .approve(staking.address, stakingAmount1);

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
          params: [TOKE_OWNER],
        });
        const tokeSigner = await ethers.getSigner(TOKE_OWNER);
        const tokeManagerOwner = tokeManager.connect(tokeSigner);

        await tokeManagerOwner.completeRollover(LATEST_CLAIMABLE_HASH);

        await mineBlocksToNextCycle();
        await stakingStaker1.sendWithdrawalRequests();

        // requestedWithdrawals is set to stakingAmount2 because rollover happened and lastTokeCycleIndex was updated
        requestedWithdrawals = await tokePool.requestedWithdrawals(
          stakingStaker1.address
        );

        expect(requestedWithdrawals.amount).eq(stakingAmount2);
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
        const stakingTokenStaker1 = stakingToken.connect(
          staker1Signer as Signer
        );
        await stakingTokenStaker1.approve(staking.address, stakingAmount);
        await stakingStaker1.functions["stake(uint256)"](stakingAmount);

        // has no requestedWithdrawals or cooldown amounts
        let requestedWithdrawals = await tokePool.requestedWithdrawals(
          stakingStaker1.address
        );
        expect(requestedWithdrawals.amount).eq(0);

        let warmupRewardTokenBalance = await rewardToken.balanceOf(
          stakingWarmup.address
        );
        expect(warmupRewardTokenBalance).eq(stakingAmount);

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
    describe("rewards", () => {
      it("shows claimableAmount after staking", async () => {
        const { staker1 } = await getNamedAccounts();

        const transferAmount = BigNumber.from("10000");
        await stakingToken.transfer(staker1, transferAmount);

        let staker1RewardBalance = await rewardToken.balanceOf(staker1);
        expect(staker1RewardBalance).eq(0);

        const staker1Signer = accounts.find(
          (account) => account.address === staker1
        );
        const stakingStaker1 = staking.connect(staker1Signer as Signer);

        const stakingAmount = transferAmount.div(2);
        const stakingTokenStaker1 = stakingToken.connect(
          staker1Signer as Signer
        );
        await stakingTokenStaker1.approve(staking.address, stakingAmount);
        await stakingStaker1.functions["stake(uint256)"](stakingAmount);

        await mineBlocksToNextCycle();
        await network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [TOKE_OWNER],
        });
        const tokeSigner = await ethers.getSigner(TOKE_OWNER);
        const tokeManagerOwner = tokeManager.connect(tokeSigner);
        await tokeManagerOwner.completeRollover(LATEST_CLAIMABLE_HASH);

        const info = await stakingStaker1.getTokemakIpfsInfo();

        expect(info.cycle).eq(CYCLE_HASH);
        expect(info.latestClaimable).eq(LATEST_CLAIMABLE_HASH);

        const amount = await stakingStaker1.getClaimableAmountTokemak(
          BigNumber.from("71578818929843382106")
        );
        expect(amount).eq("71578818929843382106");
      });
    });
  });
});
