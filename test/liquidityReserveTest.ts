import { ethers, deployments, getNamedAccounts, network } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Contract, Signer } from "ethers";
import { LiquidityReserve } from "../typechain-types";
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20.json";

describe("Liquidity Reserve", function () {
  let accounts: SignerWithAddress[];
  let liquidityReserve: LiquidityReserve;
  let stakingToken: Contract;
  let foxy: Contract;

  const STAKING_TOKEN_WHALE = "0xF152a54068c8eDDF5D537770985cA8c06ad78aBB"; // FOX Whale
  const STAKING_TOKEN = "0xc770EEfAd204B5180dF6a14Ee197D99d808ee52d"; // FOX Address

  beforeEach(async () => {
    const { admin, stakingContractMock } = await getNamedAccounts();
    await deployments.fixture();
    accounts = await ethers.getSigners();

    const liquidityReserveDeployment = await deployments.get(
      "LiquidityReserve"
    );
    liquidityReserve = new ethers.Contract(
      liquidityReserveDeployment.address,
      liquidityReserveDeployment.abi,
      accounts[0]
    ) as LiquidityReserve;

    const foxyDeployment = await deployments.get("Foxy");
    foxy = new ethers.Contract(
      foxyDeployment.address,
      foxyDeployment.abi,
      accounts[0]
    ) as LiquidityReserve;

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [STAKING_TOKEN_WHALE],
    });

    stakingToken = new ethers.Contract(STAKING_TOKEN, ERC20.abi, accounts[0]);

    const transferAmount = BigNumber.from("1000000000");
    const whaleSigner = await ethers.getSigner(STAKING_TOKEN_WHALE);
    const stakingTokenWhale = stakingToken.connect(whaleSigner);
    await stakingTokenWhale.transfer(admin, transferAmount);
    const stakingTokenBalance = await stakingToken.balanceOf(admin);

    expect(BigNumber.from(stakingTokenBalance).toNumber()).gte(
      transferAmount.toNumber()
    );

    await liquidityReserve.setFee(20);
    await foxy.initialize(stakingContractMock);
    await liquidityReserve.initialize(stakingContractMock);
  });

  describe("initialize", function () {
    it("Should assign the total supply of reward tokens to the stakingContract", async () => {
      const { stakingContractMock } = await getNamedAccounts();
      const supply = await foxy.totalSupply();
      const stakingContractBalance = await foxy.balanceOf(stakingContractMock);
      expect(stakingContractBalance.eq(supply)).true;
    });
  });

  it.only("Should calculate the correct value of lrFOX", async () => {
    const { daoTreasury, staker1, staker2, stakingContractMock } =
      await getNamedAccounts();

    const transferAmount = BigNumber.from("100000");
    const stakingAmount = transferAmount.div(4);

    // deposit with daoTreasury
    await stakingToken.transfer(daoTreasury, transferAmount);

    let daoTreasuryStakingBalance = await stakingToken.balanceOf(daoTreasury);
    expect(daoTreasuryStakingBalance).eq(transferAmount);

    let liquidityReserveBalance = await liquidityReserve.balanceOf(daoTreasury);
    expect(liquidityReserveBalance).eq(0);

    const daoTreasurySigner = accounts.find(
      (account) => account.address === daoTreasury
    );
    const liquidityReserveDao = liquidityReserve.connect(
      daoTreasurySigner as Signer
    );
    const stakingTokenDao = stakingToken.connect(daoTreasurySigner as Signer);

    await stakingTokenDao.approve(liquidityReserve.address, transferAmount);
    await liquidityReserveDao.deposit(transferAmount);

    daoTreasuryStakingBalance = await stakingToken.balanceOf(daoTreasury);
    expect(daoTreasuryStakingBalance).eq(0);

    liquidityReserveBalance = await liquidityReserve.balanceOf(daoTreasury);
    expect(liquidityReserveBalance).eq(transferAmount);



    
    // transfer rewardToken from staking contract to staker1

    const stakingContractSigner = accounts.find(
      (account) => account.address === stakingContractMock
    );
    const rewardTokenStakingContract = foxy.connect(stakingContractSigner as Signer);

    await rewardTokenStakingContract.transfer(staker1, stakingAmount);
    let staker1RewardBalance = await foxy.balanceOf(staker1);
    expect(staker1RewardBalance).eq(stakingAmount);



    // instant unstake with staker1

    const staking1Signer = accounts.find(
      (account) => account.address === staker1
    );
    const liquidityReserveStaker1 = liquidityReserve.connect(
      staking1Signer as Signer
    );
    const rewardTokenStaker1 = foxy.connect(staking1Signer as Signer);

    const fee = await liquidityReserve.fee();

    await rewardTokenStaker1.approve(liquidityReserve.address, stakingAmount);
    await liquidityReserveStaker1.instantUnstake(stakingAmount);
    
    const feeAmount = stakingAmount.mul(fee).div(100);
    const amountMinusFee = stakingAmount.sub(feeAmount);

    staker1RewardBalance = await foxy.balanceOf(staker1);
    expect(staker1RewardBalance).eq(0);

    let staker1StakingBalance = await stakingToken.balanceOf(staker1);
    expect(staker1StakingBalance).eq(amountMinusFee);


    // deposit with staker2
    await stakingToken.transfer(staker2, stakingAmount);

    let staker2StakingBalance = await stakingToken.balanceOf(staker2);
    expect(staker2StakingBalance).eq(stakingAmount);

    liquidityReserveBalance = await liquidityReserve.balanceOf(staker2);
    expect(liquidityReserveBalance).eq(0);

    const staker2Signer = accounts.find(
      (account) => account.address === staker2
    );
    const liquidityReserveStaker2 = liquidityReserve.connect(
      staker2Signer as Signer
    );
    const stakingTokenStaker2 = stakingToken.connect(staker2Signer as Signer);

    await stakingTokenStaker2.approve(liquidityReserve.address, stakingAmount);
    await liquidityReserveStaker2.deposit(stakingAmount);

    staker2StakingBalance = await stakingToken.balanceOf(staker2);
    console.log("staker2StakingBalance", staker2StakingBalance)
    expect(staker2StakingBalance).eq(0);

    liquidityReserveBalance = await liquidityReserve.balanceOf(staker2);
    console.log('liquidityReserveBalance', liquidityReserveBalance)
    // TODO: add updated staking amount
    // expect(liquidityReserveBalance).eq(stakingAmount);
  });
});
