// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

interface ILiquidityReserve {
    function instantUnstake(uint256 amount_) external;

    function setFee(uint256 _fee) external;
}
