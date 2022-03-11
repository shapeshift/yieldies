// this script is used to initialize the contracts on the local node
// as well as transfer stakingTokens to account[0]
// will automatically be called by the cli

import { tokeManagerAbi } from "../src/abis/tokeManagerAbi";
import { tokePoolAbi } from "../src/abis/tokePoolAbi";

const hre = require("hardhat");

async function initialize() {
  const { deployments, ethers, network } = hre;
  let accounts = await ethers.getSigners();

  const TOKE_ADDRESS = "0x808D3E6b23516967ceAE4f17a5F9038383ED5311"; // tFOX Address
  const STAKING_TOKEN = "0xc770EEfAd204B5180dF6a14Ee197D99d808ee52d";
  const STAKING_TOKEN_WHALE = "0xF152a54068c8eDDF5D537770985cA8c06ad78aBB";

  const tokePool = new ethers.Contract(TOKE_ADDRESS, tokePoolAbi, accounts[0]);
  const tokeManagerAddress = await tokePool.manager();

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

  await liquidityReserve.initialize(staking.address, foxy.address);
  await liquidityReserve.setFee(2000);
  await staking.setCoolDownPeriod(2);

  await stakingTokenWhale.transfer(accounts[0].address, "1000000000000000000"); // transfer more to account[0]

  const tokeManager = new ethers.Contract(
    tokeManagerAddress,
    tokeManagerAbi,
    accounts[0]
  );

  // mine to next cycle
  let currentBlock = await ethers.provider.getBlockNumber();
  let cycleDuration = await tokeManager.getCycleDuration();
  let cycleStart = await tokeManager.getCurrentCycle();
  let blocksTilNextCycle =
    cycleStart.toNumber() + cycleDuration.toNumber() - currentBlock;
  while (blocksTilNextCycle > 0) {
    blocksTilNextCycle--;
    await network.provider.request({
      method: "evm_mine",
      params: [],
    });
  }
}

initialize()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
