// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

interface ITokeRewardHash {
    function cycleHashes(uint256 index)
        external
        view
        returns (string memory latestClaimable, string memory cycle);

    function latestCycleIndex() external view returns (uint256);
}