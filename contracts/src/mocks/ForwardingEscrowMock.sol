// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

/// @notice Test-only counterexample to ConfidentialTodoEscrow.lock: it hands the external handle and its
/// proof straight to the token instead of verifying them itself. The token then verifies the proof as
/// if the token were the contract and this contract the user, which is not what the creator encrypted
/// for. The tests show that this fails, and why binding the input the way the token expects is worse.
contract ForwardingEscrowMock is ZamaEthereumConfig {
    IERC7984 public immutable token;

    constructor(IERC7984 token_) {
        token = token_;
    }

    function lock(externalEuint64 encAmount, bytes calldata inputProof) external returns (euint64) {
        return token.confidentialTransferFrom(msg.sender, address(this), encAmount, inputProof);
    }
}
