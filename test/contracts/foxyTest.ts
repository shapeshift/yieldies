import { ethers, deployments, getNamedAccounts } from "hardhat";
import { expect } from "chai";
import { Foxy } from "../../typechain-types/Foxy";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Signer } from "ethers";

describe("Foxy", function () {
  let accounts: SignerWithAddress[];
  let foxyDeployment;
  let foxy: Foxy;

  beforeEach(async () => {
    await deployments.fixture(["Foxy"]);
    accounts = await ethers.getSigners();
    foxyDeployment = await deployments.get("Foxy");
    foxy = new ethers.Contract(
      foxyDeployment.address,
      foxyDeployment.abi,
      accounts[0]
    ) as Foxy;
    // initialize FOXy using a contract we control fully in place of the staking
    // contract allows for more localize testing
    const { stakingContractMock } = await getNamedAccounts();
    await foxy.initialize(stakingContractMock);
  });

  describe("initialize", function () {
    it("Should assign the total supply of tokens to the stakingContract", async () => {
      const { stakingContractMock } = await getNamedAccounts();
      const supply = await foxy.totalSupply();
      const stakingContractBalance = await foxy.balanceOf(stakingContractMock);
      expect(stakingContractBalance).eq(supply);
    });
    it("Fails if no stakingContract is passed to initialize", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();

      const foxyFactory = await ethers.getContractFactory("Foxy");
      const foxyContract = await foxyFactory.deploy();

      // fails due to no staking/reward token
      await expect(
        foxyContract.initialize("0x0000000000000000000000000000000000000000")
      ).to.be.reverted;

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );

      const staker1Foxy = foxyContract.connect(staker1Signer as Signer);

      // fails due to initializer isn't calling initialize
      await expect(staker1Foxy.initialize(stakingContractMock)).to.be.reverted;
    });
  });

  describe("rebase", function () {
    it("Should distribute profits with one token holder", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const stakingContractSigner = accounts.find(
        (account) => account.address === stakingContractMock
      );

      const initialHoldings = BigNumber.from("1000000");
      const foxyStakingContractSigner = foxy.connect(
        stakingContractSigner as Signer
      );

      await foxyStakingContractSigner.transfer(staker1, initialHoldings);
      const staker1InitialBalance = await foxy.balanceOf(staker1);
      expect(staker1InitialBalance).eq(initialHoldings);

      const profit = BigNumber.from("1000");
      await foxyStakingContractSigner.rebase(profit, BigNumber.from(1));

      const staker1BalanceAfterRebase = await foxy.balanceOf(staker1);
      expect(staker1BalanceAfterRebase).eq(initialHoldings.add(profit));
    });
    it("Should distribute profits with two token holders", async () => {
      const { staker1, staker2, stakingContractMock } =
        await getNamedAccounts();
      const stakingContractSigner = accounts.find(
        (account) => account.address === stakingContractMock
      );

      const initialHoldings = BigNumber.from("1000000");
      const foxyStakingContractSigner = foxy.connect(
        stakingContractSigner as Signer
      );

      await foxyStakingContractSigner.transfer(staker1, initialHoldings);
      await foxyStakingContractSigner.transfer(staker2, initialHoldings);

      const staker1InitialBalance = await foxy.balanceOf(staker1);
      const staker2InitialBalance = await foxy.balanceOf(staker2);

      expect(staker1InitialBalance).eq(initialHoldings);
      expect(staker2InitialBalance).eq(initialHoldings);

      const profit = BigNumber.from("1000");
      await foxyStakingContractSigner.rebase(profit, BigNumber.from(1));

      const staker1BalanceAfterRebase = await foxy.balanceOf(staker1);
      const staker2BalanceAfterRebase = await foxy.balanceOf(staker2);

      expect(staker1BalanceAfterRebase).eq(initialHoldings.add(profit.div(2)));
      expect(staker2BalanceAfterRebase).eq(initialHoldings.add(profit.div(2)));
    });
    it("Only can call rebase from staking contract", async () => {
      const { staker1 } = await getNamedAccounts();
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );

      const staker1ContractSigner = foxy.connect(staker1Signer as Signer);

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

      const foxyStakingContractSigner = foxy.connect(
        stakingContractSigner as Signer
      );

      const profit = BigNumber.from("1000");
      // no circulating supply can't be rebased
      await expect(foxyStakingContractSigner.rebase(profit, BigNumber.from(1)))
        .to.be.reverted;
    });
    it("If profit = 0 then no additonal funds should be received", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const stakingContractSigner = accounts.find(
        (account) => account.address === stakingContractMock
      );

      const initialHoldings = BigNumber.from("1000000");
      const foxyStakingContractSigner = foxy.connect(
        stakingContractSigner as Signer
      );

      await foxyStakingContractSigner.transfer(staker1, initialHoldings);
      const staker1InitialBalance = await foxy.balanceOf(staker1);
      expect(staker1InitialBalance).eq(initialHoldings);

      const profit = BigNumber.from("0");
      await foxyStakingContractSigner.rebase(profit, BigNumber.from(1));

      const staker1BalanceAfterRebase = await foxy.balanceOf(staker1);
      expect(staker1BalanceAfterRebase).eq(initialHoldings);
    });
  });
  describe("approve", () => {
    it("Sets the allowed value between sender and spender", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );

      await foxy
        .connect(staker1Signer as Signer)
        .approve(stakingContractMock, 10);
      expect(await foxy.allowance(staker1, stakingContractMock)).to.equal(10);
    });
    it("Emits an Approval event", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );

      await expect(
        await foxy
          .connect(staker1Signer as Signer)
          .approve(stakingContractMock, 10)
      )
        .to.emit(foxy, "Approval")
        .withArgs(staker1, stakingContractMock, 10);
    });
  });
  describe("increaseAllowance", () => {
    it("Increases the allowance between sender and spender", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      ) as Signer;

      await foxy.connect(staker1Signer).approve(stakingContractMock, 10);
      await foxy
        .connect(staker1Signer)
        .increaseAllowance(stakingContractMock, 4);

      expect(await foxy.allowance(staker1, stakingContractMock)).to.equal(14);
    });
    it("Emits an Approval event", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      ) as Signer;

      await foxy.connect(staker1Signer).approve(stakingContractMock, 10);
      await expect(
        await foxy
          .connect(staker1Signer)
          .increaseAllowance(stakingContractMock, 4)
      )
        .to.emit(foxy, "Approval")
        .withArgs(staker1, stakingContractMock, 14);
    });
  });
  describe("decreaseAllowance", () => {
    it("Decreases the allowance between sender and spender", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      ) as Signer;

      await foxy.connect(staker1Signer).approve(stakingContractMock, 10);
      await foxy
        .connect(staker1Signer)
        .decreaseAllowance(stakingContractMock, 4);

      expect(await foxy.allowance(staker1, stakingContractMock)).to.equal(6);
    });
    it("Will not make the value negative", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      ) as Signer;

      await foxy.connect(staker1Signer).approve(stakingContractMock, 10);
      await expect(
        foxy.connect(staker1Signer).decreaseAllowance(stakingContractMock, 11)
      ).to.be.revertedWith("Not enough allowance");
    });
    it("Emits an Approval event", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      ) as Signer;

      await foxy.connect(staker1Signer).approve(stakingContractMock, 10);
      await expect(
        await foxy
          .connect(staker1Signer)
          .decreaseAllowance(stakingContractMock, 4)
      )
        .to.emit(foxy, "Approval")
        .withArgs(staker1, stakingContractMock, 6);
    });
  });
});
