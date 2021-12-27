// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";


contract StakingFox is ERC20, ReentrancyGuard {

  address public immutable rewardToken;

  constructor(
    address _rewardToken
  ) ERC20("Staked FOX", "sFOX") {
    rewardToken = _rewardToken;
  }

  function deposit(uint256 _amount) external nonReentrant() {

  }


  function requestWithdraw(uint256 _amount) external nonReentrant() {

  }

  function withdraw(uint256 _amount) external nonReentrant() {

  }


  function withdrawWithPenalty(uint256 _amount) external nonReentrant() {

  }

  function rewardStakers(uint256 _amount) external nonReentrant() {

  }

}