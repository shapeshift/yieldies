import { ethers, getNamedAccounts, upgrades } from "hardhat";
import { expect } from "chai";
import { Yieldy } from "../../typechain-types/Yieldy";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, ContractFactory, Signer } from "ethers";

describe("Yieldy", function () {
  let accounts: SignerWithAddress[];
  let Yieldy: ContractFactory;
  let yieldy: Yieldy;

  beforeEach(async () => {
    // initialize Yieldy using a contract we control fully in place of the staking
    // contract allows for more localize testing
    accounts = await ethers.getSigners();
    const { stakingContractMock } = await getNamedAccounts();
    Yieldy = await ethers.getContractFactory("Yieldy");
    yieldy = (await upgrades.deployProxy(Yieldy, [
      "Fox Yieldy",
      "FOXy",
      // stakingContractMock,
    ])) as Yieldy;
    await yieldy.deployed();

    await yieldy.initializeStakingContract(stakingContractMock);
  });

  describe("initializeStakingContract", function () {
    it("Should assign the total supply of tokens to the stakingContract", async () => {
      const { stakingContractMock } = await getNamedAccounts();
      const supply = await yieldy.totalSupply();
      const stakingContractBalance = await yieldy.balanceOf(
        stakingContractMock
      );
      expect(stakingContractBalance).eq(supply);
      expect(await yieldy.stakingContract()).to.equal(stakingContractMock);
    });

    it("Fails if called from non admin", async () => {
      const yieldy1 = (await upgrades.deployProxy(Yieldy, [
        "Fox Yieldy",
        "FOXy",
      ])) as Yieldy;

      await expect(
        yieldy1
          .connect(accounts[2])
          .initializeStakingContract(accounts[2].address)
      ).to.be.revertedWith(
        `AccessControl: account ${accounts[2].address.toLowerCase()} is missing role 0xdf8b4c520ffe197c5343c6f5aec59570151ef9a492f2c624fd45ddde6135ec42`
      );
    });

    it("Fails if _stakingContract is zero address", async () => {
      // fails due to no staking/reward token
      const yieldy1 = (await upgrades.deployProxy(Yieldy, [
        "Fox Yieldy",
        "FOXy",
      ])) as Yieldy;
      await expect(
        yieldy1.initializeStakingContract(ethers.constants.AddressZero)
      ).to.be.revertedWith("Invalid address");
    });

    it("Fails if called twice", async () => {
      // fails due to no staking/reward token
      const yieldy1 = (await upgrades.deployProxy(Yieldy, [
        "Fox Yieldy",
        "FOXy",
      ])) as Yieldy;
      await yieldy1.initializeStakingContract(accounts[1].address);
      await expect(
        yieldy1.initializeStakingContract(accounts[1].address)
      ).to.be.revertedWith("Already Initialized");
    });
  });

  describe("rebase", function () {
    it("Should distribute profits with one token holder", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const stakingContractSigner = accounts.find(
        (account) => account.address === stakingContractMock
      );

      const initialHoldings = BigNumber.from("1000000");
      const yieldyStakingContractSigner = yieldy.connect(
        stakingContractSigner as Signer
      );

      await yieldyStakingContractSigner.transfer(staker1, initialHoldings);
      const staker1InitialBalance = await yieldy.balanceOf(staker1);
      expect(staker1InitialBalance).eq(initialHoldings);

      const profit = BigNumber.from("1000");
      await yieldyStakingContractSigner.rebase(profit, BigNumber.from(1));

      const staker1BalanceAfterRebase = await yieldy.balanceOf(staker1);
      expect(staker1BalanceAfterRebase).eq(initialHoldings.add(profit));
    });
    it("Should distribute profits with two token holders", async () => {
      const { staker1, staker2, stakingContractMock } =
        await getNamedAccounts();
      const stakingContractSigner = accounts.find(
        (account) => account.address === stakingContractMock
      );

      const initialHoldings = BigNumber.from("1000000");
      const yieldyStakingContractSigner = yieldy.connect(
        stakingContractSigner as Signer
      );

      await yieldyStakingContractSigner.transfer(staker1, initialHoldings);
      await yieldyStakingContractSigner.transfer(staker2, initialHoldings);

      const staker1InitialBalance = await yieldy.balanceOf(staker1);
      const staker2InitialBalance = await yieldy.balanceOf(staker2);

      expect(staker1InitialBalance).eq(initialHoldings);
      expect(staker2InitialBalance).eq(initialHoldings);

      const profit = BigNumber.from("1000");
      await yieldyStakingContractSigner.rebase(profit, BigNumber.from(1));

      const staker1BalanceAfterRebase = await yieldy.balanceOf(staker1);
      const staker2BalanceAfterRebase = await yieldy.balanceOf(staker2);

      expect(staker1BalanceAfterRebase).eq(initialHoldings.add(profit.div(2)));
      expect(staker2BalanceAfterRebase).eq(initialHoldings.add(profit.div(2)));
    });
    it("Only can call rebase from staking contract", async () => {
      const { staker1 } = await getNamedAccounts();
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );

      const staker1ContractSigner = yieldy.connect(staker1Signer as Signer);

      const profit = BigNumber.from("1000");
      // no circulating supply can't be rebased
      await expect(staker1ContractSigner.rebase(profit, BigNumber.from(1))).to
        .be.reverted;
    });
    it("Rebase with no circulating supply", async () => {
      const { stakingContractMock } = await getNamedAccounts();
      const stakingContractSigner = accounts.find(
        (account) => account.address === stakingContractMock
      );

      const yieldyStakingContractSigner = yieldy.connect(
        stakingContractSigner as Signer
      );

      const profit = BigNumber.from("1000");
      // no circulating supply can't be rebased
      await expect(
        yieldyStakingContractSigner.rebase(profit, BigNumber.from(1))
      ).to.be.reverted;
    });
    it("If profit = 0 then no additonal funds should be received", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const stakingContractSigner = accounts.find(
        (account) => account.address === stakingContractMock
      );

      const initialHoldings = BigNumber.from("1000000");
      const yieldyStakingContractSigner = yieldy.connect(
        stakingContractSigner as Signer
      );

      await yieldyStakingContractSigner.transfer(staker1, initialHoldings);
      const staker1InitialBalance = await yieldy.balanceOf(staker1);
      expect(staker1InitialBalance).eq(initialHoldings);

      const profit = BigNumber.from("0");
      await yieldyStakingContractSigner.rebase(profit, BigNumber.from(1));

      const staker1BalanceAfterRebase = await yieldy.balanceOf(staker1);
      expect(staker1BalanceAfterRebase).eq(initialHoldings);
    });
  });
  describe("approve", () => {
    it("Sets the allowed value between sender and spender", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );

      await yieldy
        .connect(staker1Signer as Signer)
        .approve(stakingContractMock, 10);
      expect(await yieldy.allowance(staker1, stakingContractMock)).to.equal(10);
    });
    it("Emits an Approval event", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );

      await expect(
        await yieldy
          .connect(staker1Signer as Signer)
          .approve(stakingContractMock, 10)
      )
        .to.emit(yieldy, "Approval")
        .withArgs(staker1, stakingContractMock, 10);
    });
  });
  describe("increaseAllowance", () => {
    it("Increases the allowance between sender and spender", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      ) as Signer;

      await yieldy.connect(staker1Signer).approve(stakingContractMock, 10);
      await yieldy
        .connect(staker1Signer)
        .increaseAllowance(stakingContractMock, 4);

      expect(await yieldy.allowance(staker1, stakingContractMock)).to.equal(14);
    });
    it("Emits an Approval event", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      ) as Signer;

      await yieldy.connect(staker1Signer).approve(stakingContractMock, 10);
      await expect(
        await yieldy
          .connect(staker1Signer)
          .increaseAllowance(stakingContractMock, 4)
      )
        .to.emit(yieldy, "Approval")
        .withArgs(staker1, stakingContractMock, 14);
    });
  });
  describe("decreaseAllowance", () => {
    it("Decreases the allowance between sender and spender", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      ) as Signer;

      await yieldy.connect(staker1Signer).approve(stakingContractMock, 10);
      await yieldy
        .connect(staker1Signer)
        .decreaseAllowance(stakingContractMock, 4);

      expect(await yieldy.allowance(staker1, stakingContractMock)).to.equal(6);
    });
    it("Will not make the value negative", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      ) as Signer;

      await yieldy.connect(staker1Signer).approve(stakingContractMock, 10);
      await expect(
        yieldy.connect(staker1Signer).decreaseAllowance(stakingContractMock, 11)
      ).to.be.revertedWith("Not enough allowance");
    });
    it("Emits an Approval event", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      ) as Signer;

      await yieldy.connect(staker1Signer).approve(stakingContractMock, 10);
      await expect(
        await yieldy
          .connect(staker1Signer)
          .decreaseAllowance(stakingContractMock, 4)
      )
        .to.emit(yieldy, "Approval")
        .withArgs(staker1, stakingContractMock, 6);
    });
  });
});
