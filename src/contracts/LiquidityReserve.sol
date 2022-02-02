// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../libraries/ERC20.sol";
import "../libraries/Ownable.sol";

contract LiquidityReserve is ERC20, Ownable {
    using SafeERC20 for IERC20;

    modifier onlyStakingContract() {
        require(msg.sender == stakingContract);
        _;
    }

    address public stakingToken;
    address public rewardToken;
    address public stakingContract;
    address public initializer;
    uint256 public fee;

    constructor(address _stakingToken, address _rewardToken)
        ERC20("Liquidity Reserve FOX", "lrFOX", 18)
    {
        require(_stakingToken != address(0) && _rewardToken != address(0));
        stakingToken = _stakingToken;
        rewardToken = _rewardToken;
        initializer = msg.sender;
    }

    function initialize(address stakingContract_) external returns (bool) {
        require(msg.sender == initializer);
        require(stakingContract_ != address(0));
        stakingContract = stakingContract_;
        initializer = address(0);
        return true;
    }

    function deposit(uint256 _amount) external {
        IERC20(stakingToken).safeTransferFrom(
            msg.sender,
            address(this),
            _amount
        );
        transfer(msg.sender, _amount);
    }

    function withdraw(uint256 _amount) external {
        transferFrom(msg.sender, address(this), _amount);
        IERC20(stakingToken).safeTransfer(msg.sender, _amount);
    }

    function instantUnstake(uint256 _amount) external {
        uint256 amountMinusFee = _amount - (_amount * fee); 
         IERC20(rewardToken).safeTransferFrom(
            msg.sender,
            address(this),
            _amount
        );
        IERC20(stakingToken).safeTransfer(
            msg.sender,
            amountMinusFee
        );
    }

    function setFee(uint256 _fee) external {
        require(_fee >= 0 && fee <= 1, "Must be within range of 0 and 1");
        fee = _fee;
    }
}
