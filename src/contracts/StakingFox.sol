// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

contract StakingFox {

  address public immutable rewardToken;

  constructor(
    address _rewardToken
  ) {
    rewardToken = _rewardToken;
  }

}