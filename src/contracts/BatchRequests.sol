// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

import "../interfaces/IStaking.sol";
import "../structs/Batch.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract BatchRequests is Ownable {
    address[] public contracts;

    function sendWithdrawalRequests() external {
        for (uint256 i = 0; i < contracts.length; i++) {
            if (
                contracts[i] != address(0) &&
                IStaking(contracts[i]).canBatchTransactions()
            ) {
                IStaking(contracts[i]).sendWithdrawalRequests();
            }
        }
    }

    function canBatchContracts() external view returns (Batch[] memory) {
        Batch[] memory batch = new Batch[](contracts.length);
        for (uint256 i = 0; i < contracts.length; i++) {
            bool canBatch = IStaking(contracts[i]).canBatchTransactions();
            batch[i] = Batch(contracts[i], canBatch);
        }
        return batch;
    }

    function canBatchContractByIndex(uint256 _index)
        external
        view
        returns (address, bool)
    {
        return (
            contracts[_index],
            IStaking(contracts[_index]).canBatchTransactions()
        );
    }

    function getAddressByIndex(uint256 _index) external view returns (address) {
        return contracts[_index];
    }

    function getAddresses() external view returns (address[] memory) {
        return contracts;
    }

    function addAddress(address _address) external onlyOwner {
        contracts.push(_address);
    }

    function removeAddress(address _address) external onlyOwner {
        for (uint256 i = 0; i < contracts.length; i++) {
            if (contracts[i] == _address) {
                delete contracts[i];
            }
        }
    }
}
