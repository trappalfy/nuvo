// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";
import {MockFeed} from "../test/mocks/MockFeed.sol";

/// @notice Стенд для репетиции: свои USDG, своя акция, свой фид. Только для
///         локального anvil — в сети эти адреса берутся настоящие.
contract Mocks is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);

        vm.startBroadcast(pk);
        MockERC20 usdg = new MockERC20("Global Dollar", "USDG", 6);
        MockERC20 token = new MockERC20("Tokenized NVDA", "NVDA", 18);
        MockFeed feed = new MockFeed(8);
        feed.push(100e8, block.timestamp);
        usdg.mint(me, 10_000_000e6);
        token.mint(me, 100_000e18);
        vm.stopBroadcast();

        console.log("MOCK_USDG", address(usdg));
        console.log("MOCK_TOKEN", address(token));
        console.log("MOCK_FEED", address(feed));
    }
}
