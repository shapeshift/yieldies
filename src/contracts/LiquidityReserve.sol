// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

import "../libraries/ERC20.sol";
import "../libraries/Ownable.sol";

contract LiquidityReserve is ERC20, Ownable {
    modifier onlyStakingContract() {
        require(msg.sender == stakingContract);
        _;
    }

    address public stakingContract;
    address public initializer;

    constructor() ERC20("Liquidity Reserve FOX", "lrFOX", 18) {
        initializer = msg.sender;
    }

    function initialize(address stakingContract_) external returns (bool) {
        require(msg.sender == initializer);
        require(stakingContract_ != address(0));
        stakingContract = stakingContract_;
        initializer = address(0);
        return true;
    }

    function deposit(uint256 _amount) external {}

    function withdraw(uint256 _amount) external {}

    function instantUnstake(uint256 _amount) external {}
}
