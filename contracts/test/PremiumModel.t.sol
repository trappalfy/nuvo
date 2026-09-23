// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PremiumModel} from "../src/PremiumModel.sol";

contract PremiumModelTest is Test {
    PremiumModel internal model;

    function setUp() public {
        uint8[] memory dirs = new uint8[](4);
        uint16[] memory dist = new uint16[](4);
        uint16[] memory bps = new uint16[](4);
        (dirs[0], dist[0], bps[0]) = (0, 200, 120);
        (dirs[1], dist[1], bps[1]) = (0, 400, 85);
        (dirs[2], dist[2], bps[2]) = (1, 200, 110);
        (dirs[3], dist[3], bps[3]) = (1, 400, 80);
        model = new PremiumModel(dirs, dist, bps);
    }

    function test_returnsTheRateForAKnownRung() public view {
        assertEq(model.premiumBps(0, 200), 120);
        assertEq(model.premiumBps(1, 400), 80);
    }

    function test_unknownRungIsZero() public view {
        assertEq(model.premiumBps(0, 300), 0);
        assertEq(model.premiumBps(1, 9_999), 0);
    }

    function test_rejectsBadDirectionOnDeploy() public {
        uint8[] memory dirs = new uint8[](1);
        uint16[] memory dist = new uint16[](1);
        uint16[] memory bps = new uint16[](1);
        (dirs[0], dist[0], bps[0]) = (2, 200, 120);
        vm.expectRevert(PremiumModel.BadRate.selector);
        new PremiumModel(dirs, dist, bps);
    }

    function test_rejectsDistanceAtOrAboveHundredPercent() public {
        uint8[] memory dirs = new uint8[](1);
        uint16[] memory dist = new uint16[](1);
        uint16[] memory bps = new uint16[](1);
        (dirs[0], dist[0], bps[0]) = (0, 10_000, 120);
        vm.expectRevert(PremiumModel.BadRate.selector);
        new PremiumModel(dirs, dist, bps);
    }
}
