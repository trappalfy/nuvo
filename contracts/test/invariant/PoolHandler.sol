// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NuvoPool} from "../../src/NuvoPool.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockFeed} from "../mocks/MockFeed.sol";
import {MockFactory} from "../mocks/MockFactory.sol";

/// @notice Случайные действия по пулу, с призрачным учётом того, что
///         инвариантам нужно знать снаружи контракта.
contract PoolHandler is Test {
    NuvoPool public pool;
    MockERC20 public usdg;
    MockERC20 public stock;
    MockFeed public feed;
    MockFactory public factory;

    address[3] public actors;
    uint64[] public expiries;

    uint256 public sharesMinted;
    uint256 public sharesBurned;
    uint256 public openDepositsUsdg;
    uint256 public openDepositsToken;

    uint256[] public ids;
    mapping(uint256 => address) public idOwner;

    constructor(
        NuvoPool p,
        MockERC20 u,
        MockERC20 s,
        MockFeed f,
        MockFactory fac,
        uint64[] memory schedule
    ) {
        pool = p;
        usdg = u;
        stock = s;
        feed = f;
        factory = fac;
        for (uint256 i = 0; i < schedule.length; i++) expiries.push(schedule[i]);

        actors = [address(0xA1), address(0xA2), address(0xA3)];
        for (uint256 i = 0; i < actors.length; i++) {
            usdg.mint(actors[i], 1_000_000e6);
            stock.mint(actors[i], 10_000e18);
            vm.startPrank(actors[i]);
            usdg.approve(address(pool), type(uint256).max);
            stock.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _rung(uint256 seed) internal pure returns (uint16) {
        uint16[4] memory rungs = [uint16(200), 400, 600, 800];
        return rungs[seed % 4];
    }

    function addLiquidity(uint256 seed, uint256 u, uint256 t) public {
        address a = _actor(seed);
        u = bound(u, 0, 100_000e6);
        t = bound(t, 0, 1_000e18);
        vm.prank(a);
        try pool.addLiquidity(u, t, 0) returns (uint256 s) {
            sharesMinted += s;
        } catch {}
    }

    function removeLiquidity(uint256 seed, uint256 share) public {
        address a = _actor(seed);
        uint256 held = pool.sharesOf(a);
        if (held == 0) return;
        share = bound(share, 1, held);
        vm.prank(a);
        try pool.removeLiquidity(share, 0, 0) {
            sharesBurned += share;
        } catch {}
    }

    function subscribeBuyLow(uint256 seed, uint256 amount, uint256 rung) public {
        address a = _actor(seed);
        amount = bound(amount, 100e6, 20_000e6);
        uint16 distance = _rung(rung);
        vm.prank(a);
        try pool.subscribe(0, distance, amount, type(uint256).max, uint64(block.timestamp + 1)) returns (
            uint256 id
        ) {
            ids.push(id);
            idOwner[id] = a;
            openDepositsUsdg += amount;
        } catch {}
    }

    function subscribeSellHigh(uint256 seed, uint256 amount, uint256 rung) public {
        address a = _actor(seed);
        amount = bound(amount, 1e18, 100e18);
        uint16 distance = _rung(rung);
        vm.prank(a);
        try pool.subscribe(1, distance, amount, 0, uint64(block.timestamp + 1)) returns (uint256 id) {
            ids.push(id);
            idOwner[id] = a;
            openDepositsToken += amount;
        } catch {}
    }

    function settleSome(uint256 seed) public {
        if (expiries.length == 0) return;
        uint64 e = expiries[seed % expiries.length];
        try pool.settle(e) {} catch {}
    }

    /// @notice Неделя закрывается так, как она закрывается на бирже: цена
    ///         приходит перед звонком, и после неё фид до понедельника молчит.
    ///         Без этого случайные прогоны до расчёта не доходят вовсе —
    ///         обновление цены всегда успевало обогнать экспирацию.
    function closeWeek(uint256 seed, uint256 price) public {
        if (expiries.length == 0) return;
        uint64 e = expiries[seed % expiries.length];
        if (pool.settlePriceWad(e) != 0) return;
        if (block.timestamp < e) vm.warp(uint256(e) + 1 hours);
        feed.push(int256(bound(price, 10e8, 1_000e8)), uint256(e) - 5 minutes);
        try pool.settle(e) {} catch {}
    }

    function claimSome(uint256 seed) public {
        if (ids.length == 0) return;
        uint256 id = ids[seed % ids.length];
        NuvoPool.Position memory p = pool.position(id);
        if (p.claimed) return;
        vm.prank(idOwner[id]);
        try pool.claim(id) {
            if (p.direction == 0) openDepositsUsdg -= p.deposit;
            else openDepositsToken -= p.deposit;
        } catch {}
    }

    /// @notice Двигает время и цену: без этого расчёт никогда не наступает.
    function advance(uint256 hoursAhead, uint256 price) public {
        vm.warp(block.timestamp + bound(hoursAhead, 1, 48) * 1 hours);
        feed.push(int256(bound(price, 10e8, 1_000e8)), block.timestamp);
    }
}
