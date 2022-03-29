import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import "@nomiclabs/hardhat-ethers";
import "hardhat-deploy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy } = deployments;

  const { admin } = await getNamedAccounts();
  const stakingToken = await deployments.get("Fox");
  const tokeToken = "0x2e9d63788249371f1dfc918a52f8d799f4a38c94";
  const tokePool = "0xE0Cf0014f5B6E352De912205372572B8bbF1FfeC";
  const tokeManager = "0x7650A01F66228cAE970Ff42C2FE940a5fCED2bDa";
  const tokeReward = "0x4cd38C945846286b8023122ee491e0a96396312c";
  const tokeRewardHash = "0x5ec3EC6A8aC774c7d53665ebc5DDf89145d02fB6";

  const foxy = await deployments.get("Fox");
  const liquidityReserve = await deployments.get("LiquidityReserve");

  const epochLength = 100;
  const firstEpochNumber = 1;
  const currentBlock = await ethers.provider.getBlockNumber();
  const firstEpochBlock = currentBlock + epochLength;

  await deploy("Staking", {
    from: admin,
    args: [
      stakingToken.address,
      foxy.address,
      tokeToken,
      tokePool,
      tokeManager,
      tokeReward,
      tokeRewardHash,
      liquidityReserve.address,
      epochLength,
      firstEpochNumber,
      firstEpochBlock,
    ],
    log: true,
  });
};
export default func;
func.tags = ["TestStaking"];
func.dependencies = ["Foxy", "LiquidityReserve", "Fox"];
