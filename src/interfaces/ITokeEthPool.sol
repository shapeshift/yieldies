// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

import "./ITokePool.sol";

interface ITokeEthPool is ITokePool {
    function withdraw(uint256 amount, bool asEth) external;
}