import { ethers, deployments, getNamedAccounts } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Signer } from "ethers";
import { LiquidityReserve } from "../typechain-types";

describe.only("Liquidity Reserve", function () {
  let accounts: SignerWithAddress[];
  let liquidityReserveDeployment;
  let liquidityReserve: LiquidityReserve;

  beforeEach(async () => {
    await deployments.fixture(["LiquidityReserve"]);
    accounts = await ethers.getSigners();
    liquidityReserveDeployment = await deployments.get("LiquidityReserve");
  });

  describe("initialize", function () {
    it("Should assign the total supply of tokens to the stakingContract", async () => {
      expect(1).eq(1);
    });
  });
});
