// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {INuvoPoolFactory} from "../../src/interfaces/INuvoPoolFactory.sol";

contract MockFactory is INuvoPoolFactory {
    uint64[] public expiries;

    function setExpiries(uint64[] calldata list) external {
        delete expiries;
        for (uint256 i = 0; i < list.length; i++) expiries.push(list[i]);
    }

    function nextExpiry(uint64 minLead) external view returns (uint64) {
        uint64 threshold = uint64(block.timestamp) + minLead;
        for (uint256 i = 0; i < expiries.length; i++) {
            if (expiries[i] > threshold) return expiries[i];
        }
        return 0;
    }
}
