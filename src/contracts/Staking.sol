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

    address public immutable TOKE_POOL;
    address public immutable TOKE_MANAGER;
    address public immutable TOKE_REWARD;
    address public immutable TOKE_REWARD_HASH;
    address public immutable STAKING_TOKEN;
    address public immutable REWARD_TOKEN;
    address public immutable TOKE_TOKEN;
    address public immutable LIQUIDITY_RESERVE;
    address public immutable WARM_UP_CONTRACT;
    address public immutable COOL_DOWN_CONTRACT;

    // owner overrides
    bool public pauseStaking = false;
    bool public pauseUnstaking = false;
    bool public overrideCanWithdraw = false;

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
    uint256 public warmUpPeriod;
    uint256 public coolDownPeriod;
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
        address _liquidityReserve,
        uint256 _epochLength,
        uint256 _firstEpochNumber,
        uint256 _firstEpochBlock
    ) {
        require(
            _stakingToken != address(0) &&
                _rewardToken != address(0) &&
                _tokeToken != address(0) &&
                _tokePool != address(0) &&
                _tokeManager != address(0) &&
                _tokeReward != address(0) &&
                _tokeRewardHash != address(0) &&
                _liquidityReserve != address(0)
        );
        STAKING_TOKEN = _stakingToken;
        REWARD_TOKEN = _rewardToken;
        TOKE_TOKEN = _tokeToken;
        TOKE_POOL = _tokePool;
        TOKE_MANAGER = _tokeManager;
        TOKE_REWARD = _tokeReward;
        TOKE_REWARD_HASH = _tokeRewardHash;
        LIQUIDITY_RESERVE = _liquidityReserve;

        Vesting warmUp = new Vesting(address(this), REWARD_TOKEN);
        WARM_UP_CONTRACT = address(warmUp);
        blocksLeftToRequestWithdrawal = 500;

        Vesting coolDown = new Vesting(address(this), REWARD_TOKEN);
        COOL_DOWN_CONTRACT = address(coolDown);

        IERC20(STAKING_TOKEN).approve(TOKE_POOL, type(uint256).max);
        IERC20(REWARD_TOKEN).approve(LIQUIDITY_RESERVE, type(uint256).max);

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
        require(_amount > 0, "Must enter valid amount");

        ITokeReward tokeRewardContract = ITokeReward(TOKE_REWARD);
        ITokeRewardHash iTokeRewardHash = ITokeRewardHash(TOKE_REWARD_HASH);

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
        uint256 amount = IERC20(TOKE_TOKEN).balanceOf(address(this));
        IERC20(TOKE_TOKEN).safeTransfer(_claimAddress, amount);
    }

    /**
        @notice override whether or not withdraws from Tokemak are blocked
        @param _shouldOverride bool
        **/
    function overrideWithdrawals(bool _shouldOverride) external onlyOwner {
        overrideCanWithdraw = _shouldOverride;
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
        @notice prevent new withdraws to address (protection from malicious activity)
     */
    function toggleWithdrawLock() external {
        coolDownInfo[msg.sender].lock = !coolDownInfo[msg.sender].lock;
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
        ITokePool TOKE_POOLContract = ITokePool(TOKE_POOL);
        TOKE_POOLContract.withdraw(_amount);
    }

    /**
        @notice creates a withdrawRequest with Tokemak
        @param _amount uint
     */
    function _requestWithdrawalFromTokemak(uint256 _amount) internal {
        ITokePool TOKE_POOLContract = ITokePool(TOKE_POOL);
        TOKE_POOLContract.requestWithdrawal(_amount);
    }

    /**
        @notice deposit STAKING_TOKEN to tStakingToken Tokemak reactor
        @param _amount uint
     */
    function _depositToTokemak(uint256 _amount) internal {
        ITokePool TOKE_POOLContract = ITokePool(TOKE_POOL);
        TOKE_POOLContract.deposit(_amount);
    }

    /**
        @notice gets balance of STAKING_TOKEN that's locked into the TOKE STAKING_TOKEN pool
        @return uint
     */
    function _getTokemakBalance() internal view returns (uint256) {
        ITokePool TOKE_POOLContract = ITokePool(TOKE_POOL);
        return TOKE_POOLContract.balanceOf(address(this));
    }

    /**
        @notice checks TOKE's cycleTime is withink duration to batch the transactions
        @return bool
     */
    function _canBatchTransactions() internal view returns (bool) {
        ITokeManager iTOKE_MANAGER = ITokeManager(TOKE_MANAGER);
        uint256 duration = iTOKE_MANAGER.getCycleDuration();
        uint256 currentCycleStart = iTOKE_MANAGER.getCurrentCycle();
        uint256 currentCycleIndex = iTOKE_MANAGER.getCurrentCycleIndex();
        uint256 nextCycleStart = currentCycleStart + duration;
        return
            block.number + blocksLeftToRequestWithdrawal >= nextCycleStart &&
            currentCycleIndex > lastTokeCycleIndex;
    }

    /**
        @notice sends batched requestedWithdrawals
     */
    function sendWithdrawalRequests() public {
        if (_canBatchTransactions() || overrideCanWithdraw) {
            ITokeManager iTOKE_MANAGER = ITokeManager(TOKE_MANAGER);
            _requestWithdrawalFromTokemak(requestWithdrawalAmount);

            uint256 currentCycleIndex = iTOKE_MANAGER.getCurrentCycleIndex();
            lastTokeCycleIndex = currentCycleIndex;
            requestWithdrawalAmount = 0;
        }
    }

    /**
        @notice stake STAKING_TOKEN to enter warmup
        @param _amount uint
        @param _recipient address
     */
    function stake(uint256 _amount, address _recipient) public {
        require(!pauseStaking, "Staking is paused");
        rebase();
        IERC20(STAKING_TOKEN).safeTransferFrom(
            msg.sender,
            address(this),
            _amount
        );

        Claim memory info = warmUpInfo[_recipient];
        require(!info.lock, "Deposits for account are locked");

        _depositToTokemak(_amount);

        if (warmUpPeriod == 0) {
            IERC20(REWARD_TOKEN).safeTransfer(_recipient, _amount);
        } else {
            warmUpInfo[_recipient] = Claim({
                amount: info.amount + _amount,
                gons: info.gons +
                    IRewardToken(REWARD_TOKEN).gonsForBalance(_amount),
                expiry: epoch.number + warmUpPeriod,
                lock: false
            });

            IERC20(REWARD_TOKEN).safeTransfer(WARM_UP_CONTRACT, _amount);
        }
    }

    /**
        @notice stake STAKING_TOKEN to enter warmup
        @param _amount uint
     */
    function stake(uint256 _amount) external {
        stake(_amount, msg.sender);
    }

    /**
        @notice retrieve REWARD_TOKEN from warmup
        @param _recipient address
     */
    function claim(address _recipient) external {
        Claim memory info = warmUpInfo[_recipient];
        if (_isClaimAvailable(info)) {
            delete warmUpInfo[_recipient];
            IVesting(WARM_UP_CONTRACT).retrieve(
                _recipient,
                IRewardToken(REWARD_TOKEN).balanceForGons(info.gons)
            );
        }
    }

    /**
        @notice claims STAKING_TOKEN after cooldown period
        @param _recipient address
     */
    function claimWithdraw(address _recipient) external {
        Claim memory info = coolDownInfo[_recipient];
        require(!info.lock, "Withdraws for account are locked");

        ITokePool TOKE_POOLContract = ITokePool(TOKE_POOL);
        WithdrawalInfo memory withdrawalInfo = TOKE_POOLContract
            .requestedWithdrawals(address(this));
        uint256 totalAmountIncludingRewards = IRewardToken(REWARD_TOKEN)
            .balanceForGons(info.gons);
        if (
            (_isClaimAvailable(info) || overrideCanWithdraw) &&
            withdrawalInfo.amount >= totalAmountIncludingRewards
        ) {
            _withdrawFromTokemak(totalAmountIncludingRewards);

            // only give amount from when they requested withdrawal since this amount wasn't used in generating rewards
            // this will later be given to users through addRewardsForStakers
            IERC20(STAKING_TOKEN).safeTransfer(_recipient, info.amount);

            delete coolDownInfo[_recipient];
            IVesting(COOL_DOWN_CONTRACT).retrieve(
                _recipient,
                totalAmountIncludingRewards
            );
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
        uint256 walletBalance = IERC20(REWARD_TOKEN).balanceOf(_recipient);
        uint256 warmUpBalance = IRewardToken(REWARD_TOKEN).balanceForGons(
            userWarmInfo.gons
        );

        require(_amount <= walletBalance + warmUpBalance, "Insufficient Balance");
        
        uint256 amountLeft = _amount;
        if(warmUpBalance > 0) {
          require(!userWarmInfo.lock, "Withdraws for account are locked");
          // remove from warmup first.
          if(_amount >= warmUpBalance){
            // use the entire warmup balance
            unchecked {
              amountLeft -= warmUpBalance;  
            }
            
            IVesting(WARM_UP_CONTRACT).retrieve(address(this), warmUpBalance);
            delete warmUpInfo[_recipient];

          } else {
            // partially consume warmup balance
            amountLeft = 0;
            
            IVesting(WARM_UP_CONTRACT).retrieve(address(this), _amount);
            uint256 remainingGonsAmount = userWarmInfo.gons -
                IRewardToken(REWARD_TOKEN).gonsForBalance(_amount);
            uint256 remainingAmount = IRewardToken(REWARD_TOKEN).balanceForGons(
                remainingGonsAmount
            );

            warmUpInfo[_recipient] = Claim({
                amount: remainingAmount,
                gons: remainingGonsAmount,
                expiry: userWarmInfo.expiry,
                lock: false
            });
          }
        }

        if(amountLeft > 0) {
          IERC20(REWARD_TOKEN).safeTransferFrom(
                _recipient,
                address(this),
                amountLeft
            );
        }
    }

    /**
        @notice redeem REWARD_TOKEN for STAKING_TOKEN instantly with fee
        @param _amount uint
        @param _trigger bool
     */

    function instantUnstake(uint256 _amount, bool _trigger) external {
        require(!pauseUnstaking, "Unstaking is paused");
        if (_trigger) {
            rebase();
        }
        _getFromWarmupOrWallet(_amount, msg.sender);

        ILiquidityReserve(LIQUIDITY_RESERVE).instantUnstake(
            _amount,
            msg.sender
        );
    }

    /**
        @notice redeem REWARD_TOKEN for STAKING_TOKEN
        @param _amount uint
        @param _trigger bool
     */
    function unstake(uint256 _amount, bool _trigger) external {
        require(!pauseUnstaking, "Unstaking is paused");
        if (_trigger) {
            rebase();
        }
        _getFromWarmupOrWallet(_amount, msg.sender);

        Claim memory userCoolInfo = coolDownInfo[msg.sender];
        require(!userCoolInfo.lock, "Withdraws for account are locked");

        coolDownInfo[msg.sender] = Claim({
            amount: userCoolInfo.amount + _amount,
            gons: userCoolInfo.gons +
                IRewardToken(REWARD_TOKEN).gonsForBalance(_amount),
            expiry: epoch.number + coolDownPeriod,
            lock: false
        });

        requestWithdrawalAmount += _amount;
        sendWithdrawalRequests();

        IERC20(REWARD_TOKEN).safeTransfer(COOL_DOWN_CONTRACT, _amount);
    }

    /**
        @notice trigger rebase if epoch over
     */
    function rebase() public {
        if (epoch.endBlock <= block.number) {
            IRewardToken(REWARD_TOKEN).rebase(epoch.distribute, epoch.number);

            epoch.endBlock = epoch.endBlock + epoch.length;
            epoch.number++;

            uint256 balance = contractBalance();
            uint256 staked = IRewardToken(REWARD_TOKEN).circulatingSupply();

            if (balance <= staked) {
                epoch.distribute = 0;
            } else {
                epoch.distribute = balance - staked;
            }
        }
    }

    /**
        @notice returns contract STAKING_TOKEN holdings
        @return uint
     */
    function contractBalance() internal view returns (uint256) {
        uint256 tokeBalance = _getTokemakBalance();
        return IERC20(STAKING_TOKEN).balanceOf(address(this)) + tokeBalance;
    }

    /**
     * @notice set epoch length
     * @param length uint
     */
    function setEpochLength(uint256 length) external onlyOwner {
        epoch.length = length;
    }

    /**
     * @notice set warmup period for new stakers
     * @param _vestingPeriod uint
     */
    function setWarmUpPeriod(uint256 _vestingPeriod) external onlyOwner {
        warmUpPeriod = _vestingPeriod;
    }

    /**
     * @notice set cooldown period for stakers
     * @param _vestingPeriod uint
     */
    function setCoolDownPeriod(uint256 _vestingPeriod) external onlyOwner {
        coolDownPeriod = _vestingPeriod;
    }

    function addRewardsForStakers(uint256 _amount, bool _isTriggerRebase)
        external
    {
        require(
            IERC20(STAKING_TOKEN).balanceOf(msg.sender) >= _amount,
            "Not enough staking tokens"
        );

        IERC20(STAKING_TOKEN).safeTransferFrom(
            msg.sender,
            address(this),
            _amount
        );

        // deposit all STAKING_TOKEN held in contract to Tokemak
        uint256 stakingTokenBalance = IERC20(STAKING_TOKEN).balanceOf(
            address(this)
        );
        _depositToTokemak(stakingTokenBalance);

        if (_isTriggerRebase) {
            rebase();
        }
    }
}
