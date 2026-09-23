// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NuvoPool} from "../src/NuvoPool.sol";
import {PremiumModel} from "../src/PremiumModel.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockFeed} from "./mocks/MockFeed.sol";
import {MockFactory} from "./mocks/MockFactory.sol";

contract PoolSettleTest is Test {
    MockERC20 internal usdg;
    MockERC20 internal stock;
    MockFeed internal feed;
    MockFactory internal factory;
    NuvoPool internal pool;
    uint64 internal expiry;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        stock = new MockERC20("Tokenized NVDA", "NVDA", 18);
        feed = new MockFeed(8);
        factory = new MockFactory();

        uint8[] memory dirs = new uint8[](1);
        uint16[] memory dist = new uint16[](1);
        uint16[] memory bps = new uint16[](1);
        (dirs[0], dist[0], bps[0]) = (0, 200, 120);
        PremiumModel model = new PremiumModel(dirs, dist, bps);

        feed.push(100e8, block.timestamp);
        expiry = uint64(block.timestamp + 3 days);
        uint64[] memory list = new uint64[](1);
        list[0] = expiry;
        factory.setExpiries(list);

        pool = new NuvoPool(
            NuvoPool.Params({
                usdg: address(usdg),
                token: address(stock),
                feed: address(feed),
                premiumModel: address(model),
                factory: address(factory),
                owner: address(this),
                guardian: address(this),
                maxPremiumBps: 1_000,
                maxPriceAge: 80 hours,
                maxPriceAgeSettle: 6 hours,
                minDepositValueWad: 100e18,
                maxPositionValueWad: 50_000e18,
                maxExpiryLockValueWad: 500_000e18,
                maxLockedShareBps: 8_000
            })
        );

        // These suites test the pool itself, not who is let in.
        {
            address o_ = pool.owner();
            vm.prank(o_);
            pool.setAllowlist(false);
        }
    }

    function test_rejectsBeforeTheExpiry() public {
        vm.expectRevert(NuvoPool.NotExpired.selector);
        pool.settle(expiry);
    }

    function test_takesThePriceInEffectAtTheExpiry() public {
        feed.push(97e8, expiry - 30 minutes); // последняя котировка перед закрытием
        vm.warp(expiry + 2 hours);
        pool.settle(expiry);
        assertEq(pool.settlePriceWad(expiry), 97e18);
    }

    function test_worksAllWeekendWhileTheFeedStandsStill() public {
        feed.push(97e8, expiry - 10 minutes);
        vm.warp(expiry + 40 hours);
        pool.settle(expiry);
        assertEq(pool.settlePriceWad(expiry), 97e18);
    }

    function test_refusesToSettleTwice() public {
        feed.push(97e8, expiry - 10 minutes);
        vm.warp(expiry + 1 hours);
        pool.settle(expiry);
        vm.expectRevert(NuvoPool.AlreadySettled.selector);
        pool.settle(expiry);
    }

    function test_latestRoundAfterTheExpiryIsNotTheSettleRound() public {
        feed.push(97e8, expiry - 10 minutes);
        vm.warp(expiry + 40 hours);
        feed.push(105e8, expiry + 39 hours); // рынок снова открылся, никто не рассчитал
        vm.expectRevert(NuvoPool.NotTheSettleRound.selector);
        pool.settle(expiry);
    }

    function test_theMissedWeekIsSettledByTheHistoricRound() public {
        uint80 closeRound = feed.push(97e8, expiry - 10 minutes);
        vm.warp(expiry + 40 hours);
        feed.push(105e8, expiry + 39 hours);
        pool.settleWithRound(expiry, closeRound);
        assertEq(pool.settlePriceWad(expiry), 97e18);
    }

    function test_aRoundFromLongBeforeTheCloseDoesNotSettleTheWeek() public {
        // фид умер за сутки до экспирации: расчёт ждёт свежей цены
        feed.push(97e8, expiry - 24 hours);
        vm.warp(expiry + 1 hours);
        vm.expectRevert(NuvoPool.StalePrice.selector);
        pool.settle(expiry);
    }

    function test_afterASilentFeedTheFirstFreshRoundSettlesTheWeek() public {
        feed.push(97e8, expiry - 24 hours);
        vm.warp(expiry + 30 hours);
        uint80 first = feed.push(101e8, expiry + 29 hours);
        pool.settleWithRound(expiry, first);
        assertEq(pool.settlePriceWad(expiry), 101e18);
    }

    function test_aLaterRoundCannotReplaceAGoodOne() public {
        uint80 closeRound = feed.push(97e8, expiry - 10 minutes);
        vm.warp(expiry + 40 hours);
        uint80 later = feed.push(105e8, expiry + 39 hours);
        assertEq(closeRound + 1, later);
        vm.expectRevert(NuvoPool.NotTheSettleRound.selector);
        pool.settleWithRound(expiry, later);
    }

    function test_rejectsARoundWithoutAPrice() public {
        uint80 bad = feed.push(0, expiry - 10 minutes);
        vm.warp(expiry + 1 hours);
        vm.expectRevert(NuvoPool.BadPrice.selector);
        pool.settleWithRound(expiry, bad);
    }
}
