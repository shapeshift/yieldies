// this script is used to initialize the contracts on the local node
// as well as transfer stakingTokens to account[0]

import { tokeManagerAbi } from "../src/abis/tokeManagerAbi";
import { tokePoolAbi } from "../src/abis/tokePoolAbi";

import hre from "hardhat";

async function initialize() {
  const { deployments, ethers, network } = hre;
  const accounts = await ethers.getSigners();

  const TOKE_ADDRESS = "0x808D3E6b23516967ceAE4f17a5F9038383ED5311"; // tFOX Address
  const STAKING_TOKEN = "0xc770EEfAd204B5180dF6a14Ee197D99d808ee52d";
  const STAKING_TOKEN_WHALE = "0xF152a54068c8eDDF5D537770985cA8c06ad78aBB";

  const tokePool = new ethers.Contract(TOKE_ADDRESS, tokePoolAbi, accounts[0]);
  const tokeManagerAddress = await tokePool.manager();

  const stakingDeployments = await deployments.get("Staking");
  const staking = new ethers.Contract(
    stakingDeployments.address,
    stakingDeployments.abi,
    accounts[0]
  );

  const foxyDeployments = await deployments.get("Foxy");
  const foxy = new ethers.Contract(
    foxyDeployments.address,
    foxyDeployments.abi,
    accounts[0]
  );
  await foxy.initialize(staking.address);

  const liquidityReserveDeployments = await deployments.get("LiquidityReserve");
  const liquidityReserve = new ethers.Contract(
    liquidityReserveDeployments.address,
    liquidityReserveDeployments.abi,
    accounts[0]
  );

  const stakingToken = new ethers.Contract(
    STAKING_TOKEN,
    foxyDeployments.abi,
    accounts[0]
  );

  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [STAKING_TOKEN_WHALE],
  });

  const whaleSigner = await ethers.getSigner(STAKING_TOKEN_WHALE);
  const stakingTokenWhale = stakingToken.connect(whaleSigner);
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
  const currentBlock = await ethers.provider.getBlockNumber();
  const cycleDuration = await tokeManager.getCycleDuration();
  const cycleStart = await tokeManager.getCurrentCycle();
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
    throw new Error(error);
  });
