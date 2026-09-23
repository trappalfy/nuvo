// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPremiumModel} from "./interfaces/IPremiumModel.sol";

/// @notice Таблица недельных премий, заданная при деплое. Менять нечего:
///         новая сетка ставок — новый контракт, который пул принимает с задержкой.
contract PremiumModel is IPremiumModel {
    uint16 public constant MAX_BPS = 5_000;

    error BadRate();
    error LengthMismatch();

    mapping(uint8 => mapping(uint16 => uint16)) private _rate;

    constructor(uint8[] memory directions, uint16[] memory distances, uint16[] memory bps) {
        if (directions.length != distances.length || distances.length != bps.length) revert LengthMismatch();
        for (uint256 i = 0; i < directions.length; i++) {
            if (directions[i] > 1) revert BadRate();
            if (distances[i] == 0 || distances[i] >= 10_000) revert BadRate();
            if (bps[i] == 0 || bps[i] > MAX_BPS) revert BadRate();
            _rate[directions[i]][distances[i]] = bps[i];
        }
    }

    function premiumBps(uint8 direction, uint16 distanceBps) external view returns (uint16) {
        return _rate[direction][distanceBps];
    }
}
