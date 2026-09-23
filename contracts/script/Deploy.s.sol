// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {NuvoPool} from "../src/NuvoPool.sol";
import {NuvoPoolFactory} from "../src/NuvoPoolFactory.sol";
import {PremiumModel} from "../src/PremiumModel.sol";

/// @notice Деплоит модель премий, фабрику и один пул, публикует календарь и
///         передаёт фабрику мультиподписи. Владелец пула — сразу мультиподпись.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address usdg = vm.envAddress("USDG_ADDRESS");
        address token = vm.envAddress("TOKEN_ADDRESS");
        address feed = vm.envAddress("FEED_ADDRESS");
        address multisig = vm.envAddress("OWNER_ADDRESS");
        uint64[] memory expiries = _expiries();

        vm.startBroadcast(pk);

        PremiumModel model = new PremiumModel(_dirs(), _dist(), _bps());
        NuvoPoolFactory factory = new NuvoPoolFactory(usdg, vm.addr(pk));
        factory.addExpiries(expiries);

        address pool = factory.createPool(
            NuvoPool.Params({
                usdg: usdg,
                token: token,
                feed: feed,
                premiumModel: address(model),
                factory: address(factory),
                owner: multisig,
                guardian: vm.envAddress("GUARDIAN_ADDRESS"),
                maxPremiumBps: uint16(vm.envUint("MAX_PREMIUM_BPS")),
                maxPriceAge: uint64(vm.envUint("MAX_PRICE_AGE")),
                maxPriceAgeSettle: uint64(vm.envUint("MAX_PRICE_AGE_SETTLE")),
                minDepositValueWad: vm.envUint("MIN_DEPOSIT_VALUE_WAD"),
                maxPositionValueWad: vm.envUint("MAX_POSITION_VALUE_WAD"),
                maxExpiryLockValueWad: vm.envUint("MAX_EXPIRY_LOCK_VALUE_WAD"),
                maxLockedShareBps: uint16(vm.envUint("MAX_LOCKED_SHARE_BPS"))
            })
        );

        // Фабрика переходит мультиподписи; она должна принять владение вторым шагом.
        factory.transferOwnership(multisig);
        vm.stopBroadcast();

        console.log("model", address(model));
        console.log("factory", address(factory));
        console.log("pool", pool);
    }

    function _expiries() internal view returns (uint64[] memory out) {
        uint256[] memory raw = vm.envUint("EXPIRIES", ",");
        out = new uint64[](raw.length);
        for (uint256 i = 0; i < raw.length; i++) out[i] = uint64(raw[i]);
    }

    function _dirs() internal pure returns (uint8[] memory d) {
        d = new uint8[](8);
        for (uint256 i = 0; i < 4; i++) {
            d[i] = 0;
            d[i + 4] = 1;
        }
    }

    function _dist() internal pure returns (uint16[] memory d) {
        d = new uint16[](8);
        uint16[4] memory rungs = [uint16(200), 400, 600, 800];
        for (uint256 i = 0; i < 4; i++) {
            d[i] = rungs[i];
            d[i + 4] = rungs[i];
        }
    }

    /// @dev Ставки первой недели. Пересматриваются выпуском новой модели.
    function _bps() internal pure returns (uint16[] memory b) {
        b = new uint16[](8);
        uint16[4] memory buyLow = [uint16(120), 85, 60, 40];
        uint16[4] memory sellHigh = [uint16(110), 80, 55, 35];
        for (uint256 i = 0; i < 4; i++) {
            b[i] = buyLow[i];
            b[i + 4] = sellHigh[i];
        }
    }
}
