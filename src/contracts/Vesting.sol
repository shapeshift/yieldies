// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Vesting {
    address public immutable STAKING_TOKEN;
    address public immutable REWARD_TOKEN;

    constructor(address _stakingToken, address _rewardToken) {
        require(_stakingToken != address(0) && _rewardToken != address(0));
        STAKING_TOKEN = _stakingToken;
        REWARD_TOKEN = _rewardToken;
    }

    function retrieve(address _staker, uint256 _amount) external {
        require(msg.sender == STAKING_TOKEN);
        IERC20(REWARD_TOKEN).transfer(_staker, _amount);
    }
}
