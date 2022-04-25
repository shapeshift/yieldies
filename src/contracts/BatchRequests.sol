// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

import "../interfaces/IStaking.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract BatchRequests is Ownable {
    address[] public contracts;
    mapping(address => bool) public warmUpInfo;

    function sendWithdrawalRequests() external {
        for (uint256 i = 0; i < contracts.length; i++) {
            if (IStaking(contracts[i]).canBatchTransactions())
                IStaking(contracts[i]).sendWithdrawalRequests();
        }
    }

    function addAddress(address _address) external {
        contracts.push(_address);
    }

    function removeAddress(address _address) external {
        for (uint256 i = 0; i < contracts.length; i++) {
            if (contracts[i] == _address) delete contracts[i];
        }
    }
}
