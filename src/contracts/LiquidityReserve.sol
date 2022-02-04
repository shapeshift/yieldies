// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../libraries/ERC20.sol";
import "../libraries/Ownable.sol";
import "../interfaces/IStaking.sol";

contract LiquidityReserve is ERC20, Ownable {
    using SafeERC20 for IERC20;

    address public stakingToken;
    address public rewardToken;
    address public stakingContract;
    uint256 public fee;
    uint256 public constant MINIMUM_LIQUIDITY = 10**15; // lock .001 stakingTokens for initial liquidity
    address public initializer;

    constructor(address _stakingToken, address _rewardToken)
        ERC20("Liquidity Reserve FOX", "lrFOX", 18)
    {
        require(_stakingToken != address(0) && _rewardToken != address(0));
        initializer = msg.sender;
        stakingToken = _stakingToken;
        rewardToken = _rewardToken;
    }

    /**
        @notice initialize by setting stakingContract & setting initial liquidity
        @param _stakingContract address
     */
    function initialize(address _stakingContract) public {
        uint256 stakingTokenBalance = IERC20(stakingToken).balanceOf(
            msg.sender
        );
        require(_stakingContract != address(0));
        require(stakingTokenBalance >= MINIMUM_LIQUIDITY);
        stakingContract = _stakingContract;

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
        @notice sets Fee for instant unstaking
        @param _fee uint
     */
    function setFee(uint256 _fee) external onlyOwner {
        require(_fee >= 0 && fee <= 100, "Must be within range of 0 and 1");
        fee = _fee;
    }

    /**
        @notice deposit stakingToken and receive lrToken
        @param _amount uint
     */
    function deposit(uint256 _amount) external {
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
    function calculateReserveTokenValue(uint256 _amount)
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
        @notice withdraw lrToken for stakingToken
        @param _amount uint
     */
    function withdraw(uint256 _amount) external {
        require(
            _amount <= balanceOf(msg.sender),
            "Not enough liquidity reserve tokens"
        );
        // claim the stakingToken from previous unstakes
        IStaking(stakingContract).claimWithdraw(address(this));

        uint256 amountToWithdraw = calculateReserveTokenValue(_amount);
        require(
            IERC20(stakingToken).balanceOf(address(this)) >= amountToWithdraw,
            "Not enough funds in contract to cover withdraw"
        );

        _burn(msg.sender, _amount);
        IERC20(stakingToken).safeTransfer(msg.sender, amountToWithdraw);
    }

    /**
        @notice allow instant untake of stakingToken with fee
        @param _amount uint
        @param _recipient address
     */
    function instantUnstake(uint256 _amount, address _recipient) external {
        require(
            _amount <= IERC20(stakingToken).balanceOf(address(this)),
            "Not enough funds in contract to cover instant unstake"
        );
        // claim the stakingToken from previous unstakes
        IStaking(stakingContract).claimWithdraw(address(this));

        uint256 amountMinusFee = _amount - ((_amount * fee) / 100);

        // transfer from msg.sender due to not knowing if the funds are in warmup or not
        IERC20(rewardToken).safeTransferFrom(
            msg.sender,
            address(this),
            _amount
        );

        IERC20(stakingToken).safeTransfer(_recipient, amountMinusFee);

        IStaking(stakingContract).unstake(_amount, false);
    }
}
