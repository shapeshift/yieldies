// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

interface ILiquidityReserve {
    function initialize(address stakingContract) external;

    function instantUnstake(uint256 amount_) external;
}
