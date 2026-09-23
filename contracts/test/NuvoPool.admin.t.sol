// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NuvoPool} from "../src/NuvoPool.sol";
import {PremiumModel} from "../src/PremiumModel.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockFeed} from "./mocks/MockFeed.sol";
import {MockFactory} from "./mocks/MockFactory.sol";

contract PoolAdminTest is Test {
    MockERC20 internal usdg;
    MockERC20 internal stock;
    MockFeed internal feed;
    MockFactory internal factory;
    NuvoPool internal pool;

    address internal owner = address(0xA11CE);
    address internal lp = address(0xB0B);
    address internal user = address(0xD00D);
    uint64 internal expiry;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        stock = new MockERC20("Tokenized NVDA", "NVDA", 18);
        feed = new MockFeed(8);
        factory = new MockFactory();

        uint8[] memory dirs = new uint8[](2);
        uint16[] memory dist = new uint16[](2);
        uint16[] memory bps = new uint16[](2);
        (dirs[0], dist[0], bps[0]) = (0, 200, 120);
        (dirs[1], dist[1], bps[1]) = (1, 200, 110);
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
                owner: owner,
                guardian: owner,
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

        usdg.mint(lp, 1_000_000e6);
        stock.mint(lp, 10_000e18);
        usdg.mint(user, 100_000e6);

        vm.startPrank(lp);
        usdg.approve(address(pool), type(uint256).max);
        stock.approve(address(pool), type(uint256).max);
        pool.addLiquidity(100_000e6, 1_000e18, 0);
        vm.stopPrank();

        vm.prank(user);
        usdg.approve(address(pool), type(uint256).max);
    }

    function test_guardianCanPauseOwnerCanRelease() public {
        vm.prank(owner);
        pool.setGuardian(address(0x6a7d));

        vm.prank(address(0x6a7d));
        pool.pause();
        assertTrue(pool.paused());

        vm.prank(address(0x6a7d));
        vm.expectRevert();
        pool.unpause();

        vm.prank(owner);
        pool.unpause();
        assertFalse(pool.paused());
    }

    function test_pauseStopsSubscriptionsAndDeposits() public {
        vm.prank(owner);
        pool.pause();

        assertEq(pool.preview(0, 200, 1_000e6).code, pool.CODE_PAUSED());

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(NuvoPool.Unavailable.selector, pool.CODE_PAUSED()));
        pool.subscribe(0, 200, 1_000e6, type(uint256).max, uint64(block.timestamp + 300));

        vm.prank(lp);
        vm.expectRevert(NuvoPool.Paused.selector);
        pool.addLiquidity(1_000e6, 0, 0);
    }

    function test_pauseDoesNotStopWithdrawalsSettlementOrClaims() public {
        vm.prank(user);
        uint256 id = pool.subscribe(0, 200, 1_000e6, type(uint256).max, uint64(block.timestamp + 300));

        vm.prank(owner);
        pool.pause();

        feed.push(99e8, expiry - 10 minutes);
        vm.warp(expiry + 1 hours);
        pool.settle(expiry);

        vm.prank(user);
        (, uint256 amount) = pool.claim(id);
        assertEq(amount, 1_012e6);

        uint256 half = pool.sharesOf(lp) / 2;
        vm.prank(lp);
        pool.removeLiquidity(half, 0, 0);
    }

    function test_strangerCannotPause() public {
        vm.prank(user);
        vm.expectRevert(NuvoPool.NotAllowed.selector);
        pool.pause();
    }

    function test_modelChangeWaitsOutTheDelay() public {
        uint8[] memory dirs = new uint8[](1);
        uint16[] memory dist = new uint16[](1);
        uint16[] memory bps = new uint16[](1);
        (dirs[0], dist[0], bps[0]) = (0, 200, 300);
        PremiumModel next = new PremiumModel(dirs, dist, bps);

        vm.prank(owner);
        pool.scheduleModel(address(next));
        assertEq(pool.preview(0, 200, 1_000e6).premiumBps, 120, "the old rate holds until the delay is out");

        vm.expectRevert(NuvoPool.TooEarly.selector);
        pool.applyModel();

        vm.warp(block.timestamp + 2 days);
        pool.applyModel();
        assertEq(pool.preview(0, 200, 1_000e6).premiumBps, 300);
    }

    function test_applyWithoutAScheduleFails() public {
        vm.expectRevert(NuvoPool.NothingPending.selector);
        pool.applyModel();
    }

    function test_limitsCannotBeSetOutsideTheirCaps() public {
        vm.startPrank(owner);
        vm.expectRevert(NuvoPool.TooHigh.selector);
        pool.setLimits(8 days, 6 hours, 100e18, 50_000e18, 500_000e18, 8_000);
        vm.expectRevert(NuvoPool.TooHigh.selector);
        pool.setLimits(80 hours, 25 hours, 100e18, 50_000e18, 500_000e18, 8_000);
        vm.expectRevert(NuvoPool.TooHigh.selector);
        pool.setLimits(80 hours, 6 hours, 100e18, 50_000e18, 500_000e18, 10_001);
        vm.stopPrank();
    }

    function test_theOwnerCannotTakeTheInventory() public {
        // единственный путь наружу для владельца — накопленная комиссия, и она пуста
        vm.prank(owner);
        pool.withdrawFees(owner);
        assertEq(usdg.balanceOf(owner), 0);
        assertEq(stock.balanceOf(owner), 0);
    }
}
