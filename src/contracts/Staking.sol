// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "hardhat/console.sol";
import "./Vesting.sol";
import "./types/Ownable.sol";

interface IRewardToken {
    function rebase(uint256 ohmProfit_, uint256 epoch_)
        external
        returns (uint256);

    function circulatingSupply() external view returns (uint256);

    function balanceOf(address who) external view returns (uint256);

    function gonsForBalance(uint256 amount) external view returns (uint256);

    function balanceForGons(uint256 gons) external view returns (uint256);

    function index() external view returns (uint256);
}

interface IVesting {
    function retrieve(address staker_, uint256 amount_) external;
}

struct Recipient {
    uint256 chainId;
    uint256 cycle;
    address wallet;
    uint256 amount;
}

interface ITokeReward {
    function getClaimableAmount(Recipient calldata recipient)
        external
        view
        returns (uint256);

    function claim(
        Recipient calldata recipient,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

interface ITokePool {
    function deposit(uint256 amount) external;

    function withdraw(uint256 amount) external;

    function requestWithdrawal(uint256 amount) external;

    function balanceOf(address owner) external view returns (uint256);
}

interface ITokeManager {
    function getCycleDuration() external view returns (uint256);

    function getCurrentCycle() external view returns (uint256); // named weird, this is start cycle timestamp

    function getCurrentCycleIndex() external view returns (uint256);

    function cycleRewardsHashes(uint256)
        external
        view
        returns (string calldata hash);
}

contract Staking is Ownable {
    using SafeERC20 for IERC20;

    address public immutable tokePool;
    address public immutable tokeManager;
    address public immutable tokeReward;
    address public immutable stakingToken;
    address public immutable rewardToken;

    struct Epoch {
        uint256 length;
        uint256 number;
        uint256 endBlock;
        uint256 distribute;
    }
    Epoch public epoch;

    struct Claim {
        uint256 amount;
        uint256 gons;
        uint256 expiry;
        bool lock; // prevents malicious delays
    }
    mapping(address => Claim) public warmupInfo;
    mapping(address => Claim) public cooldownInfo;

    address public immutable warmupContract;
    address public immutable cooldownContract;
    uint256 public warmupPeriod;
    uint256 public lastUpdatedTokemakCycle;
    uint256 public requestWithdrawalAmount;
    uint256 public lastTokeCycleIndex;

    constructor(
        address _stakingToken,
        address _rewardToken,
        address _tokePool,
        address _tokeManager,
        address _tokeReward,
        uint256 _epochLength,
        uint256 _firstEpochNumber,
        uint256 _firstEpochBlock
    ) {
        require(_stakingToken != address(0));
        stakingToken = _stakingToken;
        require(_rewardToken != address(0));
        rewardToken = _rewardToken;
        require(_tokePool != address(0));
        tokePool = _tokePool;
        require(_tokeManager != address(0));
        tokeManager = _tokeManager;
        require(_tokeReward != address(0));
        tokeReward = _tokeReward;

        Vesting warmUp = new Vesting(address(this), rewardToken);
        warmupContract = address(warmUp);

        Vesting coolDown = new Vesting(address(this), rewardToken);
        cooldownContract = address(coolDown);

        IERC20(stakingToken).approve(tokePool, type(uint256).max);

        epoch = Epoch({
            length: _epochLength,
            number: _firstEpochNumber,
            endBlock: _firstEpochBlock,
            distribute: 0
        });
    }

    /**
        @notice claim TOKE from Tokemak
     */
    function claimFromTokemak(
        address wallet,
        uint256 amount,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public onlyManager {
        ITokeReward tokeRewardContract = ITokeReward(tokeReward);
        ITokeManager iTokeManager = ITokeManager(tokeManager);
        uint256 currentCycle = iTokeManager.getCurrentCycleIndex();
        Recipient memory recipient = Recipient({
            chainId: 1,
            cycle: currentCycle - 1,
            wallet: wallet,
            amount: amount
        });
        tokeRewardContract.claim(recipient, v, r, s);
    }

    /**
        @notice get claimable amount of TOKE from Tokemak
     */
    function getClaimableAmountTokemak(Recipient memory recipient)
        public
        view
        returns (uint256)
    {
        ITokeReward tokeRewardContract = ITokeReward(tokeReward);
        uint256 amount = tokeRewardContract.getClaimableAmount(recipient);
        return amount;
    }

    /**
        @notice get latest ipfs has from Tokemak
     */
    function getLastTokemakIpfsHash() public view returns (string memory) {
        ITokeManager iTokeManager = ITokeManager(tokeManager);
        uint256 currentCycle = iTokeManager.getCurrentCycleIndex();
        string memory hash = iTokeManager.cycleRewardsHashes(currentCycle - 1);
        return hash;
    }

    /**
        @notice checks to see if claim is available
        @param info Claim
        @return bool
     */
    function isClaimAvailable(Claim memory info) internal view returns (bool) {
        return epoch.number >= info.expiry && info.expiry != 0;
    }

    /**
        @notice withdraw from Tokemak
        @param _amount uint
     */
    function withdrawFromTokemak(uint256 _amount) internal {
        ITokePool tokePoolContract = ITokePool(tokePool);
        tokePoolContract.withdraw(_amount);
    }

    /**
        @notice creates a withdrawRequest with Tokemak
        @param _amount uint
     */
    function requestWithdrawalFromTokemak(uint256 _amount) internal {
        ITokePool tokePoolContract = ITokePool(tokePool);
        tokePoolContract.requestWithdrawal(_amount);
        // TODO: TOKE requestWithdrawal function doesn't return anything.  Need to check for proper event emitted
    }

    /**
        @notice deposit stakingToken to tStakingToken Tokemak reactor
        @param _amount uint
     */
    function depositToTokemak(uint256 _amount) internal {
        ITokePool tokePoolContract = ITokePool(tokePool);
        tokePoolContract.deposit(_amount);
        // TODO: TOKE deposit function doesn't return anything.  Need to check for proper event emitted
    }

    /**
        @notice gets balance of stakingToken that's locked into the TOKE stakingToken pool
        @return uint
     */
    function getTokemakBalance() internal view returns (uint256) {
        ITokePool tokePoolContract = ITokePool(tokePool);
        return tokePoolContract.balanceOf(address(this)); // TODO: verify pending withdraws are a part of this
    }

    /**
        @notice checks TOKE's cycleTime is withink duration to batch the transactions
        @return bool
     */
    function canBatchTransactions() internal view returns (bool) {
        ITokeManager iTokeManager = ITokeManager(tokeManager);
        uint256 offset = 50; // amount of blocks before the next cycle to batch the withdrawal requests
        uint256 duration = iTokeManager.getCycleDuration();
        uint256 currentCycleStart = iTokeManager.getCurrentCycle();
        uint256 currentCycleIndex = iTokeManager.getCurrentCycleIndex();
        uint256 nextCycleStart = currentCycleStart + duration;
        return
            block.number + offset > nextCycleStart &&
            currentCycleIndex > lastTokeCycleIndex;
    }

    /**
        @notice sends batched requestedWithdrawals
     */
    function sendWithdrawalRequests() public {
        if (canBatchTransactions()) {
            ITokeManager iTokeManager = ITokeManager(tokeManager);
            uint256 currentCycleIndex = iTokeManager.getCurrentCycleIndex();
            lastTokeCycleIndex = currentCycleIndex;
            requestWithdrawalFromTokemak(requestWithdrawalAmount);
            requestWithdrawalAmount = 0;
        }
    }

    /**
        @notice stake stakingToken to enter warmup
        @param _amount uint
        @param _recipient address
     */
    function stake(uint256 _amount, address _recipient) public {
        rebase();
        IERC20(stakingToken).safeTransferFrom(
            msg.sender,
            address(this),
            _amount
        );

        Claim memory info = warmupInfo[_recipient];
        require(!info.lock, "Deposits for account are locked");

        warmupInfo[_recipient] = Claim({
            amount: info.amount + _amount,
            gons: info.gons + IRewardToken(rewardToken).gonsForBalance(_amount),
            expiry: epoch.number + warmupPeriod,
            lock: false
        });

        depositToTokemak(_amount);

        IERC20(rewardToken).safeTransfer(warmupContract, _amount);
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
    function claim(address _recipient) public {
        Claim memory info = warmupInfo[_recipient];
        if (isClaimAvailable(info)) {
            delete warmupInfo[_recipient];
            IVesting(warmupContract).retrieve(
                _recipient,
                IRewardToken(rewardToken).balanceForGons(info.gons)
            );
        }
    }

    /**
        @notice claims stakingToken after cooldown period
        @param _recipient address
     */
    function claimWithdraw(address _recipient) public {
        Claim memory info = cooldownInfo[_recipient];
        if (isClaimAvailable(info)) {
            uint256 amount = IRewardToken(rewardToken).balanceForGons(
                info.gons
            );
            withdrawFromTokemak(amount);
            IERC20(stakingToken).safeTransfer(_recipient, amount);
            delete cooldownInfo[_recipient];
            IVesting(cooldownContract).retrieve(_recipient, amount);
        }
    }

    /**
        @notice forfeit rewardToken in warmup and retrieve stakingToken
     */
    function forfeit() external {
        Claim memory info = warmupInfo[msg.sender];
        delete warmupInfo[msg.sender];

        IVesting(warmupContract).retrieve(
            address(this),
            IRewardToken(rewardToken).balanceForGons(info.gons)
        );
        IERC20(stakingToken).safeTransfer(msg.sender, info.amount);
    }

    /**
        @notice prevent new deposits to address (protection from malicious activity)
     */
    function toggleDepositLock() external {
        warmupInfo[msg.sender].lock = !warmupInfo[msg.sender].lock;
    }

    /**
        @notice redeem rewardToken for stakingToken
        @param _amount uint
        @param _trigger bool
     */
    function unstake(uint256 _amount, bool _trigger) external {
        if (_trigger) {
            rebase();
        }

        Claim memory userWarmInfo = warmupInfo[msg.sender];
        require(!userWarmInfo.lock, "Withdraws for account are locked");

        bool hasWarmupToken = userWarmInfo.amount >= _amount &&
            isClaimAvailable(userWarmInfo);

        if (hasWarmupToken) {
            uint256 newAmount = userWarmInfo.amount - _amount;
            require(newAmount >= 0, "Not enough funds");
            IVesting(warmupContract).retrieve(address(this), _amount);
            if (newAmount == 0) {
                delete warmupInfo[msg.sender];
            } else {
                warmupInfo[msg.sender] = Claim({
                    amount: newAmount,
                    gons: userWarmInfo.gons -
                        IRewardToken(rewardToken).gonsForBalance(_amount),
                    expiry: userWarmInfo.expiry,
                    lock: false
                });
            }
        } else {
            IERC20(rewardToken).safeTransferFrom(
                msg.sender,
                address(this),
                _amount
            );
        }

        Claim memory userCoolInfo = cooldownInfo[msg.sender];
        require(!userCoolInfo.lock, "Withdrawals for account are locked");

        cooldownInfo[msg.sender] = Claim({
            amount: userCoolInfo.amount + _amount,
            gons: userCoolInfo.gons +
                IRewardToken(rewardToken).gonsForBalance(_amount),
            expiry: epoch.number + warmupPeriod,
            lock: false
        });

        requestWithdrawalAmount += _amount;
        sendWithdrawalRequests();

        IERC20(rewardToken).safeTransfer(cooldownContract, _amount);
    }

    /**
        @notice returns the rewardToken index, which tracks rebase growth
        @return uint
     */
    function index() public view returns (uint256) {
        return IRewardToken(rewardToken).index();
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
        uint256 tokeBalance = getTokemakBalance();
        return IERC20(stakingToken).balanceOf(address(this)) + tokeBalance;
    }

    /**
     * @notice set warmup period for new stakers
     * @param _warmupPeriod uint
     */
    function setWarmup(uint256 _warmupPeriod) external onlyManager {
        warmupPeriod = _warmupPeriod;
    }

    function addRewardsForStakers(uint256 _amount, bool _isTriggerRebase)
        external
    {
        IERC20(stakingToken).safeTransferFrom(
            msg.sender,
            address(this),
            _amount
        );
        if (_isTriggerRebase) {
            rebase();
        }
    }
}
