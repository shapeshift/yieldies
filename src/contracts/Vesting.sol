// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.11;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Vesting {
    address public immutable staking;
    address public immutable rewardToken;

    constructor(address _staking, address _rewardToken) {
        require(_staking != address(0));
        staking = _staking;
        require(_rewardToken != address(0));
        rewardToken = _rewardToken;
    }

    function retrieve(address _staker, uint256 _amount) external {
        require(msg.sender == staking);
        IERC20(rewardToken).transfer(_staker, _amount);
    }
}
