// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NuvoPool} from "../src/NuvoPool.sol";
import {PremiumModel} from "../src/PremiumModel.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockFeed} from "./mocks/MockFeed.sol";
import {MockFactory} from "./mocks/MockFactory.sol";

contract PoolLiquidityTest is Test {
    MockERC20 internal usdg;
    MockERC20 internal stock;
    MockFeed internal feed;
    MockFactory internal factory;
    PremiumModel internal model;
    NuvoPool internal pool;

    address internal owner = address(0xA11CE);
    address internal lp1 = address(0xB0B);
    address internal lp2 = address(0xCAFE);

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
        model = new PremiumModel(dirs, dist, bps);

        feed.push(100e8, block.timestamp); // $100 за токен

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
                minDepositValueWad: 10e18,
                maxPositionValueWad: 100_000e18,
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

        usdg.mint(lp1, 1_000_000e6);
        usdg.mint(lp2, 1_000_000e6);
        stock.mint(lp1, 1_000e18);

        // Разрешения выдаются здесь, чтобы в тестах vm.expectRevert приходился
        // ровно на addLiquidity, а не на approve внутри вспомогательного метода.
        address[2] memory lps = [lp1, lp2];
        for (uint256 i = 0; i < lps.length; i++) {
            vm.startPrank(lps[i]);
            usdg.approve(address(pool), type(uint256).max);
            stock.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _add(address who, uint256 u, uint256 t) internal returns (uint256) {
        vm.prank(who);
        return pool.addLiquidity(u, t, 0);
    }

    function test_firstDepositValuesBothAssetsAndLocksTheFloor() public {
        uint256 shares = _add(lp1, 10_000e6, 50e18);
        // 10 000 USDG + 50 токенов по $100 = 15 000 в WAD
        assertEq(pool.totalShares(), 15_000e18);
        assertEq(shares, 15_000e18 - 1e15);
        assertEq(pool.sharesOf(address(pool)), 1e15, "floor shares stay in the pool forever");
        assertEq(pool.poolValueWad(), 15_000e18);
        assertEq(pool.freeUsdg(), 10_000e6);
        assertEq(pool.freeToken(), 50e18);
    }

    function test_secondDepositIsProportional() public {
        _add(lp1, 10_000e6, 50e18);
        uint256 shares = _add(lp2, 1_000e6, 0);
        assertEq(shares, 1_000e18);
        assertEq(pool.poolValueWad(), 16_000e18);
    }

    function test_withdrawPaysTheFreeSideInProportion() public {
        _add(lp1, 10_000e6, 50e18);
        uint256 shares = _add(lp2, 1_000e6, 0);

        vm.prank(lp2);
        (uint256 usdgOut, uint256 tokenOut) = pool.removeLiquidity(shares, 0, 0);

        // 1/16 свободного инвентаря: 11 000 USDG и 50 токенов
        assertEq(usdgOut, 687_500_000);
        assertEq(tokenOut, 3.125e18);
        assertEq(pool.sharesOf(lp2), 0);
        assertEq(pool.poolValueWad(), 15_000e18);
    }

    function test_withdrawRespectsMinimums() public {
        _add(lp1, 10_000e6, 50e18);
        uint256 shares = _add(lp2, 1_000e6, 0);
        vm.prank(lp2);
        vm.expectRevert(NuvoPool.Slippage.selector);
        pool.removeLiquidity(shares, 1_000e6, 0);
    }

    function test_rejectsMoreSharesThanOwned() public {
        _add(lp1, 10_000e6, 50e18);
        vm.prank(lp2);
        vm.expectRevert(NuvoPool.BadShares.selector);
        pool.removeLiquidity(1, 0, 0);
    }

    function test_rejectsZeroShares() public {
        _add(lp1, 10_000e6, 50e18);
        vm.prank(lp1);
        vm.expectRevert(NuvoPool.BadShares.selector);
        pool.removeLiquidity(0, 0, 0);
    }

    function test_soleDepositorCanTakeEverythingBackButTheFloor() public {
        uint256 shares = _add(lp1, 10_000e6, 50e18);
        vm.prank(lp1);
        (uint256 usdgOut, uint256 tokenOut) = pool.removeLiquidity(shares, 0, 0);
        // всё, кроме запертой доли: 1e15 из 15 000e18 стоимости
        assertApproxEqRel(usdgOut, 10_000e6, 1e12);
        assertApproxEqRel(tokenOut, 50e18, 1e12);
        assertEq(pool.totalShares(), 1e15);
        assertGt(pool.poolValueWad(), 0, "the floor keeps the pool from being re-scaled");
    }

    function test_rejectsDepositThatIsAllRoundedAway() public {
        vm.prank(lp1);
        vm.expectRevert(NuvoPool.TooSmall.selector);
        pool.addLiquidity(0, 0, 0);
    }

    // Review Focus 3: фид без цены не считается
    function test_rejectsNonPositivePrice() public {
        feed.push(0, block.timestamp);
        vm.prank(lp1);
        vm.expectRevert(NuvoPool.BadPrice.selector);
        pool.addLiquidity(10_000e6, 0, 0);
    }

    function test_rejectsStalePrice() public {
        vm.warp(block.timestamp + 81 hours);
        vm.prank(lp1);
        vm.expectRevert(NuvoPool.StalePrice.selector);
        pool.addLiquidity(10_000e6, 0, 0);
    }
}
