// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

import "../structs/Claim.sol";
import "../structs/Epoch.sol";

contract StakingStorage {
    address public tokePool;
    address public tokeManager;
    address public tokeReward;
    address public stakingToken;
    address public rewardToken;
    address public tokeToken;
    address public liquidityReserve;
    address public warmUpContract;
    address public coolDownContract;
    address public affiliateAddress;

    // owner overrides
    bool public pauseStaking; // pauses staking
    bool public pauseUnstaking; // pauses unstaking & instantUnstake
    bool public pauseInstantUnstaking; // pauses instantUnstake

    Epoch public epoch;

    mapping(address => Claim) public warmUpInfo;
    mapping(address => Claim) public coolDownInfo;

    uint256 public timeLeftToRequestWithdrawal; // time (in seconds) before TOKE cycle ends to request withdrawal
    uint256 public warmUpPeriod; // amount of epochs to delay warmup vesting
    uint256 public coolDownPeriod; // amount of epochs to delay cooldown vesting
    uint256 public requestWithdrawalAmount; // amount of staking tokens to request withdrawal once able to send
    uint256 public withdrawalAmount; // amount of stakings tokens available for withdrawal
    uint256 public lastTokeCycleIndex; // last tokemak cycle index which requested withdrawals
    uint256 public affiliateFee; // fee in basis points to send rewards to affilateAddress

    uint256 public constant BASIS_POINTS = 10000; // 100% in basis points
}
