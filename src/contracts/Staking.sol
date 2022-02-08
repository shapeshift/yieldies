// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./Vesting.sol";
import "./LiquidityReserve.sol";
import "../libraries/Ownable.sol";
import "../interfaces/IRewardToken.sol";
import "../interfaces/IVesting.sol";
import "../interfaces/ITokeManager.sol";
import "../interfaces/ITokePool.sol";
import "../interfaces/ITokeReward.sol";
import "../interfaces/ITokeRewardHash.sol";
import "../interfaces/ILiquidityReserve.sol";

contract Staking is Ownable {
    using SafeERC20 for IERC20;

    address public immutable tokePool;
    address public immutable tokeManager;
    address public immutable tokeReward;
    address public immutable tokeRewardHash;
    address public immutable stakingToken;
    address public immutable rewardToken;
    address public immutable tokeToken;
    address public immutable liquidityReserve;
    address public immutable warmUpContract;
    address public immutable coolDownContract;

    // owner overrides
    bool public pauseStaking = false;
    bool public pauseUnstaking = false;
    bool public overrideCanWithdrawal = false;

    // TODO: tightly pack for gas optimization
    struct Epoch {
        uint256 length;
        uint256 number;
        uint256 endBlock;
        uint256 distribute;
    }
    Epoch public epoch;

    mapping(address => Claim) public warmUpInfo;
    mapping(address => Claim) public coolDownInfo;

    uint256 public blocksLeftToRequestWithdrawal;
    uint256 public vestingPeriod;
    uint256 public lastUpdatedTokemakCycle;
    uint256 public requestWithdrawalAmount;
    uint256 public lastTokeCycleIndex;

    constructor(
        address _stakingToken,
        address _rewardToken,
        address _tokeToken,
        address _tokePool,
        address _tokeManager,
        address _tokeReward,
        address _tokeRewardHash,
        uint256 _epochLength,
        uint256 _firstEpochNumber,
        uint256 _firstEpochBlock
    ) {
        require(
            _stakingToken != address(0) &&
                _rewardToken != address(0) &&
                _rewardToken != address(0) &&
                _tokePool != address(0) &&
                _tokeManager != address(0) &&
                _tokeReward != address(0) &&
                _tokeRewardHash != address(0)
        );
        stakingToken = _stakingToken;
        rewardToken = _rewardToken;
        tokeToken = _tokeToken;
        tokePool = _tokePool;
        tokeManager = _tokeManager;
        tokeReward = _tokeReward;
        tokeRewardHash = _tokeRewardHash;
        Vesting warmUp = new Vesting(address(this), rewardToken);
        warmUpContract = address(warmUp);
        blocksLeftToRequestWithdrawal = 500;

        Vesting coolDown = new Vesting(address(this), rewardToken);
        coolDownContract = address(coolDown);

        LiquidityReserve lrContract = new LiquidityReserve(
            stakingToken,
            rewardToken
        );
        liquidityReserve = address(lrContract);

        IERC20(stakingToken).approve(tokePool, type(uint256).max);
        IERC20(rewardToken).approve(liquidityReserve, type(uint256).max);

        epoch = Epoch({
            length: _epochLength,
            number: _firstEpochNumber,
            endBlock: _firstEpochBlock,
            distribute: 0
        });
    }

    /**
        @notice claim TOKE from Tokemak
        @param _amount uint
        @param _v uint
        @param _r bytes
        @param _s bytes
     */
    function claimFromTokemak(
        uint256 _amount,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external {
        ITokeReward tokeRewardContract = ITokeReward(tokeReward);
        ITokeRewardHash iTokeRewardHash = ITokeRewardHash(tokeRewardHash);

        uint256 latestCycleIndex = iTokeRewardHash.latestCycleIndex();
        Recipient memory recipient = Recipient({
            chainId: 1,
            cycle: latestCycleIndex,
            wallet: address(this),
            amount: _amount
        });
        tokeRewardContract.claim(recipient, _v, _r, _s);
    }

    /**
        @notice transfer TOKE from contract to address
        @param _claimAddress address
        **/
    function transferToke(address _claimAddress) external onlyOwner {
        require(_claimAddress != address(0));
        uint256 amount = IERC20(tokeToken).balanceOf(address(this));
        IERC20(tokeToken).safeTransfer(_claimAddress, amount);
    }

    /**
        @notice override whether or not withdraws from Tokemak are blocked
        @param _shouldOverride bool
        **/
    function overrideWithdrawals(bool _shouldOverride) external onlyOwner {
        overrideCanWithdrawal = _shouldOverride;
    }

    /**
        @notice override whether or not deposits are blocked
        @param _shouldPause bool
        **/
    function overrideStaking(bool _shouldPause) external onlyOwner {
        pauseStaking = _shouldPause;
    }

    /**
        @notice override whether or not withdraws are blocked
        @param _shouldPause bool
        **/
    function overrideUnstaking(bool _shouldPause) external onlyOwner {
        pauseUnstaking = _shouldPause;
    }

    /**
        @notice prevent new deposits to address (protection from malicious activity)
     */
    function toggleDepositLock() external {
        warmUpInfo[msg.sender].lock = !warmUpInfo[msg.sender].lock;
    }

    /**
        @notice override whether or not withdraws are blocked
        @param _blocks uint
        **/
    function setBlocksLeftToRequestWithdrawal(uint256 _blocks)
        external
        onlyOwner
    {
        blocksLeftToRequestWithdrawal = _blocks;
    }

    /**
        @notice checks to see if claim is available
        @param _info Claim
        @return bool
     */
    function _isClaimAvailable(Claim memory _info)
        internal
        view
        returns (bool)
    {
        return epoch.number >= _info.expiry && _info.expiry != 0;
    }

    /**
        @notice withdraw from Tokemak
        @param _amount uint
     */
    function _withdrawFromTokemak(uint256 _amount) internal {
        ITokePool tokePoolContract = ITokePool(tokePool);
        tokePoolContract.withdraw(_amount);
    }

    /**
        @notice creates a withdrawRequest with Tokemak
        @param _amount uint
     */
    function _requestWithdrawalFromTokemak(uint256 _amount) internal {
        ITokePool tokePoolContract = ITokePool(tokePool);
        tokePoolContract.requestWithdrawal(_amount);
    }

    /**
        @notice deposit stakingToken to tStakingToken Tokemak reactor
        @param _amount uint
     */
    function _depositToTokemak(uint256 _amount) internal {
        ITokePool tokePoolContract = ITokePool(tokePool);
        tokePoolContract.deposit(_amount);
    }

    /**
        @notice gets balance of stakingToken that's locked into the TOKE stakingToken pool
        @return uint
     */
    function _getTokemakBalance() internal view returns (uint256) {
        ITokePool tokePoolContract = ITokePool(tokePool);
        return tokePoolContract.balanceOf(address(this));
    }

    /**
        @notice checks TOKE's cycleTime is withink duration to batch the transactions
        @return bool
     */
    function _canBatchTransactions() internal view returns (bool) {
        ITokeManager iTokeManager = ITokeManager(tokeManager);
        uint256 duration = iTokeManager.getCycleDuration();
        uint256 currentCycleStart = iTokeManager.getCurrentCycle();
        uint256 currentCycleIndex = iTokeManager.getCurrentCycleIndex();
        uint256 nextCycleStart = currentCycleStart + duration;
        return
            block.number + blocksLeftToRequestWithdrawal >= nextCycleStart &&
            currentCycleIndex > lastTokeCycleIndex;
    }

    /**
        @notice sends batched requestedWithdrawals
     */
    function sendWithdrawalRequests() public {
        if (_canBatchTransactions() || overrideCanWithdrawal) {
            ITokeManager iTokeManager = ITokeManager(tokeManager);
            uint256 currentCycleIndex = iTokeManager.getCurrentCycleIndex();
            lastTokeCycleIndex = currentCycleIndex;
            _requestWithdrawalFromTokemak(requestWithdrawalAmount);
            requestWithdrawalAmount = 0;
        }
    }

    /**
        @notice stake stakingToken to enter warmup
        @param _amount uint
        @param _recipient address
     */
    function stake(uint256 _amount, address _recipient) public {
        if (!pauseStaking) {
            rebase();
            IERC20(stakingToken).safeTransferFrom(
                msg.sender,
                address(this),
                _amount
            );

            Claim memory info = warmUpInfo[_recipient];
            require(!info.lock, "Deposits for account are locked");

            warmUpInfo[_recipient] = Claim({
                amount: info.amount + _amount,
                gons: info.gons +
                    IRewardToken(rewardToken).gonsForBalance(_amount),
                expiry: epoch.number + vestingPeriod,
                lock: false
            });

            _depositToTokemak(_amount);

            IERC20(rewardToken).safeTransfer(warmUpContract, _amount);
        }
    }

    /**
        @notice stake stakingToken to enter warmup
        @param _amount uint
     */
    function stake(uint256 _amount) external {
        stake(_amount, msg.sender);
    }

    /**
        @notice retrieve rewardToken from warmup
        @param _recipient address
     */
    function claim(address _recipient) external {
        Claim memory info = warmUpInfo[_recipient];
        if (_isClaimAvailable(info)) {
            delete warmUpInfo[_recipient];
            IVesting(warmUpContract).retrieve(
                _recipient,
                IRewardToken(rewardToken).balanceForGons(info.gons)
            );
        }
    }

    /**
        @notice claims stakingToken after cooldown period
        @param _recipient address
     */
    function claimWithdraw(address _recipient) external {
        Claim memory info = coolDownInfo[_recipient];
        ITokePool tokePoolContract = ITokePool(tokePool);
        WithdrawalInfo memory withdrawalInfo = tokePoolContract
            .requestedWithdrawals(address(this));
        if (_isClaimAvailable(info) && withdrawalInfo.amount > 0) {
            uint256 amount = IRewardToken(rewardToken).balanceForGons(
                info.gons
            );
            _withdrawFromTokemak(amount);

            IERC20(stakingToken).safeTransfer(_recipient, amount);

            // TODO: give _recipient amount at unstake


            delete coolDownInfo[_recipient];
            IVesting(coolDownContract).retrieve(_recipient, amount);
        }
    }

    /**
        @notice gets rewardToke either from the warmup contract or user's wallet
        @param _amount uint
     */
    function _getFromWarmupOrWallet(uint256 _amount, address _recipient)
        internal
    {
        Claim memory userWarmInfo = warmUpInfo[_recipient];
        require(!userWarmInfo.lock, "Withdraws for account are locked");
        uint256 walletBalance = IERC20(rewardToken).balanceOf(_recipient);
        uint256 warmUpBalance = IRewardToken(rewardToken).balanceForGons(
            userWarmInfo.gons
        );

        bool hasFullAmountInWarmup = warmUpBalance >= _amount &&
            _isClaimAvailable(userWarmInfo);
        bool hasFullAmountSplit = warmUpBalance + walletBalance >= _amount;

        require(
            hasFullAmountInWarmup ||
                hasFullAmountSplit ||
                walletBalance >= _amount,
            "Not enough FOXy to claim FOX"
        );

        if (hasFullAmountInWarmup) {
            uint256 newGonsAmount = userWarmInfo.gons - IRewardToken(rewardToken).gonsForBalance(_amount);
            uint256 newAmount = IRewardToken(rewardToken).balanceForGons(newGonsAmount);
            require(newAmount >= 0, "Not enough funds");

            IVesting(warmUpContract).retrieve(address(this), _amount);
            if (newAmount == 0) {
                delete warmUpInfo[_recipient];
            } else {
                warmUpInfo[_recipient] = Claim({
                    amount: newAmount,
                    gons: newGonsAmount,
                    expiry: userWarmInfo.expiry,
                    lock: false
                });
            }
        } else if (hasFullAmountSplit) {
            IVesting(warmUpContract).retrieve(address(this), warmUpBalance);
            delete warmUpInfo[_recipient];
            IERC20(rewardToken).safeTransferFrom(
                _recipient,
                address(this),
                _amount - warmUpBalance
            );
        } else {
            IERC20(rewardToken).safeTransferFrom(
                _recipient,
                address(this),
                _amount
            );
        }
    }

    /**
        @notice redeem rewardToken for stakingToken instantly with fee
        @param _amount uint
        @param _trigger bool
     */

    function instantUnstake(uint256 _amount, bool _trigger) external {
        if (!pauseUnstaking) {
            if (_trigger) {
                rebase();
            }
            _getFromWarmupOrWallet(_amount, msg.sender);

            ILiquidityReserve(liquidityReserve).instantUnstake(
                _amount,
                msg.sender
            );
        }
    }

    /**
        @notice redeem rewardToken for stakingToken
        @param _amount uint
        @param _trigger bool
     */
    function unstake(
        uint256 _amount,
        bool _trigger
    ) external {
        if (!pauseUnstaking) {
            if (_trigger) {
                rebase();
            }
            _getFromWarmupOrWallet(_amount, msg.sender);

            Claim memory userCoolInfo = coolDownInfo[msg.sender];
            require(!userCoolInfo.lock, "Withdrawals for account are locked");

            coolDownInfo[msg.sender] = Claim({
                amount: userCoolInfo.amount + _amount,
                gons: userCoolInfo.gons +
                    IRewardToken(rewardToken).gonsForBalance(_amount),
                expiry: epoch.number + vestingPeriod,
                lock: false
            });

            requestWithdrawalAmount += _amount;
            sendWithdrawalRequests();

            IERC20(rewardToken).safeTransfer(coolDownContract, _amount);
        }
    }

    /**
        @notice trigger rebase if epoch over
     */
    function rebase() public {
        if (epoch.endBlock <= block.number) {
            IRewardToken(rewardToken).rebase(epoch.distribute, epoch.number);

            epoch.endBlock = epoch.endBlock + epoch.length;
            epoch.number++;

            uint256 balance = contractBalance();
            uint256 staked = IRewardToken(rewardToken).circulatingSupply();

            if (balance <= staked) {
                epoch.distribute = 0;
            } else {
                epoch.distribute = balance - staked;
            }
        }
    }

    /**
        @notice returns contract stakingToken holdings
        @return uint
     */
    function contractBalance() public view returns (uint256) {
        uint256 tokeBalance = _getTokemakBalance();
        return IERC20(stakingToken).balanceOf(address(this)) + tokeBalance;
    }

    /**
     * @notice set vesting period for new stakers
     * @param _vestingPeriod uint
     */
    function setVesting(uint256 _vestingPeriod) external onlyOwner {
        vestingPeriod = _vestingPeriod;
    }

    function addRewardsForStakers(uint256 _amount, bool _isTriggerRebase)
        external
    {
        IERC20(stakingToken).safeTransferFrom(
            msg.sender,
            address(this),
            _amount
        );
        
        // deposit all stakingToken held in contract to Tokemak
        uint256 stakingTokenBalance = IERC20(stakingToken).balanceOf(address(this));
        _depositToTokemak(stakingTokenBalance);

        if (_isTriggerRebase) {
            rebase();
        }
    }

    /**
     * @notice sets fee for instant unstaking
     * @param _fee uint
     */
    function setInstantUnstakeFee(uint256 _fee) external onlyOwner {
        ILiquidityReserve(liquidityReserve).setFee(_fee);
    }
}
