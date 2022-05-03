// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./Vesting.sol";
import "./LiquidityReserve.sol";
import "./StakingStorage.sol";
import "../interfaces/IRewardToken.sol";
import "../interfaces/IVesting.sol";
import "../interfaces/ITokeManager.sol";
import "../interfaces/ITokePool.sol";
import "../interfaces/ITokeReward.sol";
import "../interfaces/ILiquidityReserve.sol";
import "../interfaces/ICurvePool.sol";
import "../interfaces/ICowSettlement.sol";

contract Staking is OwnableUpgradeable, StakingStorage {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    event LogSetEpochDuration(uint256 indexed blockNumber, uint256 duration);
    event LogSetWarmUpPeriod(uint256 indexed blockNumber, uint256 period);
    event LogSetCoolDownPeriod(uint256 indexed blockNumber, uint256 period);
    event LogSetPauseStaking(uint256 indexed blockNumber, bool shouldPause);
    event LogSetPauseUnstaking(uint256 indexed blockNumber, bool shouldPause);
    event LogSetPauseInstantUnstaking(
        uint256 indexed blockNumber,
        bool shouldPause
    );
    event LogSetAffiliateAddress(
        uint256 indexed blockNumber,
        address affilateAddress
    );
    event LogSetAffiliateFee(uint256 indexed blockNumber, uint256 fee);

    event LogSetCurvePool(address indexed curvePool, int128 to, int128 from);

    function initialize(
        address _stakingToken,
        address _rewardToken,
        address _tokeToken,
        address _tokePool,
        address _tokeManager,
        address _tokeReward,
        address _liquidityReserve,
        address _affilateAddress,
        address _curvePool,
        uint256 _epochDuration,
        uint256 _firstEpochNumber,
        uint256 _firstEpochEndTime
    ) external initializer {
        OwnableUpgradeable.__Ownable_init();

        // must have valid initial addresses
        require(
            _stakingToken != address(0) &&
                _rewardToken != address(0) &&
                _tokeToken != address(0) &&
                _tokePool != address(0) &&
                _tokeManager != address(0) &&
                _tokeReward != address(0) &&
                _liquidityReserve != address(0),
            "Invalid address"
        );
        STAKING_TOKEN = _stakingToken;
        REWARD_TOKEN = _rewardToken;
        TOKE_TOKEN = _tokeToken;
        TOKE_POOL = _tokePool;
        TOKE_MANAGER = _tokeManager;
        TOKE_REWARD = _tokeReward;
        LIQUIDITY_RESERVE = _liquidityReserve;
        AFFILIATE_ADDRESS = _affilateAddress;
        CURVE_POOL = _curvePool;
        COW_SETTLEMENT = 0x9008D19f58AAbD9eD0D60971565AA8510560ab41;
        COW_RELAYER = 0xC92E8bdf79f0507f65a392b0ab4667716BFE0110;

        timeLeftToRequestWithdrawal = 43200; // 43200 = 12 hours

        // TODO: when upgrading and creating new warmUP / coolDown contracts the funds need to be migrated over
        // create vesting contract to hold newly staked rewardTokens based on warmup period
        Vesting warmUp = new Vesting(address(this), REWARD_TOKEN);
        WARM_UP_CONTRACT = address(warmUp);

        // create vesting contract to hold newly unstaked rewardTokens based on cooldown period
        Vesting coolDown = new Vesting(address(this), REWARD_TOKEN);
        COOL_DOWN_CONTRACT = address(coolDown);

        if (CURVE_POOL != address(0)) {
            IERC20(TOKE_POOL).approve(CURVE_POOL, type(uint256).max);
            setToAndFromCurve();
        }

        IERC20(STAKING_TOKEN).approve(TOKE_POOL, type(uint256).max);
        IERC20Upgradeable(REWARD_TOKEN).approve(
            LIQUIDITY_RESERVE,
            type(uint256).max
        );
        IERC20Upgradeable(REWARD_TOKEN).approve(
            LIQUIDITY_RESERVE,
            type(uint256).max
        );
        IERC20Upgradeable(TOKE_TOKEN).approve(COW_RELAYER, type(uint256).max);

        epoch = Epoch({
            duration: _epochDuration,
            number: _firstEpochNumber,
            timestamp: block.timestamp, // we know about the issues surrounding block.timestamp, using it here will not cause any problems
            endTime: _firstEpochEndTime,
            distribute: 0
        });
    }

    /**
        @notice claim TOKE rewards from Tokemak
        @dev must get amount through toke reward contract using latest cycle from reward hash contract
        @param _recipient Recipient struct that contains chainId, cycle, address, and amount 
        @param _v uint - recovery id
        @param _r bytes - output of ECDSA signature
        @param _s bytes - output of ECDSA signature
     */
    function claimFromTokemak(
        Recipient calldata _recipient,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external {
        // cannot claim 0
        require(_recipient.amount > 0, "Must enter valid amount");

        ITokeReward tokeRewardContract = ITokeReward(TOKE_REWARD);
        tokeRewardContract.claim(_recipient, _v, _r, _s);
        _sendAffiliateFee(_recipient.amount);
    }

    /**
        @notice send affiliate fee
        @param _amount uint - total amount to deduct fee from
     */
    function _sendAffiliateFee(uint256 _amount) internal {
        if (affiliateFee != 0 && AFFILIATE_ADDRESS != address(0)) {
            uint256 amountMinusFee = _amount -
                ((_amount * affiliateFee) / BASIS_POINTS);
            uint256 feeAmount = _amount - amountMinusFee;

            IERC20Upgradeable(TOKE_TOKEN).safeTransfer(
                AFFILIATE_ADDRESS,
                feeAmount
            );
        }
    }

    /**
        @notice transfer TOKE from staking contract to address
        @dev used so DAO can get TOKE and manually trade to return FOX to the staking contract
        @param _claimAddress address to send TOKE rewards
     */
    function transferToke(address _claimAddress) external onlyOwner {
        // _claimAddress can't be 0x0
        require(_claimAddress != address(0), "Invalid address");
        uint256 totalTokeAmount = IERC20Upgradeable(TOKE_TOKEN).balanceOf(
            address(this)
        );
        IERC20Upgradeable(TOKE_TOKEN).safeTransfer(
            _claimAddress,
            totalTokeAmount
        );
    }

    /**
        @notice sets the curve pool address
        @param _curvePool uint
     */
    function setCurvePool(address _curvePool) public onlyOwner {
        CURVE_POOL = _curvePool;
        setToAndFromCurve();
    }

    /**
        @notice sets the affiliate fee
        @dev fee is set in basis points
        @param _affiliateFee uint
     */
    function setAffiliateFee(uint256 _affiliateFee) public onlyOwner {
        affiliateFee = _affiliateFee;
        emit LogSetAffiliateFee(block.number, _affiliateFee);
    }

    /**
        @notice sets the affiliate address to receive the affiliate fee in TOKE
        @dev if set to 0x000.. then no affiliate will be sent
        @param _affiliateAddress address
     */
    function setAffiliateAddress(address _affiliateAddress) public onlyOwner {
        AFFILIATE_ADDRESS = _affiliateAddress;
        emit LogSetAffiliateAddress(block.number, _affiliateAddress);
    }

    /**
        @notice override whether or not staking is paused
        @dev used to pause staking in case some attack vector becomes present
        @param _shouldPause bool
     */
    function shouldPauseStaking(bool _shouldPause) public onlyOwner {
        isStakingPaused = _shouldPause;
        emit LogSetPauseStaking(block.number, _shouldPause);
    }

    /**
        @notice override whether or not unstake & instantUnstake is paused
        @dev used to pause unstake & instantUnstake in case some attack vector becomes present
        @param _shouldPause bool
     */
    function shouldPauseUnstaking(bool _shouldPause) external onlyOwner {
        isUnstakingPaused = _shouldPause;
        emit LogSetPauseUnstaking(block.number, _shouldPause);
    }

    /**
        @notice override whether or not instantUnstake is paused
        @dev used to pause instantUnstake in case some attack vector becomes present
        @param _shouldPause bool
     */
    function shouldPauseInstantUnstaking(bool _shouldPause) external onlyOwner {
        isInstantUnstakingPaused = _shouldPause;
        emit LogSetPauseInstantUnstaking(block.number, _shouldPause);
    }

    /**
        @notice set epoch duration
        @dev epoch's determine how long until a rebase can occur
        @param duration uint
     */
    function setEpochDuration(uint256 duration) external onlyOwner {
        epoch.duration = duration;
        emit LogSetEpochDuration(block.number, duration);
    }

    /**
     * @notice set warmup period for new stakers
     * @param _vestingPeriod uint
     */
    function setWarmUpPeriod(uint256 _vestingPeriod) external onlyOwner {
        warmUpPeriod = _vestingPeriod;
        emit LogSetWarmUpPeriod(block.number, _vestingPeriod);
    }

    /**
     * @notice set cooldown period for stakers
     * @param _vestingPeriod uint
     */
    function setCoolDownPeriod(uint256 _vestingPeriod) public onlyOwner {
        coolDownPeriod = _vestingPeriod;
        emit LogSetCoolDownPeriod(block.number, _vestingPeriod);
    }

    /**
        @notice sets the time before Tokemak cycle ends to requestWithdrawals
        @dev requestWithdrawals is called once per cycle.
        @dev this allows us to change how much time before the end of the cycle we send the withdraw requests
        @param _timestamp uint - time before end of cycle
     */
    function setTimeLeftToRequestWithdrawal(uint256 _timestamp)
        external
        onlyOwner
    {
        timeLeftToRequestWithdrawal = _timestamp;
    }

    /**
        @notice returns true if claim is available
        @dev this shows whether or not our epoch's have passed
        @param _recipient address - warmup address to check if claim is available
        @return bool - true if available to claim
     */
    function _isClaimAvailable(address _recipient)
        internal
        view
        returns (bool)
    {
        Claim memory info = warmUpInfo[_recipient];
        return epoch.number >= info.expiry && info.expiry != 0;
    }

    /**
        @notice returns true if claimWithdraw is available
        @dev this shows whether or not our epoch's have passed as well as if the cycle has increased
        @param _recipient address - address that's checking for available claimWithdraw
        @return bool - true if available to claimWithdraw
     */
    function _isClaimWithdrawAvailable(address _recipient)
        internal
        returns (bool)
    {
        Claim memory info = coolDownInfo[_recipient];
        ITokeManager tokeManager = ITokeManager(TOKE_MANAGER);
        ITokePool tokePoolContract = ITokePool(TOKE_POOL);
        RequestedWithdrawalInfo memory requestedWithdrawals = tokePoolContract
            .requestedWithdrawals(address(this));
        uint256 currentCycleIndex = tokeManager.getCurrentCycleIndex();
        return
            epoch.number >= info.expiry &&
            info.expiry != 0 &&
            info.amount != 0 &&
            ((requestedWithdrawals.minCycle <= currentCycleIndex &&
                requestedWithdrawals.amount + withdrawalAmount >=
                info.amount) || withdrawalAmount >= info.amount);
    }

    /**
        @notice withdraw stakingTokens from Tokemak
        @dev needs a valid requestWithdrawal inside Tokemak with a completed cycle rollover to withdraw
     */
    function _withdrawFromTokemak() internal {
        ITokePool tokePoolContract = ITokePool(TOKE_POOL);
        ITokeManager tokeManager = ITokeManager(TOKE_MANAGER);
        RequestedWithdrawalInfo memory requestedWithdrawals = tokePoolContract
            .requestedWithdrawals(address(this));
        uint256 currentCycleIndex = tokeManager.getCurrentCycleIndex();

        if (
            requestedWithdrawals.amount > 0 &&
            requestedWithdrawals.minCycle <= currentCycleIndex
        ) {
            tokePoolContract.withdraw(requestedWithdrawals.amount);
            requestWithdrawalAmount -= requestedWithdrawals.amount;
            withdrawalAmount += requestedWithdrawals.amount;
        }
    }

    /**
        @notice creates a withdrawRequest with Tokemak
        @dev requestedWithdraws take 1 tokemak cycle to be available for withdraw
        @param _amount uint - amount to request withdraw
     */
    function _requestWithdrawalFromTokemak(uint256 _amount) internal {
        ITokePool tokePoolContract = ITokePool(TOKE_POOL);
        uint256 balance = ITokePool(TOKE_POOL).balanceOf(address(this));

        // the only way balance < _amount is when using unstakeAllFromTokemak
        uint256 amountToRequest = balance < _amount ? balance : _amount;

        if (amountToRequest > 0) tokePoolContract.requestWithdrawal(_amount);
    }

    /**
        @notice deposit stakingToken to tStakingToken Tokemak reactor
        @param _amount uint - amount to deposit
     */
    function _depositToTokemak(uint256 _amount) internal {
        ITokePool tokePoolContract = ITokePool(TOKE_POOL);
        tokePoolContract.deposit(_amount);
    }

    /**
        @notice gets balance of stakingToken that's locked into the TOKE stakingToken pool
        @return uint - amount of stakingToken in TOKE pool
     */
    function _getTokemakBalance() internal view returns (uint256) {
        ITokePool tokePoolContract = ITokePool(TOKE_POOL);
        return tokePoolContract.balanceOf(address(this));
    }

    /**
        @notice checks TOKE's cycleTime is within duration to batch the transactions
        @dev this function returns true if we are within timeLeftToRequestWithdrawal of the end of the TOKE cycle
        @dev as well as if the current cycle index is more than the last cycle index
        @return bool - returns true if can batch transactions
     */
    function canBatchTransactions() public view returns (bool) {
        ITokeManager tokeManager = ITokeManager(TOKE_MANAGER);
        uint256 duration = tokeManager.getCycleDuration();
        uint256 currentCycleStart = tokeManager.getCurrentCycle();
        uint256 currentCycleIndex = tokeManager.getCurrentCycleIndex();
        uint256 nextCycleStart = currentCycleStart + duration;

        return
            block.timestamp + timeLeftToRequestWithdrawal >= nextCycleStart &&
            currentCycleIndex > lastTokeCycleIndex &&
            requestWithdrawalAmount > 0;
    }

    /**
        @notice owner function to requestWithdraw all FOX from tokemak in case of an attack on tokemak
        @dev this bypasses the normal flow of sending a withdrawal request and allows the owner to requestWithdraw entire pool balance
     */
    function unstakeAllFromTokemak() public onlyOwner {
        ITokePool tokePoolContract = ITokePool(TOKE_POOL);
        uint256 tokePoolBalance = ITokePool(tokePoolContract).balanceOf(
            address(this)
        );
        // pause any future staking
        shouldPauseStaking(true);
        requestWithdrawalAmount = tokePoolBalance;
        _requestWithdrawalFromTokemak(tokePoolBalance);
    }

    /**
        @notice sends batched requestedWithdrawals due to TOKE's requestWithdrawal overwriting the amount if you call it more than once per cycle
     */
    function sendWithdrawalRequests() public {
        // check to see if near the end of a TOKE cycle
        if (canBatchTransactions()) {
            // if has withdrawal amount to be claimed then claim
            _withdrawFromTokemak();

            // if more requestWithdrawalAmount exists after _withdrawFromTokemak then request the new amount
            ITokeManager tokeManager = ITokeManager(TOKE_MANAGER);
            if (requestWithdrawalAmount > 0) {
                _requestWithdrawalFromTokemak(requestWithdrawalAmount);
            }

            uint256 currentCycleIndex = tokeManager.getCurrentCycleIndex();
            lastTokeCycleIndex = currentCycleIndex;
        }
    }

    /**
        @notice stake staking tokens to receive reward tokens
        @param _amount uint
        @param _recipient address
     */
    function stake(uint256 _amount, address _recipient) public {
        // if override staking, then don't allow stake
        require(!isStakingPaused, "Staking is paused");
        // amount must be non zero
        require(_amount > 0, "Must have valid amount");

        uint256 circulatingSupply = IRewardToken(REWARD_TOKEN)
            .circulatingSupply();

        // Don't rebase unless tokens are already staked or could get locked out of staking
        if (circulatingSupply > 0) {
            rebase();
        }

        IERC20Upgradeable(STAKING_TOKEN).safeTransferFrom(
            msg.sender,
            address(this),
            _amount
        );

        Claim storage info = warmUpInfo[_recipient];

        // if claim is available then auto claim tokens
        if (_isClaimAvailable(_recipient)) {
            claim(_recipient);
        }

        _depositToTokemak(_amount);

        // skip adding to warmup contract if period is 0
        if (warmUpPeriod == 0) {
            IERC20Upgradeable(REWARD_TOKEN).safeTransfer(_recipient, _amount);
        } else {
            // create a claim and send tokens to the warmup contract
            warmUpInfo[_recipient] = Claim({
                amount: info.amount + _amount,
                gons: info.gons +
                    IRewardToken(REWARD_TOKEN).gonsForBalance(_amount),
                expiry: epoch.number + warmUpPeriod
            });

            IERC20Upgradeable(REWARD_TOKEN).safeTransfer(
                WARM_UP_CONTRACT,
                _amount
            );
        }

        sendWithdrawalRequests();
    }

    /**
        @notice call stake with msg.sender
        @param _amount uint
     */
    function stake(uint256 _amount) external {
        stake(_amount, msg.sender);
    }

    /**
        @notice retrieve reward tokens from warmup
        @dev if user has funds in warmup then user is able to claim them (including rewards)
        @param _recipient address
     */
    function claim(address _recipient) public {
        Claim memory info = warmUpInfo[_recipient];
        if (_isClaimAvailable(_recipient)) {
            delete warmUpInfo[_recipient];

            IVesting(WARM_UP_CONTRACT).retrieve(
                _recipient,
                IRewardToken(REWARD_TOKEN).balanceForGons(info.gons)
            );
        }
    }

    /**
        @notice claims staking tokens after cooldown period
        @dev if user has a cooldown claim that's past expiry then withdraw staking tokens from tokemak
        @dev and send them to user
        @param _recipient address - users unstaking address
     */
    function claimWithdraw(address _recipient) public {
        Claim memory info = coolDownInfo[_recipient];
        uint256 totalAmountIncludingRewards = IRewardToken(REWARD_TOKEN)
            .balanceForGons(info.gons);
        if (_isClaimWithdrawAvailable(_recipient)) {
            // if has withdrawalAmount to be claimed, then claim
            _withdrawFromTokemak();

            delete coolDownInfo[_recipient];

            // only give amount from when they requested withdrawal since this amount wasn't used in generating rewards
            // this will later be given to users through addRewardsForStakers
            IERC20Upgradeable(STAKING_TOKEN).safeTransfer(
                _recipient,
                info.amount
            );

            IVesting(COOL_DOWN_CONTRACT).retrieve(
                address(this),
                totalAmountIncludingRewards
            );
            withdrawalAmount -= info.amount;
        }
    }

    /**
        @notice gets reward tokens either from the warmup contract or user's wallet or both
        @dev when transfering reward tokens the user could have their balance still in the warmup contract
        @dev this function abstracts the logic to find the correct amount of tokens to use them
        @param _amount uint
        @param _user address to pull funds from 
     */
    function _retrieveBalanceFromUser(uint256 _amount, address _user) internal {
        Claim memory userWarmInfo = warmUpInfo[_user];
        uint256 walletBalance = IERC20Upgradeable(REWARD_TOKEN).balanceOf(
            _user
        );
        uint256 warmUpBalance = IRewardToken(REWARD_TOKEN).balanceForGons(
            userWarmInfo.gons
        );

        // must have enough funds between wallet and warmup
        require(
            _amount <= walletBalance + warmUpBalance,
            "Insufficient Balance"
        );

        uint256 amountLeft = _amount;
        if (warmUpBalance > 0) {
            // remove from warmup first.
            if (_amount >= warmUpBalance) {
                // use the entire warmup balance
                unchecked {
                    amountLeft -= warmUpBalance;
                }

                IVesting(WARM_UP_CONTRACT).retrieve(
                    address(this),
                    warmUpBalance
                );
                delete warmUpInfo[_user];
            } else {
                // partially consume warmup balance
                amountLeft = 0;
                IVesting(WARM_UP_CONTRACT).retrieve(address(this), _amount);
                uint256 remainingGonsAmount = userWarmInfo.gons -
                    IRewardToken(REWARD_TOKEN).gonsForBalance(_amount);
                uint256 remainingAmount = IRewardToken(REWARD_TOKEN)
                    .balanceForGons(remainingGonsAmount);

                warmUpInfo[_user] = Claim({
                    amount: remainingAmount,
                    gons: remainingGonsAmount,
                    expiry: userWarmInfo.expiry
                });
            }
        }

        if (amountLeft != 0) {
            // transfer the rest from the users address
            IERC20Upgradeable(REWARD_TOKEN).safeTransferFrom(
                _user,
                address(this),
                amountLeft
            );
        }
    }

    /**
        @notice figures out which unstake type is needed to instant unstake and then calls instantUnstakeByType
        @dev checks to see if enough balance exists in liquidity reserve, otherwise uses curve
        @param _amount uint - amount to instant unstake
     */
    function instantUnstakeReserve(uint256 _amount) external {
        // prevent unstaking if override due to vulnerabilities
        require(
            !isUnstakingPaused && !isInstantUnstakingPaused,
            "Unstaking is paused"
        );

        _retrieveBalanceFromUser(_amount, msg.sender);

        uint256 reserveBalance = IERC20Upgradeable(STAKING_TOKEN).balanceOf(
            LIQUIDITY_RESERVE
        );

        require(reserveBalance >= _amount, "Not enough funds in reserve");

        ILiquidityReserve(LIQUIDITY_RESERVE).instantUnstake(
            _amount,
            msg.sender
        );
    }

    /**
        @notice instant unstake from curve
        @param _amount uint - amount to instant unstake
        @param _minAmount uint - minimum amount with slippage to instant unstake
        @return uint - amount received
     */
    function instantUnstakeCurve(uint256 _amount, uint256 _minAmount)
        external
        returns (uint256)
    {
         require(
            CURVE_POOL != address(0) && (curvePoolFrom == 1 || curvePoolTo == 1),
            "Invalid Curve Pool"
        );
        // prevent unstaking if override due to vulnerabilities
        require(
            !isUnstakingPaused && !isInstantUnstakingPaused,
            "Unstaking is paused"
        );
        _retrieveBalanceFromUser(_amount, msg.sender);

        return
            ICurvePool(CURVE_POOL).exchange(
                curvePoolFrom,
                curvePoolTo,
                _amount,
                _minAmount,
                msg.sender
            );
    }

    /**
        @notice sets to and from coin indexes for curve exchange
     */
    function setToAndFromCurve() internal {
        if (CURVE_POOL != address(0)) {
            address address0 = ICurvePool(CURVE_POOL).coins(0);
            address address1 = ICurvePool(CURVE_POOL).coins(1);
            int128 from = 0;
            int128 to = 0;

            if (TOKE_POOL == address0 && STAKING_TOKEN == address1) {
                to = 1;
            } else if (TOKE_POOL == address1 && STAKING_TOKEN == address0) {
                from = 1;
            }
            require(from == 1 || to == 1, "Invalid Curve Pool");

            curvePoolFrom = from;
            curvePoolTo = to;

            emit LogSetCurvePool(CURVE_POOL, curvePoolTo, curvePoolFrom);
        }
    }

    /**
        @notice estimate received using instant unstake from curve
        @param _amount uint - amount to instant unstake
        @return uint - estimated amount received
     */
    function estimateInstantCurve(uint256 _amount)
        external
        view
        returns (uint256)
    {
        return
            ICurvePool(CURVE_POOL).get_dy(curvePoolFrom, curvePoolTo, _amount);
    }

    /**
        @notice redeem reward tokens for staking tokens with a vesting period based on coolDownPeriod
        @dev this function will retrieve the _amount of reward tokens from the user and transfer them to the cooldown contract.
        @dev once the period has expired the user will be able to withdraw their staking tokens
        @param _amount uint - amount of tokens to unstake
        @param _trigger bool - should trigger a rebase
     */
    function unstake(uint256 _amount, bool _trigger) external {
        // prevent unstaking if override due to vulnerabilities asdf
        require(!isUnstakingPaused, "Unstaking is paused");
        if (_trigger) {
            rebase();
        }
        _retrieveBalanceFromUser(_amount, msg.sender);

        Claim storage userCoolInfo = coolDownInfo[msg.sender];

        // try to claim withdraw if user has withdraws to claim function will check if withdraw is valid
        claimWithdraw(msg.sender);

        coolDownInfo[msg.sender] = Claim({
            amount: userCoolInfo.amount + _amount,
            gons: userCoolInfo.gons +
                IRewardToken(REWARD_TOKEN).gonsForBalance(_amount),
            expiry: epoch.number + coolDownPeriod
        });

        requestWithdrawalAmount += _amount;
        sendWithdrawalRequests();

        IERC20Upgradeable(REWARD_TOKEN).safeTransfer(
            COOL_DOWN_CONTRACT,
            _amount
        );
    }

    /**
        @notice trigger rebase if epoch has ended
     */
    function rebase() public {
        // we know about the issues surrounding block.timestamp, using it here will not cause any problems
        if (epoch.endTime <= block.timestamp) {
            IRewardToken(REWARD_TOKEN).rebase(epoch.distribute, epoch.number);

            epoch.endTime = epoch.endTime + epoch.duration;
            epoch.timestamp = block.timestamp;
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
        @notice returns contract staking tokens holdings 
        @dev gets amount of staking tokens that are a part of this system to calculate rewards
        @dev the staking tokens will be included in this contract plus inside tokemak
        @return uint - amount of staking tokens
     */
    function contractBalance() internal view returns (uint256) {
        uint256 tokeBalance = _getTokemakBalance();
        return
            IERC20Upgradeable(STAKING_TOKEN).balanceOf(address(this)) +
            tokeBalance;
    }

    /**
     * @notice adds staking tokens for rebase rewards
     * @dev this is the function that gives rewards so the rebase function can distrubute profits to reward token holders
     * @param _amount uint - amount of tokens to add to rewards
     * @param _trigger bool - should trigger rebase
     */
    function addRewardsForStakers(uint256 _amount, bool _trigger) external {
        IERC20Upgradeable(STAKING_TOKEN).safeTransferFrom(
            msg.sender,
            address(this),
            _amount
        );

        // deposit all staking tokens held in contract to Tokemak minus tokens waiting for claimWithdraw
        uint256 stakingTokenBalance = IERC20Upgradeable(STAKING_TOKEN)
            .balanceOf(address(this));
        uint256 amountToDeposit = stakingTokenBalance - withdrawalAmount;
        _depositToTokemak(amountToDeposit);

        if (_trigger) {
            rebase();
        }
    }

    /**
     * @notice trades rewards generated from claimFromTokemak for staking token, then calls addRewardsForStakers
     * @dev this is function is called from claimFromTokemak if the autoRebase bool is set to true
     */
    function preSign(bytes calldata orderUid) external onlyOwner {
        ICowSettlement(COW_SETTLEMENT).setPreSignature(orderUid, true);
    }
}
