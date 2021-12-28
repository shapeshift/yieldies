import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { admin } = await getNamedAccounts();

  const sFox = await deployments.get("sFox");
  const fox = await deployments.get("Fox"); // mock fox token

  const epochLength = 100; 
  const firstEpochNumber = 1;
  const firstEpochBlock = 1;

  await deploy("FoxStaking", {
    from: admin,
    args: [fox.address, sFox.address, epochLength, firstEpochNumber, firstEpochBlock ],
    log: true,
  });
};
export default func;
func.tags = ["FoxStaking"];
func.dependencies = ["sFox", "Fox"];
