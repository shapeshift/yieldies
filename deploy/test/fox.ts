import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { BigNumber } from "ethers";

import ERC20PresetFixedSupply from "@openzeppelin/contracts/build/contracts/ERC20PresetFixedSupply.json";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { admin } = await getNamedAccounts();
  const initialSupply = BigNumber.from("1000000000")
  await deploy('Fox', {
    from: admin,
    contract: ERC20PresetFixedSupply,
    args: ['Fake-FOX', 'FOX', initialSupply, admin],
    log: true,
  });
};
export default func;
func.tags = ["Fox"];
