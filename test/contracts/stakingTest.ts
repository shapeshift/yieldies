import { ethers, deployments, getNamedAccounts, network } from "hardhat";
import { expect } from "chai";
import { Foxy } from "../../typechain-types/Foxy";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Contract, Signer } from "ethers";
import { tokePoolAbi } from "../../src/abis/tokePoolAbi";
import { tokeManagerAbi } from "../../src/abis/tokeManagerAbi";
import { abi as vestingAbi } from "../../artifacts/src/contracts/Vesting.sol/Vesting.json";
import { abi as liquidityReserveAbi } from "../../artifacts/src/contracts/LiquidityReserve.sol/LiquidityReserve.json";
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20.json";
import { LiquidityReserve, Vesting, Staking } from "../../typechain-types";
import { INSTANT_UNSTAKE_FEE } from "../constants";

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
  const TOKE_OWNER = "0x90b6c61b102ea260131ab48377e143d6eb3a9d4b"; // owner of Tokemak Pool
  const TOKE_REWARD = "0x79dD22579112d8a5F7347c5ED7E609e60da713C5"; // TOKE reward contract address
  const TOKE_REWARD_HASH = "0x5ec3EC6A8aC774c7d53665ebc5DDf89145d02fB6"; // TOKE reward hash contract address

  const LATEST_CLAIMABLE_HASH =
    "QmWCH3fhEfceBYQhC1hkeM7RZ8FtDeZxSF4hDnpkogXM6W";

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
    stakingToken = new ethers.Contract(STAKING_TOKEN, ERC20.abi, accounts[0]);

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

    const warmUpAddress = await staking.WARM_UP_CONTRACT();
    stakingWarmup = new ethers.Contract(
      warmUpAddress,
      vestingAbi,
      accounts[0]
    ) as Vesting; // is there a better way to avoid this cast?
    const coolDownAddress = await staking.COOL_DOWN_CONTRACT();
    stakingCooldown = new ethers.Contract(
      coolDownAddress,
      vestingAbi,
      accounts[0]
    ) as Vesting; // is there a better way to avoid this cast?

    const tokeManagerAddress = await tokePool.manager();
    tokeManager = new ethers.Contract(
      tokeManagerAddress,
      tokeManagerAbi,
      accounts[0]
    );

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [STAKING_TOKEN_WHALE],
    });

    // Transfer to admin account for STAKING_TOKEN to be easily transferred to other accounts
    const transferAmount = BigNumber.from("9000000000000000");
    const whaleSigner = await ethers.getSigner(STAKING_TOKEN_WHALE);
    const stakingTokenWhale = stakingToken.connect(whaleSigner);
    await stakingTokenWhale.transfer(admin, transferAmount);
    const stakingTokenBalance = await stakingToken.balanceOf(admin);
    expect(BigNumber.from(stakingTokenBalance).toNumber()).gte(
      transferAmount.toNumber()
    );

    await rewardToken.initialize(stakingDeployment.address); // initialize reward contract
    await stakingToken.approve(
      liquidityReserve.address,
      BigNumber.from("1000000000000000")
    ); // approve initial liquidity amount
    await liquidityReserve.initialize(
      stakingDeployment.address,
      rewardToken.address
    ); // initialize liquidity reserve contract

    await liquidityReserve.setFee(INSTANT_UNSTAKE_FEE);
  });

  describe("initialize", function () {
    it("Should assign the total supply of rewardToken to the stakingContract", async () => {
      const stakingContractBalance = await rewardToken.balanceOf(
        staking.address
      );
      const supply = await rewardToken.totalSupply();
      expect(stakingContractBalance).eq(supply);
    });
    it("Fails when no staking/reward token or staking contract is passed in", async () => {
      const { admin, staker1 } = await getNamedAccounts();

      const stakingFactory = await ethers.getContractFactory("Staking");

      // fail due to bad addresses
      await expect(
        stakingFactory.deploy(
          stakingToken.address,
          "0x0000000000000000000000000000000000000000",
          TOKE_ADDRESS,
          tokePool.address,
          tokeManager.address,
          TOKE_REWARD,
          TOKE_REWARD_HASH,
          liquidityReserve.address,
          1,
          1,
          1
        )
      ).to.be.reverted;
      await expect(
        stakingFactory.deploy(
          "0x0000000000000000000000000000000000000000",
          rewardToken.address,
          TOKE_ADDRESS,
          tokePool.address,
          tokeManager.address,
          TOKE_REWARD,
          TOKE_REWARD_HASH,
          liquidityReserve.address,
          1,
          1,
          1
        )
      ).to.be.reverted;
      await expect(
        stakingFactory.deploy(
          stakingToken.address,
          rewardToken.address,
          "0x0000000000000000000000000000000000000000",
          tokePool.address,
          tokeManager.address,
          TOKE_REWARD,
          TOKE_REWARD_HASH,
          liquidityReserve.address,
          1,
          1,
          1
        )
      ).to.be.reverted;
      await expect(
        stakingFactory.deploy(
          stakingToken.address,
          rewardToken.address,
          TOKE_ADDRESS,
          "0x0000000000000000000000000000000000000000",
          tokeManager.address,
          TOKE_REWARD,
          TOKE_REWARD_HASH,
          liquidityReserve.address,
          1,
          1,
          1
        )
      ).to.be.reverted;
      await expect(
        stakingFactory.deploy(
          stakingToken.address,
          rewardToken.address,
          TOKE_ADDRESS,
          tokePool.address,
          "0x0000000000000000000000000000000000000000",
          TOKE_REWARD,
          TOKE_REWARD_HASH,
          liquidityReserve.address,
          1,
          1,
          1
        )
      ).to.be.reverted;
      await expect(
        stakingFactory.deploy(
          stakingToken.address,
          rewardToken.address,
          TOKE_ADDRESS,
          tokePool.address,
          tokeManager.address,
          "0x0000000000000000000000000000000000000000",
          TOKE_REWARD_HASH,
          liquidityReserve.address,
          1,
          1,
          1
        )
      ).to.be.reverted;
      await expect(
        stakingFactory.deploy(
          stakingToken.address,
          rewardToken.address,
          TOKE_ADDRESS,
          tokePool.address,
          tokeManager.address,
          TOKE_REWARD,
          "0x0000000000000000000000000000000000000000",
          liquidityReserve.address,
          1,
          1,
          1
        )
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

      const currentBlock = await ethers.provider.getBlockNumber();
      const nextRewardBlock = (await staking.epoch()).endBlock.toNumber();
      for (let i = currentBlock; i <= nextRewardBlock; i++) {
        await ethers.provider.send("evm_mine", []);
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
        params: [TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(LATEST_CLAIMABLE_HASH);

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

      const currentBlock = await ethers.provider.getBlockNumber();
      const nextRewardBlock = (await staking.epoch()).endBlock.toNumber();
      for (let i = currentBlock; i <= nextRewardBlock; i++) {
        await ethers.provider.send("evm_mine", []);
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

      const currentBlock = await ethers.provider.getBlockNumber();
      const nextRewardBlock = (await staking.epoch()).endBlock.toNumber();
      for (let i = currentBlock; i <= nextRewardBlock; i++) {
        await ethers.provider.send("evm_mine", []);
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

      const currentBlock = await ethers.provider.getBlockNumber();
      const nextRewardBlock = (await staking.epoch()).endBlock.toNumber();
      for (let i = currentBlock; i <= nextRewardBlock; i++) {
        await ethers.provider.send("evm_mine", []);
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
    it("Can instant unstake", async () => {
      const { staker1 } = await getNamedAccounts();

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
      expect(rewardBalance).eq(transferAmount);

      let stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      await stakingStaker1.instantUnstake(transferAmount, false);

      rewardBalance = await rewardToken.balanceOf(staker1);
      expect(rewardBalance).eq(0);

      const amountMinusFee = transferAmount.sub(
        transferAmount.mul(INSTANT_UNSTAKE_FEE).div(10000)
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

      await stakingStaker1.instantUnstake(transferAmount, true);

      rewardBalance = await rewardToken.balanceOf(staker1);
      expect(rewardBalance).eq(0);

      const amountMinusFee = transferAmount.sub(
        transferAmount.mul(INSTANT_UNSTAKE_FEE).div(10000)
      );
      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(amountMinusFee);
    });
    it("Admin functions work correctly", async () => {
      const { admin, staker1 } = await getNamedAccounts();
      const adminSigner = accounts.find((account) => account.address === admin);
      const stakingAdmin = staking.connect(adminSigner as Signer);

      await stakingAdmin.shouldPauseStaking(true);
      await stakingAdmin.shouldPauseUnstaking(true);
      await stakingAdmin.setCoolDownPeriod(99999999999999);

      await stakingAdmin.setBlocksLeftToRequestWithdrawal(10);
      const blocksLeftToRequest = await staking.blocksLeftToRequestWithdrawal();
      await expect(blocksLeftToRequest).eq(10);

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
      await expect(
        stakingStaker1.instantUnstake(stakingAmount, true)
      ).to.be.revertedWith("Unstaking is paused");

      await stakingAdmin.shouldPauseUnstaking(false);
      await stakingStaker1.unstake(stakingAmount, true);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(LATEST_CLAIMABLE_HASH);

      await stakingStaker1.claimWithdraw(staker1);

      // doesn't have staking balance due to cooldown period not expired
      let stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      let epoch = await staking.epoch();
      // @ts-ignore
      expect(epoch._length).eq(100);

      await stakingAdmin.setEpochLength(1000);

      epoch = await staking.epoch();
      // @ts-ignore
      expect(epoch._length).eq(1000);
    });
    it("Claim locks work", async () => {
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

      await stakingStaker1.toggleWithdrawLock();
      await expect(
        stakingStaker1.unstake(stakingAmount, false)
      ).to.be.revertedWith("Withdraws for account are locked");
      await stakingStaker1.toggleWithdrawLock();

      await stakingStaker1.unstake(stakingAmount, false);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(LATEST_CLAIMABLE_HASH);

      await stakingStaker1.toggleWithdrawLock();
      await expect(stakingStaker1.claimWithdraw(staker1)).to.be.revertedWith(
        "Withdraws for account are locked"
      );

      await stakingStaker1.toggleWithdrawLock();
      await stakingStaker1.claimWithdraw(staker1);
    });
  });

  describe("reward", function () {
    it("Rewards can be added to contract and rebase rewards users", async () => {
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
      ).to.be.revertedWith("Not enough staking tokens");

      await staking.addRewardsForStakers(awardAmount, false);

      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);

      // fast forward to after reward block
      let currentBlock = await ethers.provider.getBlockNumber();
      let nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

      for (let i = currentBlock; i <= nextRewardBlock; i++) {
        await ethers.provider.send("evm_mine", []);
      }

      // call rebase - no change still rewards are issued in a 1 period lagging fashion...
      await staking.rebase();
      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);

      currentBlock = await ethers.provider.getBlockNumber();
      nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

      for (let i = currentBlock; i <= nextRewardBlock; i++) {
        await ethers.provider.send("evm_mine", []);
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
      ).to.be.revertedWith("Not enough staking tokens");

      await staking.addRewardsForStakers(awardAmount, false);

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

      for (let i = currentBlock; i <= nextRewardBlock; i++) {
        await ethers.provider.send("evm_mine", []);
      }

      // call rebase - no change still rewards are issued in a 1 period lagging fashion...
      await staking.rebase();
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);
      expect(rewardTokenBalanceStaker2).eq(stakingAmount2);

      currentBlock = await ethers.provider.getBlockNumber();
      nextRewardBlock = (await staking.epoch()).endBlock.toNumber();

      for (let i = currentBlock; i <= nextRewardBlock; i++) {
        await ethers.provider.send("evm_mine", []);
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
  });

  describe("vesting", function () {
    it("Fails when no staking or reward token is passed in", async () => {
      const { staker1 } = await getNamedAccounts();
      const vestingFactory = await ethers.getContractFactory("Vesting");

      await expect(
        vestingFactory.deploy(
          stakingToken.address,
          "0x0000000000000000000000000000000000000000"
        )
      ).to.be.reverted;
      await expect(
        vestingFactory.deploy(
          "0x0000000000000000000000000000000000000000",
          rewardToken.address
        )
      ).to.be.reverted;

      const vestingContract = await vestingFactory.deploy(
        stakingToken.address,
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

  describe("tokemak", function () {
    it("Claiming from Tokemak", async () => {
      const { staker1 } = await getNamedAccounts();

      const v = 28;
      const r =
        "0x0402de926473b79c91b67a49a931108c4c593442ce63193d9c35a9ef12c7d495";
      const s =
        "0x2c3d7cf17e33eb30408a4fb266a812008a35a9e8987e841eecb92504620f55bd";

      // must have amount > 0
      await expect(staking.claimFromTokemak(0, v, r, s)).to.be.revertedWith(
        "Must enter valid amount"
      );

      // can't actually claim rewards, invalid signature returned from Tokemak
      await expect(
        staking.claimFromTokemak(BigNumber.from("1000"), v, r, s)
      ).to.be.revertedWith("'ECDSA: invalid signature'");

      // transferToke fails on 0 address
      await expect(
        staking.transferToke("0x0000000000000000000000000000000000000000")
      ).to.be.reverted;

      // tries to transfer toke, but to staker1 but none exists
      await staking.transferToke(staker1);
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
});
