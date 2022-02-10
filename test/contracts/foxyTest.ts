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
      expect(stakingContractBalance.eq(supply)).true;
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
      expect(staker1InitialBalance.eq(initialHoldings)).true;

      const profit = BigNumber.from("1000");
      await foxyStakingContractSigner.rebase(profit, BigNumber.from(1));

      const staker1BalanceAfterRebase = await foxy.balanceOf(staker1);
      expect(staker1BalanceAfterRebase.eq(initialHoldings.add(profit))).true;
    });

    it("Should distribute profits with two token holders", async () => {
      const { staker1, staker2, stakingContractMock } = await getNamedAccounts();
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

      expect(staker1InitialBalance.eq(initialHoldings)).true;
      expect(staker2InitialBalance.eq(initialHoldings)).true;

      const profit = BigNumber.from("1000");
      await foxyStakingContractSigner.rebase(profit, BigNumber.from(1));

      const staker1BalanceAfterRebase = await foxy.balanceOf(staker1);
      const staker2BalanceAfterRebase = await foxy.balanceOf(staker2);

      expect(staker1BalanceAfterRebase.eq(initialHoldings.add(profit.div(2))))
        .true;
      expect(staker2BalanceAfterRebase.eq(initialHoldings.add(profit.div(2))))
        .true;
    });
  });
});
