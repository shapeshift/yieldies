import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import "@nomiclabs/hardhat-ethers";
import "hardhat-deploy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy } = deployments;

  const { admin } = await getNamedAccounts();
  const stakingToken = "0xc770EEfAd204B5180dF6a14Ee197D99d808ee52d";
  const tokeToken = "0x2e9d63788249371f1dfc918a52f8d799f4a38c94";
  const tokePool = "0x808D3E6b23516967ceAE4f17a5F9038383ED5311";
  const tokeManager = "0xa86e412109f77c45a3bc1c5870b880492fb86a14";
  const tokeReward = "0x79dD22579112d8a5F7347c5ED7E609e60da713C5";
  const tokeRewardHash = "0x5ec3EC6A8aC774c7d53665ebc5DDf89145d02fB6";

  const foxy = await deployments.get("Foxy");

  const epochLength = 100;
  const firstEpochNumber = 1;
  const currentBlock = await ethers.provider.getBlockNumber();
  const firstEpochBlock = currentBlock + epochLength;

  await deploy("Staking", {
    from: admin,
    args: [
      stakingToken,
      foxy.address,
      tokeToken,
      tokePool,
      tokeManager,
      tokeReward,
      tokeRewardHash,
      epochLength,
      firstEpochNumber,
      firstEpochBlock,
    ],
    log: true,
  });
};
export default func;
func.tags = ["Staking"];
func.dependencies = ["Foxy"];
