// this script is used to initialize the contracts on the local node
// as well as transfer stakingTokens to account[0]
// will automatically be called by the cli

const hre = require("hardhat");
const ethers = hre.ethers;

const STAKING_TOKEN = "0xc770EEfAd204B5180dF6a14Ee197D99d808ee52d";
const STAKING_TOKEN_WHALE = "0xF152a54068c8eDDF5D537770985cA8c06ad78aBB";

async function main() {
  const { deployments, ethers, network } = hre;
  await hre.run("compile");

  let accounts = await ethers.getSigners();
  let stakingDeployments = await deployments.get("Staking");
  let staking = new ethers.Contract(
    stakingDeployments.address,
    stakingDeployments.abi,
    accounts[0]
  );

  let foxyDeployments = await deployments.get("Foxy");
  let foxy = new ethers.Contract(
    foxyDeployments.address,
    foxyDeployments.abi,
    accounts[0]
  );
  await foxy.initialize(staking.address);

  let liquidityReserveDeployments = await deployments.get("LiquidityReserve");
  let liquidityReserve = new ethers.Contract(
    liquidityReserveDeployments.address,
    liquidityReserveDeployments.abi,
    accounts[0]
  );

  let stakingToken = new ethers.Contract(
    STAKING_TOKEN,
    foxyDeployments.abi,
    accounts[0]
  );

  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [STAKING_TOKEN_WHALE],
  });

  let whaleSigner = await ethers.getSigner(STAKING_TOKEN_WHALE);
  let stakingTokenWhale = stakingToken.connect(whaleSigner);
  await stakingTokenWhale.transfer(accounts[0].address, "1000000000000000000");

  await stakingToken.approve(
    liquidityReserve.address,
    ethers.constants.MaxUint256
  );

  // approve LR stakingToken
  await liquidityReserve.initialize(staking.address, foxy.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
