// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NuvoPool} from "../../src/NuvoPool.sol";
import {PremiumModel} from "../../src/PremiumModel.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockFeed} from "../mocks/MockFeed.sol";
import {MockFactory} from "../mocks/MockFactory.sol";
import {PoolHandler} from "./PoolHandler.sol";

contract PoolInvariants is Test {
    NuvoPool internal pool;
    MockERC20 internal usdg;
    MockERC20 internal stock;
    MockFeed internal feed;
    MockFactory internal factory;
    PoolHandler internal handler;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        stock = new MockERC20("Tokenized NVDA", "NVDA", 18);
        feed = new MockFeed(8);
        factory = new MockFactory();

        uint8[] memory dirs = new uint8[](8);
        uint16[] memory dist = new uint16[](8);
        uint16[] memory bps = new uint16[](8);
        uint16[4] memory rungs = [uint16(200), 400, 600, 800];
        uint16[4] memory rates = [uint16(120), 85, 60, 40];
        for (uint256 i = 0; i < 4; i++) {
            (dirs[i], dist[i], bps[i]) = (0, rungs[i], rates[i]);
            (dirs[i + 4], dist[i + 4], bps[i + 4]) = (1, rungs[i], rates[i]);
        }
        PremiumModel model = new PremiumModel(dirs, dist, bps);

        feed.push(100e8, block.timestamp);

        uint64[] memory schedule = new uint64[](8);
        for (uint256 i = 0; i < 8; i++) schedule[i] = uint64(block.timestamp + (i + 1) * 7 days);
        factory.setExpiries(schedule);

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
                maxExpiryLockValueWad: 1_000_000e18,
                maxLockedShareBps: 8_000
            })
        );

        // These suites test the pool itself, not who is let in.
        {
            address o_ = pool.owner();
            vm.prank(o_);
            pool.setAllowlist(false);
        }

        handler = new PoolHandler(pool, usdg, stock, feed, factory, schedule);
        targetContract(address(handler));
    }

    /// 1. Обязательства никогда не превышают того, что на самом деле лежит на контракте.
    function invariant_contractCoversEveryClaimOnIt() public view {
        assertGe(
            usdg.balanceOf(address(pool)),
            pool.freeUsdg() + pool.lockedUsdg() + pool.depositsUsdg() + pool.feesUsdg()
        );
        assertGe(
            stock.balanceOf(address(pool)),
            pool.freeToken() + pool.lockedToken() + pool.depositsToken() + pool.feesToken()
        );
    }

    /// 3. Депозиты подписчиков учтены отдельно и целиком: их нельзя потратить на чужую выплату.
    function invariant_subscriberDepositsAreUntouched() public view {
        assertEq(pool.depositsUsdg(), handler.openDepositsUsdg());
        assertEq(pool.depositsToken(), handler.openDepositsToken());
    }

    /// 4. Замки покрывают любой исход каждой незакрытой позиции.
    function invariant_locksCoverEveryOpenPosition() public view {
        uint256 lockedU;
        uint256 lockedT;
        uint256 n = pool.positionCount();
        for (uint256 i = 0; i < n; i++) {
            NuvoPool.Position memory p = pool.position(i);
            if (p.claimed) continue;
            lockedU += p.lockUsdg;
            lockedT += p.lockToken;
        }
        assertEq(pool.lockedUsdg(), lockedU);
        assertEq(pool.lockedToken(), lockedT);
    }

    /// 5. Паи появляются и исчезают только при вводе и выводе вкладчика.
    ///    В пуле, куда ещё не вкладывали, паёв нет вовсе; как только первый вклад
    ///    прошёл, к выданным долям добавляется запертая доля основания.
    function invariant_sharesOnlyMoveWithLiquidity() public view {
        if (pool.totalShares() == 0) {
            assertEq(handler.sharesMinted(), 0);
            assertEq(handler.sharesBurned(), 0);
            return;
        }
        assertEq(pool.totalShares() + handler.sharesBurned(), handler.sharesMinted() + 1e15);
    }

    /// 2. Свободный инвентарь неотрицателен: вычитание ниже нуля откатило бы действие,
    ///    здесь проверяется, что он к тому же покрыт балансом контракта.
    function invariant_freeInventoryIsReal() public view {
        assertLe(pool.freeUsdg() + pool.lockedUsdg(), usdg.balanceOf(address(pool)));
        assertLe(pool.freeToken() + pool.lockedToken(), stock.balanceOf(address(pool)));
    }
}
