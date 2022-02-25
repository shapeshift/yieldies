// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

interface IOwnable {
    function getOwner() external view returns (address);

    function renounceOwner() external;

    function pushOwner(address _newOwner) external;

    function pullOwner() external;
}
