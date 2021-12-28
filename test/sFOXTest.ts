import { ethers, deployments, getNamedAccounts } from "hardhat";
import { expect } from "chai";
import { SFOX } from "../typechain-types/SFOX";

describe("sFOX", function () {

  let accounts;
  let sFOXDeployment;
  let sFOX : SFOX;

  beforeEach(async function () {
    await deployments.fixture(["sFOX"]);
      accounts = await ethers.getSigners();
      sFOXDeployment = await deployments.get("sFOX");
      sFOX = new ethers.Contract(
        sFOXDeployment.address,
        sFOXDeployment.abi,
        accounts[0]
      ) as SFOX;
  })

  describe("initialize", function () {
    it("Should assign the total supply of tokens to the stakingContract", async function () {
      const { stakingContract } = await getNamedAccounts();
      let stakingContractBalance = await sFOX.balanceOf(stakingContract);
      expect(stakingContractBalance.eq(0)).true;

      const supply = await sFOX.totalSupply();
      await sFOX.initialize(stakingContract);
      stakingContractBalance = await sFOX.balanceOf(stakingContract);
      expect(stakingContractBalance.eq(supply)).true;
    });
  });

  describe("rebase", function() {
    it("Should distribute profits with one token holder", async function () {

    });

  });
});
