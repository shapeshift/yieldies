// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.11;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "hardhat/console.sol";
import "./Vesting.sol";

library SafeMath {
    /**
     * @dev Returns the addition of two unsigned integers, reverting on
     * overflow.
     *
     * Counterpart to Solidity's `+` operator.
     *
     * Requirements:
     *
     * - Addition cannot overflow.
     */
    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 c = a + b;
        require(c >= a, "SafeMath: addition overflow");

        return c;
    }

    /**
     * @dev Returns the subtraction of two unsigned integers, reverting on
     * overflow (when the result is negative).
     *
     * Counterpart to Solidity's `-` operator.
     *
     * Requirements:
     *
     * - Subtraction cannot overflow.
     */
    function sub(uint256 a, uint256 b) internal pure returns (uint256) {
        return sub(a, b, "SafeMath: subtraction overflow");
    }

    /**
     * @dev Returns the subtraction of two unsigned integers, reverting with custom message on
     * overflow (when the result is negative).
     *
     * Counterpart to Solidity's `-` operator.
     *
     * Requirements:
     *
     * - Subtraction cannot overflow.
     */
    function sub(
        uint256 a,
        uint256 b,
        string memory errorMessage
    ) internal pure returns (uint256) {
        require(b <= a, errorMessage);
        uint256 c = a - b;

        return c;
    }

    /**
     * @dev Returns the multiplication of two unsigned integers, reverting on
     * overflow.
     *
     * Counterpart to Solidity's `*` operator.
     *
     * Requirements:
     *
     * - Multiplication cannot overflow.
     */
    function mul(uint256 a, uint256 b) internal pure returns (uint256) {
        // Gas optimization: this is cheaper than requiring 'a' not being zero, but the
        // benefit is lost if 'b' is also tested.
        // See: https://github.com/OpenZeppelin/openzeppelin-contracts/pull/522
        if (a == 0) {
            return 0;
        }

        uint256 c = a * b;
        require(c / a == b, "SafeMath: multiplication overflow");

        return c;
    }

    /**
     * @dev Returns the integer division of two unsigned integers. Reverts on
     * division by zero. The result is rounded towards zero.
     *
     * Counterpart to Solidity's `/` operator. Note: this function uses a
     * `revert` opcode (which leaves remaining gas untouched) while Solidity
     * uses an invalid opcode to revert (consuming all remaining gas).
     *
     * Requirements:
     *
     * - The divisor cannot be zero.
     */
    function div(uint256 a, uint256 b) internal pure returns (uint256) {
        return div(a, b, "SafeMath: division by zero");
    }

    /**
     * @dev Returns the integer division of two unsigned integers. Reverts with custom message on
     * division by zero. The result is rounded towards zero.
     *
     * Counterpart to Solidity's `/` operator. Note: this function uses a
     * `revert` opcode (which leaves remaining gas untouched) while Solidity
     * uses an invalid opcode to revert (consuming all remaining gas).
     *
     * Requirements:
     *
     * - The divisor cannot be zero.
     */
    function div(
        uint256 a,
        uint256 b,
        string memory errorMessage
    ) internal pure returns (uint256) {
        require(b > 0, errorMessage);
        uint256 c = a / b;
        assert(a == b * c + (a % b)); // There is no case in which this doesn't hold

        return c;
    }
}

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

interface IFOXy {
    function rebase(uint256 ohmProfit_, uint256 epoch_)
        external
        returns (uint256);

    function circulatingSupply() external view returns (uint256);

    function balanceOf(address who) external view returns (uint256);

    function gonsForBalance(uint256 amount) external view returns (uint256);

    function balanceForGons(uint256 gons) external view returns (uint256);

    function index() external view returns (uint256);
}

interface IWarmup {
    function retrieve(address staker_, uint256 amount_) external;
}

interface ITokePool {
    function deposit(uint256 amount) external;

    function requestWithdrawal(uint256 amount) external;

    function balanceOf(address owner) external view returns (uint256);
}

