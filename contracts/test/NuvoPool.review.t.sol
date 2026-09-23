// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NuvoPool} from "../src/NuvoPool.sol";
import {PremiumModel} from "../src/PremiumModel.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockFeed} from "./mocks/MockFeed.sol";
import {MockFactory} from "./mocks/MockFactory.sol";

/// @notice Дыры, найденные при сквозном обзоре ветки, и их заплаты.
contract PoolReviewTest is Test {
    MockERC20 internal usdg;
    MockERC20 internal stock;
    MockFeed internal feed;
    MockFactory internal factory;
    NuvoPool internal pool;

    address internal owner = address(0xA11CE);
    address internal lp = address(0xB0B);
    address internal raider = address(0x11AD);
    address internal user = address(0xD00D);
    address internal stranger = address(0x5EED);
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

        for (uint256 i = 0; i < 4; i++) {
            address who = [lp, raider, user, stranger][i];
            usdg.mint(who, 1_000_000e6);
            stock.mint(who, 10_000e18);
            vm.startPrank(who);
            usdg.approve(address(pool), type(uint256).max);
            stock.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }

        vm.prank(lp);
        pool.addLiquidity(100_000e6, 1_000e18, 0);
    }

    function _buyLow(uint256 amount) internal returns (uint256) {
        vm.prank(user);
        return pool.subscribe(0, 200, amount, type(uint256).max, uint64(block.timestamp + 300));
    }

    function _settleAt(int256 answer) internal {
        feed.push(answer, expiry - 10 minutes);
        vm.warp(expiry + 1 hours);
        pool.settle(expiry);
    }

    // --- C1: приток и отток вкладчиков, пока исход уже известен ---

    function test_depositsAreClosedWhileASettledWeekIsUnclaimed() public {
        _buyLow(40_000e6);
        _settleAt(50e8); // исход решён, выплата ещё не забрана

        vm.prank(raider);
        vm.expectRevert(NuvoPool.SettlementPending.selector);
        pool.addLiquidity(100_000e6, 0, 0);

        uint256 half = pool.sharesOf(lp) / 2;
        vm.prank(lp);
        vm.expectRevert(NuvoPool.SettlementPending.selector);
        pool.removeLiquidity(half, 0, 0);
    }

    function test_liquidityReopensOnceTheWeekIsClaimed() public {
        uint256 id = _buyLow(40_000e6);
        _settleAt(50e8);

        vm.prank(user);
        pool.claim(id);

        vm.prank(raider);
        uint256 shares = pool.addLiquidity(1_000e6, 0, 0);
        assertGt(shares, 0);
    }

    function test_anyoneCanResolveAStaleSettledPositionAfterADay() public {
        uint256 id = _buyLow(40_000e6);
        _settleAt(50e8);

        vm.warp(expiry + 1 days);
        vm.prank(stranger);
        pool.resolve(id);

        // Выплата ждёт владельца как долг, а инвентарь снова в работе.
        assertGt(pool.owed(user, address(stock)), 0);
        feed.push(50e8, block.timestamp); // рынок снова открыт
        vm.prank(raider);
        assertGt(pool.addLiquidity(1_000e6, 0, 0), 0);
    }

    function test_resolveBeforeTheDelayIsRefused() public {
        uint256 id = _buyLow(40_000e6);
        _settleAt(50e8);
        vm.prank(stranger);
        vm.expectRevert(NuvoPool.TooEarly.selector);
        pool.resolve(id);
    }

    function test_owedIsPushedToItsOwner() public {
        uint256 id = _buyLow(40_000e6);
        _settleAt(50e8);
        vm.warp(expiry + 1 days);
        vm.prank(stranger);
        pool.resolve(id);

        uint256 credit = pool.owed(user, address(stock));
        uint256 before = stock.balanceOf(user);
        vm.prank(stranger);
        pool.withdrawOwed(user, address(stock));
        assertEq(stock.balanceOf(user), before + credit);
        assertEq(pool.owed(user, address(stock)), 0);
    }

    // --- I7: получатель, который не может принять перевод ---

    function test_claimToSendsThePayoutElsewhere() public {
        uint256 id = _buyLow(1_000e6);
        _settleAt(95e8);
        vm.prank(user);
        (address asset, uint256 amount) = pool.claimTo(id, stranger);
        assertEq(asset, address(stock));
        assertEq(stock.balanceOf(stranger), 10_000e18 + amount);
    }

    function test_claimToIsOwnerOnly() public {
        uint256 id = _buyLow(1_000e6);
        _settleAt(95e8);
        vm.prank(stranger);
        vm.expectRevert(NuvoPool.NotYours.selector);
        pool.claimTo(id, stranger);
    }

    // --- I1: смена агрегатора и нечитаемый соседний раунд ---

    function test_aRoundLongAfterTheExpiryIsRefusedWhenItsNeighbourCannotBeRead() public {
        // Раунд закрытия в старой фазе, а следом новая фаза с другим номером.
        feed.push(97e8, expiry - 10 minutes);
        vm.warp(expiry + 14 days);
        uint80 newPhase = feed.pushAt(1 << 64, 40e8, expiry + 14 days - 1 hours);

        vm.expectRevert(NuvoPool.NotTheSettleRound.selector);
        pool.settleWithRound(expiry, newPhase);

        vm.expectRevert(NuvoPool.NotTheSettleRound.selector);
        pool.settle(expiry);
    }

    function test_theCloseRoundStillSettlesAfterAPhaseChange() public {
        uint80 close = feed.push(97e8, expiry - 10 minutes);
        vm.warp(expiry + 14 days);
        feed.pushAt(1 << 64, 40e8, expiry + 14 days - 1 hours);

        pool.settleWithRound(expiry, close);
        assertEq(pool.settlePriceWad(expiry), 97e18);
    }

    function test_anOldPhaseRoundIsRefusedWhenALaterRoundExistsButIsUnreachable() public {
        // Ротация перед звонком: настоящая цена закрытия уже в новой фазе.
        uint80 old = feed.push(100e8, expiry - 2 hours);
        feed.pushAt(1 << 64, 80e8, expiry - 5 minutes);
        vm.warp(expiry + 1 hours);

        vm.expectRevert(NuvoPool.NotTheSettleRound.selector);
        pool.settleWithRound(expiry, old);
    }

    function test_theFirstFreshRoundAfterASilentFeedStillSettles() public {
        feed.push(97e8, expiry - 24 hours);
        vm.warp(expiry + 5 hours);
        uint80 first = feed.push(101e8, expiry + 4 hours);
        pool.settleWithRound(expiry, first);
        assertEq(pool.settlePriceWad(expiry), 101e18);
    }

    function test_findSettleRoundWalksBackToTheCloseRound() public {
        uint80 close = feed.push(97e8, expiry - 10 minutes);
        vm.warp(expiry + 40 hours);
        uint80 later = feed.push(105e8, expiry + 39 hours);

        (uint80 found, bool ok) = pool.findSettleRound(expiry, later, 16);
        assertTrue(ok);
        assertEq(found, close);
    }

    // --- I2: возраст цены для вкладчика ---

    function test_liquidityNeedsAFresherPriceThanASubscription() public {
        vm.warp(block.timestamp + 10 hours); // старше часа, но моложе восьмидесяти

        vm.prank(raider);
        vm.expectRevert(NuvoPool.StalePrice.selector);
        pool.addLiquidity(1_000e6, 0, 0);

        assertEq(pool.preview(0, 200, 1_000e6).code, 0, "subscriptions stay open round the clock");
    }

    // --- Review Focus 3: пробел в покрытии ---

    function test_aFeedWithoutATimestampIsRejected() public {
        feed.push(100e8, 0);
        vm.prank(raider);
        vm.expectRevert(NuvoPool.BadPrice.selector);
        pool.addLiquidity(1_000e6, 0, 0);
        assertEq(pool.preview(0, 200, 1_000e6).code, pool.CODE_BAD_PRICE());
    }

    // --- I6: ослабление лимитов с задержкой ---

    function test_tighteningLimitsIsImmediate() public {
        vm.prank(owner);
        pool.setLimits(40 hours, 30 minutes, 200e18, 40_000e18, 400_000e18, 7_000);
        assertEq(pool.maxPriceAge(), 40 hours);
        assertEq(pool.maxLockedShareBps(), 7_000);
    }

    function test_looseningLimitsWaitsOutTheDelay() public {
        vm.prank(owner);
        vm.expectRevert(NuvoPool.UseSchedule.selector);
        pool.setLimits(80 hours, 6 hours, 100e18, 500_000e18, 500_000e18, 9_000);
    }

    function test_scheduledLimitsApplyAfterTheDelay() public {
        vm.prank(owner);
        pool.scheduleLimits(80 hours, 6 hours, 100e18, 500_000e18, 500_000e18, 9_000);
        assertEq(pool.maxLockedShareBps(), 8_000, "the old cap holds until the delay is out");

        vm.expectRevert(NuvoPool.TooEarly.selector);
        pool.applyLimits();

        vm.warp(block.timestamp + 2 days);
        pool.applyLimits();
        assertEq(pool.maxLockedShareBps(), 9_000);
        assertEq(pool.maxPositionValueWad(), 500_000e18);
    }

    // --- Отказ от владения запрещён ---

    function test_ownershipCannotBeRenounced() public {
        vm.prank(owner);
        vm.expectRevert(NuvoPool.NotAllowed.selector);
        pool.renounceOwnership();
    }

    // --- сломанный календарь: preview отвечает, а не падает ---

    function test_previewSurvivesABrokenCalendar() public {
        factory.setBroken(true);

        NuvoPool.Preview memory p = pool.preview(0, 200, 40_000e6);

        assertEq(p.code, pool.CODE_NO_EXPIRY(), "the screen must say there is no week");
        assertEq(p.expiry, 0);
    }

    function test_subscribingWithABrokenCalendarIsRefusedNotReverted() public {
        factory.setBroken(true);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(NuvoPool.Unavailable.selector, pool.CODE_NO_EXPIRY()));
        pool.subscribe(0, 200, 40_000e6, type(uint256).max, uint64(block.timestamp + 300));
    }
}
