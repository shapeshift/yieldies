import { ethers, deployments, getNamedAccounts } from "hardhat";
import { expect } from "chai";
import { Foxy } from "../typechain-types/Foxy";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Signer } from "ethers";

describe("Foxy", function () {
  let accounts: SignerWithAddress[];
  let foxyDeployment;
  let foxy: Foxy;

  beforeEach(async () => {});

  describe("initialize", function () {
    it("Should assign the total supply of tokens to the stakingContract", async () => {});
  });

  describe("rebase", function () {
    it("Should distribute profits with one token holder", async () => {});
  });
});
