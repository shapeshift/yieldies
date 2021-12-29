import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import "@nomiclabs/hardhat-ethers";
import "hardhat-deploy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { admin } = await getNamedAccounts();
  const sFox = await deployments.get("sFox");
  const foxStaking = await deployments.get("FoxStaking"); 

  await deploy("StakingWarmup", {
    from: admin,
    args: [foxStaking.address, sFox.address ],
    log: true,
  });
};
export default func;
func.tags = ["StakingWarmup"];
func.dependencies = ["sFox", "FoxStaking"];
