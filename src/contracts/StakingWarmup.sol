// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.11;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract StakingWarmup {
    address public immutable staking;
    address public immutable sFOX;

    constructor(address _staking, address _sFOX) {
        require(_staking != address(0));
        staking = _staking;
        require(_sFOX != address(0));
        sFOX = _sFOX;
    }

    function retrieve(address _staker, uint256 _amount) external {
        require(msg.sender == staking);
        IERC20(sFOX).transfer(_staker, _amount);
    }
}
