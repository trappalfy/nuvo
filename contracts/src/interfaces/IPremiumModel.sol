// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IPremiumModel {
    /// @param direction 0 — Buy Low, 1 — Sell High
    /// @param distanceBps расстояние до цели от текущей цены, в сотых долях процента
    /// @return премия за неделю в bps; 0 значит, что рунга нет в продаже
    function premiumBps(uint8 direction, uint16 distanceBps) external view returns (uint16);
}
