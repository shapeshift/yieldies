import { upgrades, ethers } from "hardhat";

async function main() {
  const stakingToken = "0xc770EEfAd204B5180dF6a14Ee197D99d808ee52d";
  const tokeToken = "0x2e9d63788249371f1dfc918a52f8d799f4a38c94";
  const tokePool = "0x808D3E6b23516967ceAE4f17a5F9038383ED5311";
  const tokeManager = "0xa86e412109f77c45a3bc1c5870b880492fb86a14";
  const tokeReward = "0x79dD22579112d8a5F7347c5ED7E609e60da713C5";

  const epochLength = 44800;
  const timeLeftToRequestWithdrawal = 43200;
  const firstEpochNumber = 1;
  const currentBlock = await ethers.provider.getBlockNumber();
  const firstEpochBlock = currentBlock + epochLength;

  const Staking = await ethers.getContractFactory("Staking");
  const yieldyDeployment = await ethers.getContractFactory("Yieldy");
  const liquidityReserveDeployment = await ethers.getContractFactory(
    "LiquidityReserve"
  );

  console.log("Deploying Yieldy...");
  const yieldy = await upgrades.deployProxy(yieldyDeployment, [
    "Fox Yieldy",
    "FOXy",
  ]);
  await yieldy.deployed();
  console.log("Yieldy deployed to:", yieldy.address);

  console.log("Deploying Liquidity Reserve...");
  const liquidityReserve = await upgrades.deployProxy(
    liquidityReserveDeployment,
    ["Liquidity Reserve FOX", "lrFOX", stakingToken, yieldy.address]
  );
  await liquidityReserve.deployed();
  console.log("Liquidity Reserve deployed to:", liquidityReserve.address);

  console.log("Deploying Staking...");
  const staking = await upgrades.deployProxy(Staking, [
    stakingToken,
    yieldy.address,
    tokeToken,
    tokePool,
    tokeManager,
    tokeReward,
    liquidityReserve.address,
    epochLength,
    firstEpochNumber,
    firstEpochBlock,
    timeLeftToRequestWithdrawal,
  ]);
  console.log("Staking deployed to:", staking.address);
  await staking.deployed();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
