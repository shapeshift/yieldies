// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.11;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract StakingCooldown {
    address public immutable staking;
    address public immutable FOX;

    constructor(address _staking, address _FOX) {
        require(_staking != address(0));
        staking = _staking;
        require(_FOX != address(0));
        FOX = _FOX;
    }

    function retrieve(address _staker, uint256 _amount) external {
        require(msg.sender == staking);
        IERC20(FOX).transfer(_staker, _amount);
    }
}
