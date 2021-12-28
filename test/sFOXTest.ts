import { ethers, deployments, getNamedAccounts } from "hardhat";
import { expect } from "chai";

describe("sFOX", function () {
  describe("initialize", function () {
    it("Should assign the total supply of tokens to the stakingContract", async function () {
      const accounts = await ethers.getSigners();
      await deployments.fixture(["sFOX"]);
      const { stakingContract } = await getNamedAccounts();
      const sFOXDeployment = await deployments.get("sFOX");
      const sFOX = new ethers.Contract(
        sFOXDeployment.address,
        sFOXDeployment.abi,
        accounts[0]
      );
      let stakingContractBalance = await sFOX.balanceOf(stakingContract);
      expect(stakingContractBalance.eq(0)).true;

      const supply = await sFOX.totalSupply();
      await sFOX.initialize(stakingContract);
      stakingContractBalance = await sFOX.balanceOf(stakingContract);
      expect(stakingContractBalance.eq(supply)).true;
    });
  });
});
