import { ethers, deployments, getNamedAccounts } from "hardhat";
import { expect } from "chai";
import { Foxy } from "../../typechain-types/Foxy";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Signer } from "ethers";

describe("Ownable", function () {
  let accounts: SignerWithAddress[];
  let foxyDeployment;
  let foxy: Foxy;

  beforeEach(async () => {});

  it("is true", () => {
    expect(true).eq(true);
  });
});
