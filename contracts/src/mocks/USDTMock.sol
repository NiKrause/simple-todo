// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test stand-in for the USDT mock behind Zama's Sepolia cUSDTMock: 6 decimals and a mint
/// anyone may call. Never deploy this anywhere that matters.
contract USDTMock is ERC20 {
    constructor() ERC20("Tether USD (Mock)", "USDTMock") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
