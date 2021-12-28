import { ethers, deployments, getNamedAccounts } from "hardhat";
import { expect } from "chai";
import { SFOX } from "../typechain-types/SFOX";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Contract, Signer } from "ethers";

describe("sFOX", function () {

  let accounts: SignerWithAddress[];
  let sFOXDeployment;
  let sFOX : SFOX;

  beforeEach(async () => {
    await deployments.fixture(["sFOX"]);
      accounts = await ethers.getSigners();
      sFOXDeployment = await deployments.get("sFOX");
      sFOX = new ethers.Contract(
        sFOXDeployment.address,
        sFOXDeployment.abi,
        accounts[0]
      ) as SFOX;
      // initialize sFOX
      const { stakingContract } = await getNamedAccounts();
      await sFOX.initialize(stakingContract);
  })

  describe("initialize", function () {
    it("Should assign the total supply of tokens to the stakingContract", async () => {
      const { stakingContract } = await getNamedAccounts();
      let stakingContractBalance = await sFOX.balanceOf(stakingContract);
      const supply = await sFOX.totalSupply();
      stakingContractBalance = await sFOX.balanceOf(stakingContract);
      expect(stakingContractBalance.eq(supply)).true;
    });
  });

  describe("rebase", function() {
    it("Should distribute profits with one token holder", async () => {
      const { staker1, stakingContract } = await getNamedAccounts();
      const stakingContractSigner = accounts.find(account => account.address === stakingContract);

      const initialHoldings = BigNumber.from("1000000");
      const sFOXStakingContractSigner = sFOX.connect(stakingContractSigner as Signer);

      await sFOXStakingContractSigner.transfer(staker1, initialHoldings);
      const staker1InitialBalance = await sFOX.balanceOf(staker1);
      expect(staker1InitialBalance.eq(initialHoldings)).true;

      const profit = BigNumber.from("1000");
      await sFOXStakingContractSigner.rebase(profit, BigNumber.from(1));

      const staker1BalanceAfterRebase = await sFOX.balanceOf(staker1);
      expect(staker1BalanceAfterRebase.eq(initialHoldings.add(profit))).true;
    });
  });
});
