// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";

/// @notice Фид с историей раундов. Несуществующий раунд отваливается, как
///         настоящий прокси Chainlink, чтобы try/catch в пуле проверялся всерьёз.
contract MockFeed is IAggregatorV3 {
    struct Round {
        int256 answer;
        uint256 updatedAt;
    }

    uint8 private immutable _decimals;
    uint80 public latestRound;
    mapping(uint80 => Round) private _rounds;

    constructor(uint8 d) {
        _decimals = d;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function push(int256 answer, uint256 updatedAt) external returns (uint80) {
        latestRound += 1;
        _rounds[latestRound] = Round(answer, updatedAt);
        return latestRound;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = _rounds[latestRound];
        return (latestRound, r.answer, r.updatedAt, r.updatedAt, latestRound);
    }

    function getRoundData(uint80 roundId) external view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = _rounds[roundId];
        require(r.updatedAt != 0, "No data present");
        return (roundId, r.answer, r.updatedAt, r.updatedAt, roundId);
    }
}
