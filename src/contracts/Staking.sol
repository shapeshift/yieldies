// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.11;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "hardhat/console.sol";
import "./Vesting.sol";

interface IOwnable {
    function manager() external view returns (address);

    function renounceManagement() external;

    function pushManagement(address newOwner_) external;

    function pullManagement() external;
}

contract Ownable is IOwnable {
    address internal _owner;
    address internal _newOwner;

    event OwnershipPushed(
        address indexed previousOwner,
        address indexed newOwner
    );
    event OwnershipPulled(
        address indexed previousOwner,
        address indexed newOwner
    );

    constructor() {
        _owner = msg.sender;
        emit OwnershipPushed(address(0), _owner);
    }

    function manager() public view override returns (address) {
        return _owner;
    }

    modifier onlyManager() {
        require(_owner == msg.sender, "Ownable: caller is not the owner");
        _;
    }

    function renounceManagement() public virtual override onlyManager {
        emit OwnershipPushed(_owner, address(0));
        _owner = address(0);
    }

    function pushManagement(address newOwner_)
        public
        virtual
        override
        onlyManager
    {
        require(
            newOwner_ != address(0),
            "Ownable: new owner is the zero address"
        );
        emit OwnershipPushed(_owner, newOwner_);
        _newOwner = newOwner_;
    }

    function pullManagement() public virtual override {
        require(msg.sender == _newOwner, "Ownable: must be new owner to pull");
        emit OwnershipPulled(_owner, _newOwner);
        _owner = _newOwner;
    }
}

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

interface ITokePool {
    function deposit(uint256 amount) external;

    function withdraw(uint256 amount) external;

    function requestWithdrawal(uint256 amount) external;

    function balanceOf(address owner) external view returns (uint256);
}

contract Staking is Ownable {
    using SafeERC20 for IERC20;

    // TODO: what if tFOX pool address is updated, we should allow this to be updated as well
    address public immutable tokePool;
    address public immutable stakingToken;
    address public immutable rewardToken;

    struct Epoch {
        uint256 length;
        uint256 number;
        uint256 endBlock;
        uint256 distribute;
    }
    Epoch public epoch;

    address public immutable warmupContract;
    address public immutable cooldownContract;
    uint256 public warmupPeriod;

    constructor(
        address _stakingToken,
        address _rewardToken,
        address _tokePool,
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

    struct Claim {
        uint256 amount;
        uint256 gons;
        uint256 expiry;
        bool lock; // prevents malicious delays
    }
    mapping(address => Claim) public warmupInfo;
    mapping(address => Claim) public cooldownInfo;

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

        requestWithdrawalFromTokemak(_amount);
        // TODO: Verify Withdraw request
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
