import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { admin } = await getNamedAccounts();
  const stakingToken = "0xc770EEfAd204B5180dF6a14Ee197D99d808ee52d";

  await deploy("LiquidityReserve", {
    from: admin,
    args: [stakingToken],
    log: true,
  });
};
export default func;
func.tags = ["LiquidityReserve"];
