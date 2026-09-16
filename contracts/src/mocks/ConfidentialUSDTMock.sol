// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {
    ERC7984ERC20Wrapper
} from "@openzeppelin/confidential-contracts/token/ERC7984/extensions/ERC7984ERC20Wrapper.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Test stand-in for Zama's Sepolia cUSDTMock: OpenZeppelin's ERC-7984 wrapper around an
/// ERC-20, with the same name, symbol and (for a 6-decimal underlying) a rate of 1.
contract ConfidentialUSDTMock is ZamaEthereumConfig, ERC7984ERC20Wrapper {
    constructor(IERC20 underlying_)
        ERC7984("Confidential USDT (Mock)", "cUSDTMock", "")
        ERC7984ERC20Wrapper(underlying_)
    {}
}
