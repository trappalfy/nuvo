// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SmokeTest is Test {
    function test_toolchainCompiles() public pure {
        assertTrue(type(IERC20).interfaceId != bytes4(0));
    }
}
