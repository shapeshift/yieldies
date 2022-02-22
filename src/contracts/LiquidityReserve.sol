// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../libraries/ERC20.sol";
import "../libraries/Ownable.sol";
import "../interfaces/IStaking.sol";

contract LiquidityReserve is ERC20, Ownable {
    using SafeERC20 for IERC20;

    event FeeChanged(uint256 indexed fee);

    address public stakingToken;
    address public rewardToken;
    address public stakingContract;
    uint256 public fee;
    address public initializer;
    uint256 public constant MINIMUM_LIQUIDITY = 10**15; // lock .001 stakingTokens for initial liquidity
    uint256 public constant BASIS_POINTS = 10000; // 100% in basis points

    constructor(address _stakingToken) ERC20("Liquidity Reserve FOX", "lrFOX") {
        // verify address isn't 0x0
        require(_stakingToken != address(0), "Invalid address");
        initializer = msg.sender;
        stakingToken = _stakingToken;
    }

    /**
        @notice initialize by setting stakingContract & setting initial liquidity
        @param _stakingContract address
     */
    function initialize(address _stakingContract, address _rewardToken)
        external
        onlyOwner
    {
        uint256 stakingTokenBalance = IERC20(stakingToken).balanceOf(
            msg.sender
        );

        // verify addresses aren't 0x0
        require(
            _stakingContract != address(0) && _rewardToken != address(0),
            "Invalid address"
        );

        // require address has minimum liquidity
        require(
            stakingTokenBalance >= MINIMUM_LIQUIDITY,
            "Not enough staking tokens"
        );
        stakingContract = _stakingContract;
        rewardToken = _rewardToken;

        // permanently lock the first MINIMUM_LIQUIDITY of lrTokens & stakingTokens
        IERC20(stakingToken).transferFrom(
            msg.sender,
            address(this),
            MINIMUM_LIQUIDITY
        );
        _mint(address(this), MINIMUM_LIQUIDITY);

        IERC20(rewardToken).approve(stakingContract, type(uint256).max);
    }

    /**
        @notice sets Fee (in basis points eg. 100 bps = 1%) for instant unstaking
        @param _fee uint
     */
    function setFee(uint256 _fee) external onlyOwner {
        // check range before setting fee
        require(_fee <= BASIS_POINTS, "Out of range");
        fee = _fee;

        emit FeeChanged(_fee);
    }

    /**
        @notice addLiquidity for the stakingToken and receive lrToken in exchange
        @param _amount uint
     */
    function addLiquidity(uint256 _amount) external {
        uint256 stakingTokenBalance = IERC20(stakingToken).balanceOf(
            address(this)
        );
        uint256 rewardTokenBalance = IERC20(rewardToken).balanceOf(
            address(this)
        );
        uint256 lrFoxSupply = totalSupply();
        uint256 coolDownAmount = IStaking(stakingContract)
            .coolDownInfo(address(this))
            .amount;
        uint256 totalLockedValue = stakingTokenBalance +
            rewardTokenBalance +
            coolDownAmount;
        uint256 amountToMint = (_amount * lrFoxSupply) / totalLockedValue;

        IERC20(stakingToken).safeTransferFrom(
            msg.sender,
            address(this),
            _amount
        );
        _mint(msg.sender, amountToMint);
    }

    /**
        @notice calculate current lrToken withdraw value
        @param _amount uint
        @return uint
     */
    function _calculateReserveTokenValue(uint256 _amount)
        internal
        view
        returns (uint256)
    {
        uint256 lrFoxSupply = totalSupply();
        uint256 stakingTokenBalance = IERC20(stakingToken).balanceOf(
            address(this)
        );
        uint256 rewardTokenBalance = IERC20(rewardToken).balanceOf(
            address(this)
        );
        uint256 coolDownAmount = IStaking(stakingContract)
            .coolDownInfo(address(this))
            .amount;
        uint256 totalLockedValue = stakingTokenBalance +
            rewardTokenBalance +
            coolDownAmount;
        uint256 convertedAmount = (_amount * totalLockedValue) / lrFoxSupply;

        return convertedAmount;
    }

    /**
        @notice removeLiquidity by swapping your lrToken for stakingTokens
        @param _amount uint
     */
    function removeLiquidity(uint256 _amount) external {
        // check balance before removing liquidity
        require(_amount <= balanceOf(msg.sender), "Not enough lr tokens");
        // claim the stakingToken from previous unstakes
        IStaking(stakingContract).claimWithdraw(address(this));

        uint256 amountToWithdraw = _calculateReserveTokenValue(_amount);

        // verify that we have enough stakingTokens
        require(
            IERC20(stakingToken).balanceOf(address(this)) >= amountToWithdraw,
            "Not enough funds"
        );

        _burn(msg.sender, _amount);
        IERC20(stakingToken).safeTransfer(msg.sender, amountToWithdraw);
    }


//TODO: clean up natspec 
    /**
        @notice allow instant unstake their stakingToken for a fee paid to the liquidity providers
        @param _amount uint
        @param _recipient address
     */
    function instantUnstake(uint256 _amount, address _recipient) external {
        // claim the stakingToken from previous unstakes
        IStaking(stakingContract).claimWithdraw(address(this));
        uint256 amountMinusFee = _amount - ((_amount * fee) / BASIS_POINTS);

        IERC20(rewardToken).safeTransferFrom(
            msg.sender,
            address(this),
            _amount
        );

        IERC20(stakingToken).safeTransfer(_recipient, amountMinusFee);


// check if claim expired
// wait until expired
// make public function for unstake
        IStaking(stakingContract).unstake(_amount, false);
    }
}
