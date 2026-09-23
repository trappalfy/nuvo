// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {NuvoPool} from "../../src/NuvoPool.sol";
import {NuvoPoolFactory} from "../../src/NuvoPoolFactory.sol";
import {PremiumModel} from "../../src/PremiumModel.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @notice Один прогон полного круга на форке мейннета. Без RPC_URL пропускается,
///         чтобы обычный forge test не требовал сети.
contract ForkTest is Test {
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    NuvoPoolFactory internal factory;
    NuvoPool internal pool;
    IERC20 internal usdg;
    IERC20 internal stock;
    IAggregatorV3 internal feed;

    address internal lp = address(0xB0B);
    address internal user = address(0xD00D);
    uint64 internal expiry;

    function setUp() public {
        string memory rpc = vm.envOr("RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);

        usdg = IERC20(USDG);
        feed = IAggregatorV3(vm.envAddress("FORK_FEED"));

        // Адреса токенизированных акций публично не перечислены, поэтому
        // FORK_TOKEN необязателен: без него на форке разворачивается свой ERC-20
        // с теми же восемнадцатью знаками. USDG и фид при этом настоящие —
        // ради них форк и нужен.
        address stockAddress = vm.envOr("FORK_TOKEN", address(0));
        if (stockAddress == address(0)) {
            stockAddress = address(new MockERC20("Tokenized NVDA", "NVDA", 18));
        }
        stock = IERC20(stockAddress);

        assertEq(IERC20Metadata(USDG).decimals(), 6, "USDG is six decimals on this chain");
        assertEq(IERC20Metadata(address(stock)).decimals(), 18, "stock tokens are eighteen");
        assertEq(feed.decimals(), 8, "feeds are eight");

        uint8[] memory dirs = new uint8[](2);
        uint16[] memory dist = new uint16[](2);
        uint16[] memory bps = new uint16[](2);
        (dirs[0], dist[0], bps[0]) = (0, 200, 120);
        (dirs[1], dist[1], bps[1]) = (1, 200, 110);
        PremiumModel model = new PremiumModel(dirs, dist, bps);

        factory = new NuvoPoolFactory(USDG, address(this));
        expiry = uint64(block.timestamp + 3 days);
        uint64[] memory list = new uint64[](1);
        list[0] = expiry;
        factory.addExpiries(list);

        pool = NuvoPool(
            factory.createPool(
                NuvoPool.Params({
                    usdg: USDG,
                    token: address(stock),
                    feed: address(feed),
                    premiumModel: address(model),
                    factory: address(factory),
                    owner: address(this),
                    guardian: address(this),
                    maxPremiumBps: 1_000,
                    maxPriceAge: 80 hours,
                    maxPriceAgeSettle: 6 hours,
                    minDepositValueWad: 10e18,
                    maxPositionValueWad: 1_000_000e18,
                    maxExpiryLockValueWad: 10_000_000e18,
                    maxLockedShareBps: 8_000
                })
            )
        );

        // This run is about the real chain and the real token, not about who
        // is let in; the allowlist has its own suite.
        pool.setAllowlist(false);

        // deal подбирает слот баланса перебором. Если токен окажется прокси со
        // своей раскладкой и deal не сработает, заменить на vm.prank крупного
        // держателя из обозревателя и обычный transfer.
        deal(USDG, lp, 200_000e6, true);
        deal(address(stock), lp, 2_000e18, true);
        deal(USDG, user, 10_000e6, true);
    }

    function test_fullCycleOnTheRealChain() public {
        if (address(pool) == address(0)) {
            vm.skip(true);
            return;
        }

        vm.startPrank(lp);
        usdg.approve(address(pool), type(uint256).max);
        stock.approve(address(pool), type(uint256).max);
        uint256 shares = pool.addLiquidity(200_000e6, 2_000e18, 0);
        vm.stopPrank();
        assertGt(shares, 0);

        NuvoPool.Preview memory q = pool.preview(0, 200, 1_000e6);
        assertEq(q.code, 0, "the live feed prices a subscription");
        assertGt(q.ifConverted, 0);
        assertEq(q.expiry, expiry);

        vm.startPrank(user);
        usdg.approve(address(pool), type(uint256).max);
        uint256 id = pool.subscribe(0, 200, 1_000e6, q.strikeWad, uint64(block.timestamp + 300));
        vm.stopPrank();
        assertEq(pool.depositsUsdg(), 1_000e6);

        // Настоящий фид нельзя сдвинуть во времени, поэтому на момент расчёта
        // подменяется только его ответ. Правила выбора раунда проверены в
        // NuvoPool.settle.t.sol, здесь важен весь остальной путь на живых контрактах.
        vm.warp(expiry + 1 hours);
        int256 halved = int256(q.priceWad / 1e10 / 2);
        vm.mockCall(
            address(feed),
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(uint80(1), halved, uint256(expiry), uint256(expiry), uint80(1))
        );
        vm.mockCall(
            address(feed),
            abi.encodeWithSelector(IAggregatorV3.getRoundData.selector, uint80(1)),
            abi.encode(uint80(1), halved, uint256(expiry), uint256(expiry), uint80(1))
        );
        pool.settle(expiry);
        assertGt(pool.settlePriceWad(expiry), 0);

        vm.prank(user);
        (address asset, uint256 amount) = pool.claim(id);
        assertEq(asset, address(stock), "price halved, so the deposit converts into the stock");
        assertEq(amount, q.ifConverted);
        assertEq(stock.balanceOf(user), q.ifConverted);
    }
}
