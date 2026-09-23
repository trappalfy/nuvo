// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Перевод между базовыми единицами токена и внутренним WAD (1e18).
/// @dev Суммы протокола укладываются в 1e30, поэтому произведения в WAD далеки
///      от переполнения uint256 и считаются без mulDiv с полной точностью.
library Units {
    uint256 internal constant WAD = 1e18;

    error TooManyDecimals();

    function toWad(uint256 amount, uint8 decimals) internal pure returns (uint256) {
        if (decimals > 18) revert TooManyDecimals();
        return amount * (10 ** (18 - decimals));
    }

    /// @dev Вниз: недостача от округления остаётся в пуле, а не у пользователя.
    function fromWad(uint256 wad, uint8 decimals) internal pure returns (uint256) {
        if (decimals > 18) revert TooManyDecimals();
        return wad / (10 ** (18 - decimals));
    }
}
