// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {INuvoPoolFactory} from "./interfaces/INuvoPoolFactory.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {NuvoPool} from "./NuvoPool.sol";

/// @notice Реестр пулов и календарь экспираций. Пул, созданный не отсюда,
///         протоколом не считается: сайт читает список только у фабрики.
contract NuvoPoolFactory is Ownable2Step, INuvoPoolFactory {
    address public immutable usdg;

    address[] public pools;
    mapping(address => address) public poolOf;
    uint64[] public expiries;

    error PoolExists();
    error FeedNotLive();
    error WrongUsdg();
    error WrongFactory();
    error NotIncreasing();
    error TooManyDecimals();

    event PoolCreated(address indexed token, address indexed pool);
    event ExpiriesAdded(uint256 count, uint64 last);

    constructor(address usdg_, address owner_) Ownable(owner_) {
        usdg = usdg_;
    }

    function createPool(NuvoPool.Params calldata p) external onlyOwner returns (address pool) {
        if (p.usdg != usdg) revert WrongUsdg();
        if (p.factory != address(this)) revert WrongFactory();
        if (poolOf[p.token] != address(0)) revert PoolExists();
        if (IERC20Metadata(p.token).decimals() > 18) revert TooManyDecimals();

        // Живой фид — условие создания пула: без цены нельзя ни подписать, ни рассчитать.
        (, int256 answer,, uint256 updatedAt,) = IAggregatorV3(p.feed).latestRoundData();
        if (answer <= 0 || updatedAt == 0) revert FeedNotLive();

        pool = address(new NuvoPool(p));
        poolOf[p.token] = pool;
        pools.push(pool);
        emit PoolCreated(p.token, pool);
    }

    /// @notice Публикуем отметки времени экспираций заранее, на месяцы вперёд.
    ///         Список только растёт и только вперёд: сдвинуть уже объявленную
    ///         экспирацию нельзя, иначе открытые позиции поехали бы.
    function addExpiries(uint64[] calldata list) external onlyOwner {
        uint64 last = expiries.length > 0 ? expiries[expiries.length - 1] : uint64(block.timestamp);
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] <= last) revert NotIncreasing();
            expiries.push(list[i]);
            last = list[i];
        }
        emit ExpiriesAdded(list.length, last);
    }

    /// @notice Первая экспирация, до которой осталось строго больше minLead секунд.
    function nextExpiry(uint64 minLead) external view returns (uint64) {
        uint64 threshold = uint64(block.timestamp) + minLead;
        uint256 lo = 0;
        uint256 hi = expiries.length;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (expiries[mid] > threshold) hi = mid;
            else lo = mid + 1;
        }
        return lo < expiries.length ? expiries[lo] : 0;
    }

    function poolCount() external view returns (uint256) {
        return pools.length;
    }

    function expiryCount() external view returns (uint256) {
        return expiries.length;
    }
}
