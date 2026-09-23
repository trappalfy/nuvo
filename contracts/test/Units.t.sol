// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Units} from "../src/libraries/Units.sol";

contract UnitsTest is Test {
    function test_toWadScalesSixDecimals() public pure {
        assertEq(Units.toWad(1_000_000, 6), 1e18);
    }

    function test_toWadLeavesEighteenDecimals() public pure {
        assertEq(Units.toWad(1e18, 18), 1e18);
    }

    function test_fromWadFloors() public pure {
        // 1.9999995 в WAD -> 1.999999 USDG: вниз, в пользу пула
        assertEq(Units.fromWad(1_999_999_500_000_000_000, 6), 1_999_999);
    }

    function test_roundTripNeverGrows() public pure {
        uint256 wad = Units.toWad(Units.fromWad(1_999_999_999_999_999_999, 6), 6);
        assertLe(wad, 1_999_999_999_999_999_999);
    }
}
