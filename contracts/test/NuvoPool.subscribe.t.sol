// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NuvoPool} from "../src/NuvoPool.sol";
import {PremiumModel} from "../src/PremiumModel.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockFeed} from "./mocks/MockFeed.sol";
import {MockFactory} from "./mocks/MockFactory.sol";

contract PoolSubscribeTest is Test {
    MockERC20 internal usdg;
    MockERC20 internal stock;
    MockFeed internal feed;
    MockFactory internal factory;
    NuvoPool internal pool;

    address internal owner = address(0xA11CE);
    address internal lp = address(0xB0B);
    address internal user = address(0xD00D);

    uint64 internal expiry1;
    uint64 internal expiry2;

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

        expiry1 = uint64(block.timestamp + 3 days);
        expiry2 = uint64(block.timestamp + 10 days);
        uint64[] memory list = new uint64[](2);
        (list[0], list[1]) = (expiry1, expiry2);
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

    function test_buyLowLocksBothOutcomes() public {
        vm.prank(user);
        uint256 id = pool.subscribe(0, 200, 1_000e6, type(uint256).max, uint64(block.timestamp + 300));

        NuvoPool.Position memory p = pool.position(id);
        assertEq(p.owner, user);
        assertEq(p.strikeWad, 98e18, "strike is 2% under the reference");
        assertEq(p.premiumBps, 120);
        assertEq(p.expiry, expiry1);
        assertEq(p.deposit, 1_000e6);
        // D x (1 + r) / K = 1012 / 98 токенов, вниз
        assertEq(p.lockToken, 10_326_530_612_244_897_959);
        // D x r премии в USDG
        assertEq(p.lockUsdg, 12e6);

        assertEq(pool.lockedToken(), p.lockToken);
        assertEq(pool.lockedUsdg(), p.lockUsdg);
        assertEq(pool.freeToken(), 1_000e18 - p.lockToken);
        assertEq(pool.freeUsdg(), 100_000e6 - p.lockUsdg);
        assertEq(pool.depositsUsdg(), 1_000e6);
        assertEq(usdg.balanceOf(address(pool)), 101_000e6);
    }

    function test_sellHighLocksBothOutcomes() public {
        vm.prank(user);
        uint256 id = pool.subscribe(1, 200, 10e18, 0, uint64(block.timestamp + 300));

        NuvoPool.Position memory p = pool.position(id);
        assertEq(p.strikeWad, 102e18);
        // Q x K x (1 + r) = 10.11 x 102 USDG
        assertEq(p.lockUsdg, 1_031_220_000);
        // Q x r премии в токенах
        assertEq(p.lockToken, 110_000_000_000_000_000);
        assertEq(pool.depositsToken(), 10e18);
    }

    function test_previewMatchesWhatSubscribeStores() public {
        NuvoPool.Preview memory q = pool.preview(0, 200, 1_000e6);
        assertEq(q.code, 0);
        assertEq(q.ifNot, 1_012e6, "deposit plus premium in USDG");
        assertEq(q.ifConverted, 10_326_530_612_244_897_959);

        vm.prank(user);
        uint256 id = pool.subscribe(0, 200, 1_000e6, type(uint256).max, uint64(block.timestamp + 300));
        NuvoPool.Position memory p = pool.position(id);
        assertEq(p.lockToken, q.ifConverted);
        assertEq(p.strikeWad, q.strikeWad);
        assertEq(p.premiumBps, q.premiumBps);
    }

    // Review Focus 1
    function test_rejectsDistanceAtOrAboveHundredPercent() public {
        assertEq(pool.preview(0, 10_000, 1_000e6).code, pool.CODE_BAD_DISTANCE());
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(NuvoPool.Unavailable.selector, pool.CODE_BAD_DISTANCE()));
        pool.subscribe(0, 10_000, 1_000e6, type(uint256).max, uint64(block.timestamp + 300));
    }

    function test_rejectsUnknownDirection() public {
        assertEq(pool.preview(2, 200, 1_000e6).code, pool.CODE_BAD_DISTANCE());
    }

    // Review Focus 2: ровно на отсечке подписка уходит в следующую экспирацию
    function test_atTheCutoffTheNextExpiryIsUsed() public {
        vm.warp(expiry1 - 24 hours);
        feed.push(100e8, block.timestamp);
        vm.prank(user);
        uint256 id = pool.subscribe(0, 200, 1_000e6, type(uint256).max, uint64(block.timestamp + 300));
        assertEq(pool.position(id).expiry, expiry2);
    }

    function test_oneSecondBeforeTheCutoffTheNearExpiryIsUsed() public {
        vm.warp(expiry1 - 24 hours - 1);
        feed.push(100e8, block.timestamp);
        vm.prank(user);
        uint256 id = pool.subscribe(0, 200, 1_000e6, type(uint256).max, uint64(block.timestamp + 300));
        assertEq(pool.position(id).expiry, expiry1);
    }

    function test_rejectsWhenTheCalendarIsOut() public {
        vm.warp(expiry2);
        feed.push(100e8, block.timestamp);
        assertEq(pool.preview(0, 200, 1_000e6).code, pool.CODE_NO_EXPIRY());
    }

    function test_rejectsBelowTheMinimum() public {
        assertEq(pool.preview(0, 200, 50e6).code, pool.CODE_BELOW_MIN());
    }

    function test_rejectsAboveThePositionCap() public {
        assertEq(pool.preview(0, 200, 60_000e6).code, pool.CODE_ABOVE_MAX());
    }

    /// @dev Маленький пул без потолка на позицию: иначе до проверок инвентаря
    ///      дело не доходит, подписку раньше отсекает потолок размера.
    function _tightPool() internal returns (NuvoPool tight) {
        uint8[] memory dirs = new uint8[](1);
        uint16[] memory dist = new uint16[](1);
        uint16[] memory bps = new uint16[](1);
        (dirs[0], dist[0], bps[0]) = (0, 200, 120);
        PremiumModel model = new PremiumModel(dirs, dist, bps);

        tight = new NuvoPool(
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
                minDepositValueWad: 10e18,
                maxPositionValueWad: 0,
                maxExpiryLockValueWad: 0,
                maxLockedShareBps: 8_000
            })
        );

        // These suites test the pool itself, not who is let in.
        {
            address o_ = tight.owner();
            vm.prank(o_);
            tight.setAllowlist(false);
        }

        // 100 USDG и 100 токенов по $100: стоимость 10 100
        vm.startPrank(lp);
        usdg.approve(address(tight), type(uint256).max);
        stock.approve(address(tight), type(uint256).max);
        tight.addLiquidity(100e6, 100e18, 0);
        vm.stopPrank();
    }

    function test_rejectsWhenInventoryIsShort() public {
        NuvoPool tight = _tightPool();
        // 10 000 USDG по страйку 98 требуют 103.26 токена, а свободно 100
        assertEq(tight.preview(0, 200, 10_000e6).code, tight.CODE_NO_INVENTORY());
    }

    function test_rejectsWhenTooMuchOfTheInventoryWouldBeLocked() public {
        NuvoPool tight = _tightPool();
        // Инвентаря хватает, но заморозка вышла бы за 80% стоимости пула
        assertEq(tight.preview(0, 200, 8_200e6).code, tight.CODE_TOO_MUCH_LOCKED());

        usdg.mint(user, 10_000e6);
        vm.startPrank(user);
        usdg.approve(address(tight), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(NuvoPool.Unavailable.selector, tight.CODE_TOO_MUCH_LOCKED()));
        tight.subscribe(0, 200, 8_200e6, type(uint256).max, uint64(block.timestamp + 300));
        vm.stopPrank();
    }

    function test_rejectsWhenTheStrikeMovedPastTheLimit() public {
        feed.push(110e8, block.timestamp); // цена ушла вверх, страйк Buy Low тоже
        vm.prank(user);
        vm.expectRevert(NuvoPool.StrikeMoved.selector);
        pool.subscribe(0, 200, 1_000e6, 98e18, uint64(block.timestamp + 300));
    }

    function test_rejectsAfterTheDeadline() public {
        vm.prank(user);
        vm.expectRevert(NuvoPool.Expired.selector);
        pool.subscribe(0, 200, 1_000e6, type(uint256).max, uint64(block.timestamp - 1));
    }

    function test_rejectsAnUnknownRung() public {
        assertEq(pool.preview(0, 600, 1_000e6).code, pool.CODE_NO_PREMIUM());
    }

    // Review Focus 5: замороженный инвентарь вкладчику не выдаётся
    function test_liquidityLockedBySubscriptionsCannotBeWithdrawn() public {
        vm.prank(user);
        pool.subscribe(1, 200, 400e18, 0, uint64(block.timestamp + 300));
        uint256 shares = pool.sharesOf(lp);
        vm.prank(lp);
        vm.expectRevert(NuvoPool.InventoryLocked.selector);
        pool.removeLiquidity(shares, 0, 0);
    }

    function test_positionsOfListsTheOwnersPositions() public {
        vm.startPrank(user);
        uint256 a = pool.subscribe(0, 200, 1_000e6, type(uint256).max, uint64(block.timestamp + 300));
        uint256 b = pool.subscribe(1, 200, 10e18, 0, uint64(block.timestamp + 300));
        vm.stopPrank();
        uint256[] memory ids = pool.positionsOf(user);
        assertEq(ids.length, 2);
        assertEq(ids[0], a);
        assertEq(ids[1], b);
        assertEq(pool.positionCount(), 2);
    }
}
