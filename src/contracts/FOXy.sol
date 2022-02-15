// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

import "../libraries/ERC20Permit.sol";
import "../libraries/Ownable.sol";

contract Foxy is ERC20Permit, Ownable {
    modifier onlyStakingContract() {
        require(msg.sender == stakingContract);
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

    uint256 private constant MAX_UINT256 = ~uint256(0);
    uint256 private constant INITIAL_FRAGMENTS_SUPPLY = 5000000 * 10**18;

    // TOTAL_GONS is a multiple of INITIAL_FRAGMENTS_SUPPLY so that gonsPerFragment is an integer.
    // Use the highest value that fits in a uint256 for max granularity.
    uint256 private constant TOTAL_GONS =
        MAX_UINT256 - (MAX_UINT256 % INITIAL_FRAGMENTS_SUPPLY);

    // MAX_SUPPLY = maximum integer < (sqrt(4*TOTAL_GONS + 1) - 1) / 2
    uint256 private constant MAX_SUPPLY = ~uint128(0); // (2^128) - 1

    uint256 private gonsPerFragment;
    mapping(address => uint256) private gonBalances;

    mapping(address => mapping(address => uint256)) private allowedValue;

    constructor() ERC20("FOX Yield", "FOXy", 18) ERC20Permit() {
        initializer = msg.sender;
        _totalSupply = INITIAL_FRAGMENTS_SUPPLY;
        gonsPerFragment = TOTAL_GONS / _totalSupply;
    }

    function initialize(address _stakingContract) external returns (bool) {
        require(msg.sender == initializer);
        require(_stakingContract != address(0));
        stakingContract = _stakingContract;
        gonBalances[stakingContract] = TOTAL_GONS;

        emit Transfer(address(0x0), stakingContract, _totalSupply);

        initializer = address(0);
        return true;
    }

    function setIndex(uint256 _index) external onlyOwner returns (bool) {
        require(index == 0);
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
        require(_previousCirculating > 0, "");
        
        uint256 rebasePercent = (_profit * 1e18) / _previousCirculating;

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

    function balanceOf(address _wallet) public view override returns (uint256) {
        return gonBalances[_wallet] / gonsPerFragment;
    }

    function gonsForBalance(uint256 _amount) public view returns (uint256) {
        return _amount * gonsPerFragment;
    }

    function balanceForGons(uint256 _gons) public view returns (uint256) {
        return _gons / gonsPerFragment;
    }

    // Staking contract holds excess FOXy
    function circulatingSupply() public view returns (uint256) {
        return _totalSupply - balanceOf(stakingContract);
    }

    function getIndex() public view returns (uint256) {
        return balanceForGons(index);
    }

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

    function allowance(address _owner, address _spender)
        public
        view
        override
        returns (uint256)
    {
        return allowedValue[_owner][_spender];
    }

    function transferFrom(
        address _from,
        address _to,
        uint256 _value
    ) public override returns (bool) {
        allowedValue[_from][msg.sender] =
            allowedValue[_from][msg.sender] -
            _value;
        emit Approval(_from, msg.sender, allowedValue[_from][msg.sender]);

        uint256 gonValue = gonsForBalance(_value);
        gonBalances[_from] = gonBalances[_from] - gonValue;
        gonBalances[_to] = gonBalances[_to] + gonValue;
        emit Transfer(_from, _to, _value);

        return true;
    }

    function approve(address _spender, uint256 _value)
        public
        override
        returns (bool)
    {
        allowedValue[msg.sender][_spender] = _value;
        emit Approval(msg.sender, _spender, _value);
        return true;
    }

    // What gets called in a permit
    function _approve(
        address _owner,
        address _spender,
        uint256 _value
    ) internal virtual override {
        allowedValue[_owner][_spender] = _value;
        emit Approval(_owner, _spender, _value);
    }

    function increaseAllowance(address _spender, uint256 _addedValue)
        public
        override
        returns (bool)
    {
        allowedValue[msg.sender][_spender] =
            allowedValue[msg.sender][_spender] +
            _addedValue;
        emit Approval(msg.sender, _spender, allowedValue[msg.sender][_spender]);
        return true;
    }

    function decreaseAllowance(address _spender, uint256 _subtractedValue)
        public
        override
        returns (bool)
    {
        uint256 oldValue = allowedValue[msg.sender][_spender];
        if (_subtractedValue >= oldValue) {
            allowedValue[msg.sender][_spender] = 0;
        } else {
            allowedValue[msg.sender][_spender] = oldValue - _subtractedValue;
        }
        emit Approval(msg.sender, _spender, allowedValue[msg.sender][_spender]);
        return true;
    }
}
