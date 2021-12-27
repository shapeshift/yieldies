import { ethers } from "hardhat";
import { expect } from "chai";

describe("sFOX", function() {
  it("Initialize should assign the total supply of tokens to the stakingContract", async function() {
    console.log("xxx");
    const accounts = await ethers.getSigners();
    // await deployments.fixture(["sFOX"]);
    // const {admin, staker1, stakingContract,} = await getNamedAccounts();
    // const sFOXDeployment = await deployments.get("sFOX");
    // const sFOX = new ethers.Contract(sFOXDeployment.address, sFOXDeployment.abi, accounts[0]);
    // const ownerBalance = await sFOX.balanceOf(stakingContract);
    // const supply = await sFOX.totalSupply();
    // expect(ownerBalance).to.equal(supply);
  });
});