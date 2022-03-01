import { ethers, deployments, getNamedAccounts, network } from "hardhat";
import { expect } from "chai";
import { Foxy } from "../../typechain-types/Foxy";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Contract, Signer } from "ethers";
import { tokePoolAbi } from "../../src/abis/tokePoolAbi";
import { tokeManagerAbi } from "../../src/abis/tokeManagerAbi";
import { abi as vestingAbi } from "../../artifacts/src/contracts/Vesting.sol/Vesting.json";
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20.json";
import { LiquidityReserve, Vesting, Staking } from "../../typechain-types";
import { INSTANT_UNSTAKE_FEE } from "../constants";

describe("Integration", function () {
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

  it.only("Should do everything", async () => {
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

    await stakingToken.approve(staking.address, ethers.constants.MaxUint256); // from admin

    await stakingToken
      .connect(liquidityProvider1Signer as Signer)
      .approve(liquidityReserve.address, ethers.constants.MaxUint256);

    await stakingToken
      .connect(liquidityProvider2Signer as Signer)
      .approve(liquidityReserve.address, ethers.constants.MaxUint256);

    await stakingToken
      .connect(liquidityProvider3Signer as Signer)
      .approve(liquidityReserve.address, ethers.constants.MaxUint256);

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

    await stakingStaker1.functions["stake(uint256)"](stakingAmount1);

    let warmUpInfo = await staking.warmUpInfo(staker1);
    expect(warmUpInfo.amount).eq(stakingAmount1);

    let warmupRewardTokenBalance = await rewardToken.balanceOf(
      stakingWarmup.address
    );
    expect(warmupRewardTokenBalance).eq(stakingAmount1);

    await liquidityReserve
      .connect(liquidityProvider1Signer as Signer)
      .addLiquidity(liquidityAmount1);

    expect(await liquidityReserve.balanceOf(liquidityProvider1)).eq(
      liquidityAmount1
    );

    await stakingStaker2.functions["stake(uint256)"](stakingAmount2);

    warmUpInfo = await staking.warmUpInfo(staker2);
    expect(warmUpInfo.amount).eq(stakingAmount2);

    warmupRewardTokenBalance = await rewardToken.balanceOf(
      stakingWarmup.address
    );
    expect(warmupRewardTokenBalance).eq(stakingAmount2.add(stakingAmount1));

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

    await staking.addRewardsForStakers(awardAmount, true);

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

    await rewardToken
      .connect(staker1Signer as Signer)
      .approve(staking.address, ethers.constants.MaxUint256);

    await stakingStaker1.instantUnstake(true);

    let rewardBalanceStaker1 = await rewardToken.balanceOf(staker1);
    expect(rewardBalanceStaker1).eq(0);

    let stakingBalanceStaker1 = await stakingToken.balanceOf(staker1);
    expect(stakingBalanceStaker1).eq(74158730158730);

    await stakingStaker3.functions["stake(uint256)"](stakingAmount3);

    warmUpInfo = await staking.warmUpInfo(staker3);
    expect(warmUpInfo.amount).eq(stakingAmount3);

    warmupRewardTokenBalance = await rewardToken.balanceOf(
      stakingWarmup.address
    );
    expect(warmupRewardTokenBalance).eq(89523809523809);

    await rewardToken
      .connect(staker1Signer as Signer)
      .approve(staking.address, ethers.constants.MaxUint256);

    await rewardToken
      .connect(staker2Signer as Signer)
      .approve(staking.address, ethers.constants.MaxUint256);

    await rewardToken
      .connect(staker3Signer as Signer)
      .approve(staking.address, ethers.constants.MaxUint256);

    await stakingStaker2.claim(staker2);

    let rewardBalanceStaker2 = await rewardToken.balanceOf(staker2);
    await stakingStaker2.unstake(rewardBalanceStaker2, true);

    let coolDownInfo = await staking.coolDownInfo(staker2);
    expect(coolDownInfo.amount).eq(rewardBalanceStaker2);

    let cooldownRewardTokenBalance = await rewardToken.balanceOf(
      stakingCooldown.address
    );
    expect(cooldownRewardTokenBalance).eq(162222222222221);

    warmUpInfo = await staking.warmUpInfo(staker3);
    expect(warmUpInfo.amount).eq(stakingAmount3);

    const warmUpStaker3Reward = await rewardToken.balanceForGons(
      warmUpInfo.gons
    );
    console.log("reward", warmUpStaker3Reward);

    await stakingStaker3.unstake(warmUpStaker3Reward, true);

    await staking.addRewardsForStakers(awardAmount, true);

    cooldownRewardTokenBalance = await rewardToken.balanceOf(
      stakingCooldown.address
    );
    expect(cooldownRewardTokenBalance).eq(182222222222221);

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

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [TOKE_OWNER],
    });
    const tokeSigner = await ethers.getSigner(TOKE_OWNER);
    const tokeManagerOwner = tokeManager.connect(tokeSigner);
    await mineBlocksToNextCycle();
    await tokeManagerOwner.completeRollover(LATEST_CLAIMABLE_HASH);

    let stakingBalance = await stakingToken.balanceOf(staker2);
    expect(stakingBalance).eq(0);
    let rewardBalance = await rewardToken.balanceOf(staker2);
    expect(rewardBalance).eq(0);
    coolDownInfo = await staking.coolDownInfo(staker2);
    expect(await rewardToken.balanceForGons(coolDownInfo.gons)).eq(
      78002322880370
    );

    await stakingStaker2.claimWithdraw(staker2);
    stakingBalance = await stakingToken.balanceOf(staker2);
    expect(stakingBalance).eq(69523809523809);
    expect(stakingBalance).eq(coolDownInfo.amount);
    rewardBalance = await rewardToken.balanceOf(staker2);
    expect(rewardBalance).eq(0);
    coolDownInfo = await staking.coolDownInfo(staker2);
    expect(coolDownInfo.amount).eq(0);
    
    await stakingStaker3.claimWithdraw(staker3);
    stakingBalance = await stakingToken.balanceOf(staker3);
    expect(stakingBalance).eq(20000000000000);
    rewardBalance = await rewardToken.balanceOf(staker3);
    expect(rewardBalance).eq(0);
    coolDownInfo = await staking.coolDownInfo(staker3);
    expect(coolDownInfo.amount).eq(0);

    cooldownRewardTokenBalance = await rewardToken.balanceOf(
      stakingCooldown.address
    );
    expect(cooldownRewardTokenBalance).eq(104003097173829);

    coolDownInfo = await staking.coolDownInfo(liquidityReserve.address);
    expect(await rewardToken.balanceForGons(coolDownInfo.gons)).eq(104003097173827);
  });
});
