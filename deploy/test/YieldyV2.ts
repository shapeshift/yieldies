import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { BigNumber } from "ethers";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { admin } = await getNamedAccounts();
  await deploy("YieldyV2", {
    from: admin,
    // args: [],
    log: true,
    maxFeePerGas: BigNumber.from("78114762067"),
    maxPriorityFeePerGas: BigNumber.from("3000000000"),
  });
};
export default func;
func.tags = ["YieldyV2"];
