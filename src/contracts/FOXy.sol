// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../libraries/ERC20Permit.sol";
import "../libraries/Ownable.sol";

contract Foxy is ERC20Permit, Ownable {
    // check if sender is the stakingContract
    modifier onlyStakingContract() {
        require(msg.sender == stakingContract, "Not staking contract");
        _;
    }

    address public stakingContract;
    address public initializer;

    event LogSupply(
        uint256 indexed epoch,
        uint256 timestamp,
        uint256 totalSupply
    );
    event LogRebase(uint256 indexed epoch, uint256 rebase, uint256 index);

    struct Rebase {
        uint256 epoch;
        uint256 rebase; // 18 decimals
        uint256 totalStakedBefore;
        uint256 totalStakedAfter;
        uint256 amountRebased;
        uint256 index;
        uint256 blockNumberOccurred;
    }
    Rebase[] public rebases;

    uint256 public index;

    uint256 private constant WAD = 1e18;
    uint256 private constant MAX_UINT256 = ~uint256(0);
    uint256 private constant INITIAL_FRAGMENTS_SUPPLY = 5000000 * WAD;

    // TOTAL_GONS is a multiple of INITIAL_FRAGMENTS_SUPPLY so that gonsPerFragment is an integer.
    // Use the highest value that fits in a uint256 for max granularity.
    uint256 private constant TOTAL_GONS =
        MAX_UINT256 - (MAX_UINT256 % INITIAL_FRAGMENTS_SUPPLY);

    // MAX_SUPPLY = maximum integer < (sqrt(4*TOTAL_GONS + 1) - 1) / 2
    uint256 private constant MAX_SUPPLY = ~uint128(0); // (2^128) - 1

    uint256 private gonsPerFragment;
    mapping(address => uint256) private gonBalances;

    mapping(address => mapping(address => uint256)) private allowedValue;

    constructor() ERC20("FOX Yield", "FOXy") ERC20Permit("FOX Yield") {
        initializer = msg.sender;
        _totalSupply = INITIAL_FRAGMENTS_SUPPLY;
        gonsPerFragment = TOTAL_GONS / _totalSupply;
    }

    /**
        @notice initialize gons and stakingContract
        @param _stakingContract address
        @return bool
     */
    function initialize(address _stakingContract) external returns (bool) {
        // check if initializer is msg.sender that was set in constructor
        require(msg.sender == initializer, "Must be called from initializer");
        // make sure _stakingContract isn't 0x0
        require(_stakingContract != address(0), "Invalid address");
        stakingContract = _stakingContract;
        gonBalances[stakingContract] = TOTAL_GONS;

        emit Transfer(address(0x0), stakingContract, _totalSupply);

        initializer = address(0);
        setIndex(WAD);
        return true;
    }

    /**
        @notice sets index to get the value of rebases from the beginning of the contract
        @param _index uint
        @return bool
     */
    function setIndex(uint256 _index) internal returns (bool) {
        index = gonsForBalance(_index);
        return true;
    }

    /**
        @notice increases FOXy supply to increase staking balances relative to profit_
        @param _profit uint256
        @return uint256
     */
    function rebase(uint256 _profit, uint256 _epoch)
        public
        onlyStakingContract
        returns (uint256)
    {
        uint256 rebaseAmount;
        uint256 circulatingSupply_ = circulatingSupply();

        if (_profit == 0) {
            emit LogSupply(_epoch, block.timestamp, _totalSupply);
            emit LogRebase(_epoch, 0, getIndex());
            return _totalSupply;
        } else if (circulatingSupply_ > 0) {
            rebaseAmount = (_profit * _totalSupply) / circulatingSupply_;
        } else {
            rebaseAmount = _profit;
        }

        _totalSupply = _totalSupply + rebaseAmount;

        if (_totalSupply > MAX_SUPPLY) {
            _totalSupply = MAX_SUPPLY;
        }

        gonsPerFragment = TOTAL_GONS / _totalSupply;

        _storeRebase(circulatingSupply_, _profit, _epoch);

        return _totalSupply;
    }

    /**
        @notice emits event with data about rebase
        @param _previousCirculating uint
        @param _profit uint
        @param _epoch uint
     */
    function _storeRebase(
        uint256 _previousCirculating,
        uint256 _profit,
        uint256 _epoch
    ) internal {
        // don't divide by 0
        require(_previousCirculating > 0, "Can't rebase if not circulating");

        uint256 rebasePercent = (_profit * WAD) / _previousCirculating;

        rebases.push(
            Rebase({
                epoch: _epoch,
                rebase: rebasePercent, // 18 decimals
                totalStakedBefore: _previousCirculating,
                totalStakedAfter: circulatingSupply(),
                amountRebased: _profit,
                index: getIndex(),
                blockNumberOccurred: block.number
            })
        );

        emit LogSupply(_epoch, block.timestamp, _totalSupply);
        emit LogRebase(_epoch, rebasePercent, getIndex());
    }

    /**
        @notice gets balanceOf FOXy
        @param _wallet address
        @return uint
     */
    function balanceOf(address _wallet) public view override returns (uint256) {
        return gonBalances[_wallet] / gonsPerFragment;
    }

    /**
        @notice calculate gons based on balance amount
        @param _amount uint
        @return uint
     */
    function gonsForBalance(uint256 _amount) public view returns (uint256) {
        return _amount * gonsPerFragment;
    }

    /**
        @notice calculate balance based on gons amount
        @param _gons uint
        @return uint
     */
    function balanceForGons(uint256 _gons) public view returns (uint256) {
        return _gons / gonsPerFragment;
    }

    /**
        @notice get circulating supply of tokens
        @return uint - circulation supply minus balance of staking contract
     */
    function circulatingSupply() public view returns (uint256) {
        // Staking contract holds excess FOXy
        return _totalSupply - balanceOf(stakingContract);
    }

    /**
        @notice get current index to show what how much FOXy the user would have
        @notice gained from the beginning
        @return uint
     */
    function getIndex() public view returns (uint256) {
        return balanceForGons(index);
    }

    /**
        @notice transfers to address with a certain amount
        @param _to address
        @param _value uint
        @return bool
     */
    function transfer(address _to, uint256 _value)
        public
        override
        returns (bool)
    {
        uint256 gonValue = _value * gonsPerFragment;
        gonBalances[msg.sender] = gonBalances[msg.sender] - gonValue;
        gonBalances[_to] = gonBalances[_to] + gonValue;
        emit Transfer(msg.sender, _to, _value);
        return true;
    }

    /**
        @notice gets allowance amount based on owner and spender
        @param _owner address
        @param _spender address
        @return uint
     */
    function allowance(address _owner, address _spender)
        public
        view
        override
        returns (uint256)
    {
        return allowedValue[_owner][_spender];
    }

    /**
        @notice transfer from address to address with amount
        @param _from address
        @param _to address
        @param _value uint
        @return bool
     */
    function transferFrom(
        address _from,
        address _to,
        uint256 _value
    ) public override returns (bool) {
        uint256 newValue = allowedValue[_from][msg.sender] - _value;
        allowedValue[_from][msg.sender] = newValue;
        emit Approval(_from, msg.sender, newValue);

        uint256 gonValue = gonsForBalance(_value);
        gonBalances[_from] = gonBalances[_from] - gonValue;
        gonBalances[_to] = gonBalances[_to] + gonValue;
        emit Transfer(_from, _to, _value);

        return true;
    }

    /**
        @notice approve spender for amount
        @param _spender address
        @param _value uint
        @return bool
     */
    function approve(address _spender, uint256 _value)
        public
        override
        returns (bool)
    {
        allowedValue[msg.sender][_spender] = _value;
        emit Approval(msg.sender, _spender, _value);
        return true;
    }

    /**
        @notice increase allowance by amount
        @param _spender address
        @param _addedValue uint
        @return bool
     */
    function increaseAllowance(address _spender, uint256 _addedValue)
        public
        override
        returns (bool)
    {
        uint256 newValue = allowedValue[msg.sender][_spender] + _addedValue;
        allowedValue[msg.sender][_spender] = newValue;
        emit Approval(msg.sender, _spender, newValue);
        return true;
    }

    /**
        @notice decrease allowance by amount
        @param _spender address
        @param _subtractedValue uint
        @return bool
     */
    function decreaseAllowance(address _spender, uint256 _subtractedValue)
        public
        override
        returns (bool)
    {
        uint256 oldValue = allowedValue[msg.sender][_spender];
        uint256 newValue = 0;
        if (_subtractedValue < oldValue) {
            newValue = oldValue - _subtractedValue;
        }
        allowedValue[msg.sender][_spender] = newValue;
        emit Approval(msg.sender, _spender, newValue);
        return true;
    }
}
