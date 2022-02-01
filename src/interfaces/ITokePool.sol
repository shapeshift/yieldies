// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

interface ITokePool {
    function deposit(uint256 amount) external;

    function withdraw(uint256 amount) external;

    function requestWithdrawal(uint256 amount) external;

    function balanceOf(address owner) external view returns (uint256);
}