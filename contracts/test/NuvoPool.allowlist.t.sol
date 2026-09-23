// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NuvoPool} from "../src/NuvoPool.sol";
import {PremiumModel} from "../src/PremiumModel.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockFeed} from "./mocks/MockFeed.sol";
import {MockFactory} from "./mocks/MockFactory.sol";

/// @notice Пул рождается закрытым: пока список включён, внутрь пускают только
///         допущенных. Список стоит на входе и только на входе — забрать своё
///         может кто угодно и когда угодно, иначе он запирал бы чужие деньги.
contract PoolAllowlistTest is Test {
    MockERC20 internal usdg;
    MockERC20 internal stock;
    MockFeed internal feed;
    MockFactory internal factory;
    NuvoPool internal pool;

    address internal owner = address(0xA11CE);
    address internal lp = address(0xB0B);
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

        for (uint256 i = 0; i < 3; i++) {
            address who = [lp, user, stranger][i];
            usdg.mint(who, 1_000_000e6);
            stock.mint(who, 10_000e18);
            vm.startPrank(who);
            usdg.approve(address(pool), type(uint256).max);
            stock.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }

        _allow(lp, true);
        _allow(user, true);
        vm.prank(lp);
        pool.addLiquidity(100_000e6, 1_000e18, 0);
    }

    function _allow(address who, bool ok) internal {
        address[] memory one = new address[](1);
        one[0] = who;
        vm.prank(owner);
        pool.setAllowed(one, ok);
    }

    // --- вход закрыт ---

    function test_aPoolIsBornClosed() public view {
        assertTrue(pool.allowlistOn(), "a fresh pool must not be open to everyone");
    }

    function test_aStrangerCannotDeposit() public {
        vm.prank(stranger);
        vm.expectRevert(NuvoPool.NotOnList.selector);
        pool.addLiquidity(10_000e6, 0, 0);
    }

    function test_aStrangerCannotSubscribe() public {
        vm.prank(stranger);
        vm.expectRevert(NuvoPool.NotOnList.selector);
        pool.subscribe(0, 200, 10_000e6, type(uint256).max, uint64(block.timestamp + 300));
    }

    function test_anAllowedWalletGetsIn() public {
        vm.prank(user);
        uint256 id = pool.subscribe(0, 200, 10_000e6, type(uint256).max, uint64(block.timestamp + 300));
        assertEq(pool.position(id).owner, user);
    }

    // --- список снимается одним вызовом ---

    function test_openingTheListLetsAnyoneIn() public {
        vm.prank(owner);
        pool.setAllowlist(false);

        vm.prank(stranger);
        pool.addLiquidity(10_000e6, 0, 0);
        assertGt(pool.sharesOf(stranger), 0);
    }

    function test_onlyTheOwnerTouchesTheList() public {
        address[] memory one = new address[](1);
        one[0] = stranger;

        vm.prank(stranger);
        vm.expectRevert();
        pool.setAllowed(one, true);

        vm.prank(stranger);
        vm.expectRevert();
        pool.setAllowlist(false);
    }

    // --- выход не закрывается никогда ---

    function test_droppedFromTheListYouCanStillWithdraw() public {
        _allow(lp, false);

        uint256 half = pool.sharesOf(lp) / 2;
        vm.prank(lp);
        (uint256 usdgOut,) = pool.removeLiquidity(half, 0, 0);
        assertGt(usdgOut, 0, "a depositor gets their money out without the list");
    }

    function test_droppedFromTheListYouCanStillClaim() public {
        vm.prank(user);
        uint256 id = pool.subscribe(0, 200, 10_000e6, type(uint256).max, uint64(block.timestamp + 300));

        _allow(user, false);

        feed.push(90e8, expiry - 10 minutes);
        vm.warp(expiry + 1 hours);
        pool.settle(expiry);

        vm.prank(user);
        (, uint256 amount) = pool.claim(id);
        assertGt(amount, 0, "a payout does not depend on the list");
    }
}