contract FoxStaking is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // TODO: what if tFOX pool address is updated, we should allow this to be updated as well
    address public immutable tokePool;
    address public immutable FOX;
    address public immutable FOXy;

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
        address _FOX,
        address _FOXy,
        address _TokePool,
        uint256 _epochLength,
        uint256 _firstEpochNumber,
        uint256 _firstEpochBlock
    ) {
        require(_FOX != address(0));
        FOX = _FOX;
        require(_FOXy != address(0));
        FOXy = _FOXy;
        require(_TokePool != address(0));
        tokePool = _TokePool;

        Vesting warmup = new Vesting(address(this), FOXy);
        warmupContract = address(warmup);

        Vesting cooldown = new Vesting(address(this), FOXy);
        cooldownContract = address(cooldown);

        IERC20(FOX).approve(tokePool, type(uint256).max);

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
        @notice creates a withdrawRequest with Tokemak
        @param _amount uint
     */
    function requestWithdrawalFromTokemak(uint256 _amount) internal {
        ITokePool tokePoolContract = ITokePool(tokePool);
        tokePoolContract.requestWithdrawal(_amount);
        // TODO: TOKE requestWithdrawal function doesn't return anything.  Need to check for proper event emitted
    }

    /**
        @notice deposit FOX to tFOX Tokemak reactor
        @param _amount uint
     */
    function depositToTokemak(uint256 _amount) internal {
        ITokePool tokePoolContract = ITokePool(tokePool);
        tokePoolContract.deposit(_amount);
        // TODO: TOKE deposit function doesn't return anything.  Need to check for proper event emitted
    }

    /**
        @notice gets balance of FOX that's locked into the TOKE FOX pool
        @return uint
     */
    function getTokemakFoxBalance() internal view returns (uint256) {
        ITokePool tokePoolContract = ITokePool(tokePool);
        return tokePoolContract.balanceOf(address(this)); // TODO: verify pending withdraws are a part of this
    }

    /**
        @notice stake FOX to enter warmup
        @param _amount uint
        @param _recipient address
     */
    function stake(uint256 _amount, address _recipient) public {
        rebase();
        IERC20(FOX).safeTransferFrom(msg.sender, address(this), _amount);

        Claim memory info = warmupInfo[_recipient];
        require(!info.lock, "Deposits for account are locked");

        warmupInfo[_recipient] = Claim({
            amount: info.amount.add(_amount),
            gons: info.gons.add(IFOXy(FOXy).gonsForBalance(_amount)),
            expiry: epoch.number.add(warmupPeriod),
            lock: false
        });
        depositToTokemak(_amount);

        IERC20(FOXy).safeTransfer(warmupContract, _amount);
    }

    /**
        @notice stake FOX to enter warmup
        @param _amount uint
     */
    function stake(uint256 _amount) external {
        stake(_amount, msg.sender);
    }

    /**
        @notice retrieve FOXy from warmup
        @param _recipient address
     */
    function claim(address _recipient) public {
        Claim memory info = warmupInfo[_recipient];
        if (epoch.number >= info.expiry && info.expiry != 0) {
            delete warmupInfo[_recipient];
            IWarmup(warmupContract).retrieve(
                _recipient,
                IFOXy(FOXy).balanceForGons(info.gons)
            );
        }
    }

    /**
        @notice forfeit FOXy in warmup and retrieve FOX
     */
    function forfeit() external {
        Claim memory info = warmupInfo[msg.sender];
        delete warmupInfo[msg.sender];

        IWarmup(warmupContract).retrieve(
            address(this),
            IFOXy(FOXy).balanceForGons(info.gons)
        );
        IERC20(FOX).safeTransfer(msg.sender, info.amount);
    }

    /**
        @notice prevent new deposits to address (protection from malicious activity)
     */
    function toggleDepositLock() external {
        warmupInfo[msg.sender].lock = !warmupInfo[msg.sender].lock;
    }

    /**
        @notice redeem FOXy for FOX
        @param _amount uint
        @param _trigger bool
     */
    function unstake(uint256 _amount, bool _trigger) external {
        if (_trigger) {
            rebase();
        }

        Claim memory userWarmInfo = warmupInfo[msg.sender];
        require(!userWarmInfo.lock, "Withdraws for account are locked");

        bool hasWarmupFoxy = userWarmInfo.amount >= _amount;

        // if user has warmup claim amount use the FOXy from warmupContract
        address claimAddress = hasWarmupFoxy ? warmupContract : msg.sender;

        console.log("claimAddress", claimAddress);
        IERC20(FOXy).safeTransferFrom(claimAddress, address(this), _amount);

        if (hasWarmupFoxy) {
            uint256 newAmount = userWarmInfo.amount.sub(_amount);
            require(newAmount >= 0, "Withdraws for account are locked");

            if (newAmount == 0) {
                delete warmupInfo[msg.sender];
            } else {
                warmupInfo[msg.sender] = Claim({
                    amount: newAmount,
                    gons: userWarmInfo.gons.sub(IFOXy(FOXy).gonsForBalance(_amount)),
                    expiry: userWarmInfo.expiry,
                    lock: false
                });
            }
        }

        Claim memory userCoolInfo = cooldownInfo[msg.sender];
        require(!userCoolInfo.lock, "Withdrawals for account are locked");

        cooldownInfo[msg.sender] = Claim({
            amount: userCoolInfo.amount.add(_amount),
            gons: userCoolInfo.gons.add(IFOXy(FOXy).gonsForBalance(_amount)),
            expiry: epoch.number.add(warmupPeriod),
            lock: false
        });

        requestWithdrawalFromTokemak(_amount);
        // TODO: Verify Withdraw request
        IERC20(FOXy).safeTransfer(cooldownContract, _amount);
    }

    /**
        @notice returns the FOXy index, which tracks rebase growth
        @return uint
     */
    function index() public view returns (uint256) {
        return IFOXy(FOXy).index();
    }

    /**
        @notice trigger rebase if epoch over
     */
    function rebase() public {
        if (epoch.endBlock <= block.number) {
            IFOXy(FOXy).rebase(epoch.distribute, epoch.number);

            epoch.endBlock = epoch.endBlock.add(epoch.length);
            epoch.number++;

            uint256 balance = contractBalance();
            uint256 staked = IFOXy(FOXy).circulatingSupply();

            if (balance <= staked) {
                epoch.distribute = 0;
            } else {
                epoch.distribute = balance.sub(staked);
            }
        }
    }

    /**
        @notice returns contract FOX holdings
        @return uint
     */
    function contractBalance() public view returns (uint256) {
        uint256 tokeFoxBalance = getTokemakFoxBalance();
        return IERC20(FOX).balanceOf(address(this)) + tokeFoxBalance;
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
        IERC20(FOX).safeTransferFrom(msg.sender, address(this), _amount);
        if (_isTriggerRebase) {
            rebase();
        }
    }
}
