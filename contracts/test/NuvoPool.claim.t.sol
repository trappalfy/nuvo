// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NuvoPool} from "../src/NuvoPool.sol";
import {PremiumModel} from "../src/PremiumModel.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockFeed} from "./mocks/MockFeed.sol";
import {MockFactory} from "./mocks/MockFactory.sol";

contract PoolClaimTest is Test {
    MockERC20 internal usdg;
    MockERC20 internal stock;
    MockFeed internal feed;
    MockFactory internal factory;
    NuvoPool internal pool;

    address internal owner = address(0xA11CE);
    address internal lp = address(0xB0B);
    address internal user = address(0xD00D);
    address internal other = address(0xE11E);
    uint64 internal expiry;

    uint256 internal constant BUY_LOW_LOCK_TOKEN = 10_326_530_612_244_897_959; // 1012 / 98
    uint256 internal constant SELL_HIGH_LOCK_USDG = 1_031_220_000; // 10.11 x 102

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

        usdg.mint(lp, 1_000_000e6);
        stock.mint(lp, 10_000e18);
        usdg.mint(user, 100_000e6);
        stock.mint(user, 1_000e18);

        vm.startPrank(lp);
        usdg.approve(address(pool), type(uint256).max);
        stock.approve(address(pool), type(uint256).max);
        pool.addLiquidity(100_000e6, 1_000e18, 0);
        vm.stopPrank();

        vm.startPrank(user);
        usdg.approve(address(pool), type(uint256).max);
        stock.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function _buyLow() internal returns (uint256) {
        vm.prank(user);
        return pool.subscribe(0, 200, 1_000e6, type(uint256).max, uint64(block.timestamp + 300));
    }

    function _sellHigh() internal returns (uint256) {
        vm.prank(user);
        return pool.subscribe(1, 200, 10e18, 0, uint64(block.timestamp + 300));
    }

    function _settleAt(int256 answer) internal {
        feed.push(answer, expiry - 10 minutes);
        vm.warp(expiry + 1 hours);
        pool.settle(expiry);
    }

    function test_buyLowConvertedPaysTheStock() public {
        uint256 id = _buyLow();
        _settleAt(95e8);

        vm.prank(user);
        (address asset, uint256 amount) = pool.claim(id);

        assertEq(asset, address(stock));
        assertEq(amount, BUY_LOW_LOCK_TOKEN);
        assertEq(stock.balanceOf(user), 1_000e18 + BUY_LOW_LOCK_TOKEN);
        // депозит стал инвентарём, замок под отказ вернулся свободным
        assertEq(pool.freeUsdg(), 101_000e6);
        assertEq(pool.freeToken(), 1_000e18 - BUY_LOW_LOCK_TOKEN);
        assertEq(pool.lockedUsdg(), 0);
        assertEq(pool.lockedToken(), 0);
        assertEq(pool.depositsUsdg(), 0);
    }

    function test_buyLowNotConvertedPaysDepositPlusPremium() public {
        uint256 id = _buyLow();
        _settleAt(99e8);

        vm.prank(user);
        (address asset, uint256 amount) = pool.claim(id);

        assertEq(asset, address(usdg));
        assertEq(amount, 1_012e6);
        assertEq(usdg.balanceOf(user), 100_000e6 - 1_000e6 + 1_012e6);
        assertEq(pool.freeUsdg(), 99_988e6, "the premium left the inventory");
        assertEq(pool.freeToken(), 1_000e18, "the conversion lock came back");
        assertEq(pool.depositsUsdg(), 0);
    }

    function test_sellHighConvertedPaysUsdg() public {
        uint256 id = _sellHigh();
        _settleAt(105e8);

        vm.prank(user);
        (address asset, uint256 amount) = pool.claim(id);

        assertEq(asset, address(usdg));
        assertEq(amount, SELL_HIGH_LOCK_USDG);
        assertEq(pool.freeToken(), 1_010e18, "the stock became inventory");
        assertEq(pool.freeUsdg(), 100_000e6 - SELL_HIGH_LOCK_USDG);
        assertEq(pool.depositsToken(), 0);
    }

    function test_sellHighNotConvertedPaysDepositPlusPremium() public {
        uint256 id = _sellHigh();
        _settleAt(100e8);

        vm.prank(user);
        (address asset, uint256 amount) = pool.claim(id);

        assertEq(asset, address(stock));
        assertEq(amount, 10.11e18);
        assertEq(pool.freeUsdg(), 100_000e6, "the conversion lock came back");
        assertEq(pool.freeToken(), 1_000e18 - 0.11e18);
        assertEq(pool.depositsToken(), 0);
    }

    function test_atTheStrikeBuyLowConverts() public {
        uint256 id = _buyLow();
        _settleAt(98e8);
        vm.prank(user);
        (address asset,) = pool.claim(id);
        assertEq(asset, address(stock), "at or below the strike converts");
    }

    function test_atTheStrikeSellHighConverts() public {
        uint256 id = _sellHigh();
        _settleAt(102e8);
        vm.prank(user);
        (address asset,) = pool.claim(id);
        assertEq(asset, address(usdg), "at or above the strike converts");
    }

    // Review Focus 4
    function test_cannotClaimTwice() public {
        uint256 id = _buyLow();
        _settleAt(99e8);
        vm.prank(user);
        pool.claim(id);
        vm.prank(user);
        vm.expectRevert(NuvoPool.AlreadyClaimed.selector);
        pool.claim(id);
    }

    function test_cannotClaimSomeoneElsesPosition() public {
        uint256 id = _buyLow();
        _settleAt(99e8);
        vm.prank(other);
        vm.expectRevert(NuvoPool.NotYours.selector);
        pool.claim(id);
    }

    function test_cannotClaimBeforeSettlement() public {
        uint256 id = _buyLow();
        vm.warp(expiry + 1 hours);
        vm.prank(user);
        vm.expectRevert(NuvoPool.NotSettled.selector);
        pool.claim(id);
    }

    function test_positionPayoutShowsTheOutcomeBeforeClaiming() public {
        uint256 id = _buyLow();
        (bool settled,,,) = pool.positionPayout(id);
        assertFalse(settled);

        _settleAt(95e8);
        (bool settled2, bool converted, address asset, uint256 amount) = pool.positionPayout(id);
        assertTrue(settled2);
        assertTrue(converted);
        assertEq(asset, address(stock));
        assertEq(amount, BUY_LOW_LOCK_TOKEN);
    }

    function test_feeTakesAShareOfThePremiumFromTheInventory() public {
        vm.prank(owner);
        pool.setFeeBps(1_000); // 10% от премии

        uint256 id = _buyLow();
        _settleAt(99e8);
        vm.prank(user);
        (, uint256 amount) = pool.claim(id);

        assertEq(amount, 1_012e6, "the subscriber is paid in full");
        assertEq(pool.feesUsdg(), 1_200_000, "10% of the 12 USDG premium");
        assertEq(pool.freeUsdg(), 99_988e6 - 1_200_000);

        vm.prank(owner);
        pool.withdrawFees(owner);
        assertEq(usdg.balanceOf(owner), 1_200_000);
        assertEq(pool.feesUsdg(), 0);
    }

    function test_feeOnAConvertedOutcomeIsTakenInTheOtherAsset() public {
        vm.prank(owner);
        pool.setFeeBps(1_000);
        uint256 id = _buyLow();
        _settleAt(95e8);
        vm.prank(user);
        pool.claim(id);
        assertGt(pool.feesToken(), 0);
        assertEq(pool.feesUsdg(), 0);
    }

    function test_rejectsAFeeAboveTheCap() public {
        vm.prank(owner);
        vm.expectRevert(NuvoPool.TooHigh.selector);
        pool.setFeeBps(2_001);
    }

    function test_onlyTheOwnerSetsTheFee() public {
        vm.prank(user);
        vm.expectRevert();
        pool.setFeeBps(100);
    }

    function test_claimWorksWhilePaused() public {
        uint256 id = _buyLow();
        _settleAt(99e8);
        vm.prank(owner);
        pool.pause();
        vm.prank(user);
        (, uint256 amount) = pool.claim(id);
        assertEq(amount, 1_012e6, "nothing an admin does can hold a payout");
    }
}
