// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface INuvoPoolFactory {
    /// @notice Первая опубликованная экспирация, до которой осталось строго больше minLead секунд.
    /// @return 0, если календарь кончился.
    function nextExpiry(uint64 minLead) external view returns (uint64);
}
