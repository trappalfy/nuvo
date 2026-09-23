// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NuvoPool} from "../src/NuvoPool.sol";
import {NuvoPoolFactory} from "../src/NuvoPoolFactory.sol";
import {PremiumModel} from "../src/PremiumModel.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockFeed} from "./mocks/MockFeed.sol";

contract FactoryTest is Test {
    MockERC20 internal usdg;
    MockERC20 internal stock;
    MockFeed internal feed;
    PremiumModel internal model;
    NuvoPoolFactory internal factory;
    address internal owner = address(0xA11CE);

    function setUp() public {
        vm.warp(1_800_000_000);
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        stock = new MockERC20("Tokenized NVDA", "NVDA", 18);
        feed = new MockFeed(8);
        feed.push(100e8, block.timestamp);

        uint8[] memory dirs = new uint8[](1);
        uint16[] memory dist = new uint16[](1);
        uint16[] memory bps = new uint16[](1);
        (dirs[0], dist[0], bps[0]) = (0, 200, 120);
        model = new PremiumModel(dirs, dist, bps);

        factory = new NuvoPoolFactory(address(usdg), owner);
    }

    function _params(address token, address feed_) internal view returns (NuvoPool.Params memory) {
        return NuvoPool.Params({
            usdg: address(usdg),
            token: token,
            feed: feed_,
            premiumModel: address(model),
            factory: address(factory),
            owner: owner,
            guardian: owner,
            maxPremiumBps: 1_000,
            maxPriceAge: 80 hours,
            maxPriceAgeSettle: 6 hours,
            minDepositValueWad: 100e18,
            maxPositionValueWad: 50_000e18,
            maxExpiryLockValueWad: 500_000e18,
            maxLockedShareBps: 8_000
        });
    }

    function test_createsAPoolAndRegistersIt() public {
        vm.prank(owner);
        address pool = factory.createPool(_params(address(stock), address(feed)));
        assertEq(factory.poolOf(address(stock)), pool);
        assertEq(factory.poolCount(), 1);
        assertEq(factory.pools(0), pool);
        assertEq(address(NuvoPool(pool).factory()), address(factory));
        assertEq(NuvoPool(pool).owner(), owner);
    }

    function test_refusesASecondPoolForTheSameToken() public {
        vm.startPrank(owner);
        factory.createPool(_params(address(stock), address(feed)));
        vm.expectRevert(NuvoPoolFactory.PoolExists.selector);
        factory.createPool(_params(address(stock), address(feed)));
        vm.stopPrank();
    }

    function test_refusesADeadFeed() public {
        MockFeed dead = new MockFeed(8);
        vm.prank(owner);
        vm.expectRevert(NuvoPoolFactory.FeedNotLive.selector);
        factory.createPool(_params(address(stock), address(dead)));
    }

    function test_refusesAForeignUsdg() public {
        MockERC20 fake = new MockERC20("Fake", "FAKE", 6);
        NuvoPool.Params memory p = _params(address(stock), address(feed));
        p.usdg = address(fake);
        vm.prank(owner);
        vm.expectRevert(NuvoPoolFactory.WrongUsdg.selector);
        factory.createPool(p);
    }

    function test_refusesAPoolPointingAtAnotherFactory() public {
        NuvoPool.Params memory p = _params(address(stock), address(feed));
        p.factory = address(0xdead);
        vm.prank(owner);
        vm.expectRevert(NuvoPoolFactory.WrongFactory.selector);
        factory.createPool(p);
    }

    function test_onlyTheOwnerCreatesPools() public {
        vm.expectRevert();
        factory.createPool(_params(address(stock), address(feed)));
    }

    function test_calendarIsPublishedAheadAndOnlyGrows() public {
        uint64[] memory list = new uint64[](3);
        list[0] = uint64(block.timestamp + 2 days);
        list[1] = uint64(block.timestamp + 9 days);
        list[2] = uint64(block.timestamp + 16 days);
        vm.prank(owner);
        factory.addExpiries(list);
        assertEq(factory.expiryCount(), 3);
        assertEq(factory.expiries(1), list[1]);

        uint64[] memory backwards = new uint64[](1);
        backwards[0] = uint64(block.timestamp + 10 days);
        vm.prank(owner);
        vm.expectRevert(NuvoPoolFactory.NotIncreasing.selector);
        factory.addExpiries(backwards);
    }

    function test_nextExpirySkipsTheOneInsideTheLead() public {
        uint64[] memory list = new uint64[](2);
        list[0] = uint64(block.timestamp + 2 days);
        list[1] = uint64(block.timestamp + 9 days);
        vm.prank(owner);
        factory.addExpiries(list);

        assertEq(factory.nextExpiry(24 hours), list[0]);
        vm.warp(list[0] - 24 hours); // ровно отсечка
        assertEq(factory.nextExpiry(24 hours), list[1]);
        vm.warp(list[1] + 1);
        assertEq(factory.nextExpiry(24 hours), 0, "the calendar has run out");
    }

    function test_rejectsAnExpiryInThePast() public {
        uint64[] memory list = new uint64[](1);
        list[0] = uint64(block.timestamp - 1);
        vm.prank(owner);
        vm.expectRevert(NuvoPoolFactory.NotIncreasing.selector);
        factory.addExpiries(list);
    }
}
