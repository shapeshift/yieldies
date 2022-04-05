// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

struct Epoch {
    uint256 length; // length of epoch
    uint256 number; // epoch number (starting 1)
    uint256 endBlock; // block that current epoch ends on
    uint256 distribute; // amount of rewards to distribute this epoch
}