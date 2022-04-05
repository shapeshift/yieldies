// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

import "../structs/Rebase.sol";

contract YieldyStorage {
    address public stakingContract;
    Rebase[] public rebases;
    uint256 public index;
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN");

    uint256 internal constant WAD = 1e18;
    uint256 internal constant MAX_UINT256 = ~uint256(0);
    uint256 internal constant INITIAL_FRAGMENTS_SUPPLY = 500000000 * WAD;

    // TOTAL_GONS is a multiple of INITIAL_FRAGMENTS_SUPPLY so that gonsPerFragment is an integer.
    // Use the highest value that fits in a uint256 for max granularity.
    uint256 internal constant TOTAL_GONS =
        MAX_UINT256 - (MAX_UINT256 % INITIAL_FRAGMENTS_SUPPLY);

    // MAX_SUPPLY = maximum integer < (sqrt(4*TOTAL_GONS + 1) - 1) / 2
    uint256 internal constant MAX_SUPPLY = ~uint128(0); // (2^128) - 1
    uint256 internal gonsPerFragment;

    mapping(address => uint256) internal gonBalances;
    mapping(address => mapping(address => uint256)) internal allowedValue;
}
