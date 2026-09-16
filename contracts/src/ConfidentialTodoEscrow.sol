// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

/**
 * @title ConfidentialTodoEscrow
 * @notice Holds the budget of a delegated todo in an ERC-7984 confidential token until the todo's
 * creator releases it to the beneficiary, or takes it back after a deadline. The amount is an
 * encrypted `euint64` from the creator's input to the beneficiary's balance: the creator, the
 * beneficiary and the auditor can decrypt it, and nobody else.
 *
 * What stays public: who locks, for whom, when, the deadline, which function was called and the
 * todo reference. So `todoRef` must not be a todo's plain id. Compute it off-chain as a salted hash,
 * for example `keccak256(abi.encode(todoId, salt))` with 32 random bytes of `salt` kept with the todo
 * and shared with the beneficiary. Without the salt, anyone who knows a todo's id can find its escrow.
 *
 * Escrows are keyed by creator and `todoRef` together. {release} and {refund} look the escrow up
 * under `msg.sender`, which is what makes them creator-only, and nobody can block a creator's
 * `todoRef` by locking under it first. A `todoRef` is used once per creator: after a release or a
 * refund, locking again needs a new reference (a new salt).
 *
 * The token is fixed at deployment and must declare ERC-7984 through ERC-165. There is no owner,
 * no fee and no way to move a locked amount other than {release} and {refund}.
 */
contract ConfidentialTodoEscrow is ZamaEthereumConfig {
    enum Status {
        None,
        Locked,
        Released,
        Refunded
    }

    struct Escrow {
        address beneficiary;
        uint64 deadline;
        Status status;
        euint64 amount;
    }

    /// @notice The furthest a deadline may lie in the future. Mostly catches a deadline given in
    /// milliseconds, which would otherwise keep the creator from a refund for millennia.
    uint64 public constant MAX_LOCK_DURATION = 365 days;

    /// @notice The only token this escrow accepts.
    IERC7984 public immutable token;

    /// @notice May decrypt every amount locked here. Fixed at deployment.
    address public immutable auditor;

    mapping(address creator => mapping(bytes32 todoRef => Escrow)) private _escrows;

    /// @dev Events carry no amounts and no amount handles.
    event Locked(address indexed creator, bytes32 indexed todoRef, address indexed beneficiary, uint64 deadline);
    event Released(address indexed creator, bytes32 indexed todoRef, address indexed beneficiary);
    event Refunded(address indexed creator, bytes32 indexed todoRef);

    error TokenNotERC7984(address token);
    error ZeroAuditor();
    error ZeroTodoRef();
    error InvalidBeneficiary(address beneficiary);
    error InvalidDeadline(uint64 deadline);
    error EscrowExists(address creator, bytes32 todoRef);
    error EscrowNotFound(address creator, bytes32 todoRef);
    error EscrowClosed(address creator, bytes32 todoRef, Status status);
    error DeadlineNotReached(uint64 deadline);

    constructor(IERC7984 token_, address auditor_) {
        if (!ERC165Checker.supportsInterface(address(token_), type(IERC7984).interfaceId)) {
            revert TokenNotERC7984(address(token_));
        }
        if (auditor_ == address(0)) revert ZeroAuditor();
        token = token_;
        auditor = auditor_;
    }

    /**
     * @notice Locks a budget for `todoRef`, pulled from the caller, for `beneficiary`, refundable to the
     * caller after `deadline`.
     * @dev Two things must be in place before the call:
     * - the caller made this contract an operator on the token (`token.setOperator(escrow, until)`),
     *   best with an `until` only minutes away. The escrow only ever pulls from `msg.sender`, so nobody
     *   else can spend that approval through it;
     * - `encAmount` and `inputProof` were encrypted for this contract and the caller, i.e.
     *   `createEncryptedInput(escrowAddress, callerAddress)`. The proof is bound to both, so a copy
     *   taken from the mempool is useless to anyone else.
     *
     * With an empty `inputProof`, `FHE.fromExternal` takes `encAmount` as an existing handle, provided
     * the caller may use it, and this contract must be allowed on it as well: in practice, the amount
     * of an earlier escrow locked again without encrypting it again.
     *
     * An ERC-7984 transfer does not revert when the balance is too low; it moves an encrypted 0. The
     * escrow stores the handle the token returns, the amount actually transferred, so it never promises
     * more than it holds. The lock succeeds either way and nobody on-chain can tell which happened: the
     * creator should decrypt the stored amount (see {escrowOf}) before handing the todo over.
     */
    function lock(
        bytes32 todoRef,
        address beneficiary,
        externalEuint64 encAmount,
        bytes calldata inputProof,
        uint64 deadline
    ) external {
        if (todoRef == bytes32(0)) revert ZeroTodoRef();
        if (beneficiary == address(0) || beneficiary == address(this)) revert InvalidBeneficiary(beneficiary);
        if (deadline <= block.timestamp || deadline > block.timestamp + MAX_LOCK_DURATION) {
            revert InvalidDeadline(deadline);
        }

        Escrow storage escrow = _escrows[msg.sender][todoRef];
        if (escrow.status != Status.None) revert EscrowExists(msg.sender, todoRef);

        // Recorded before the token is called, so the escrow already exists if anything re-enters.
        escrow.beneficiary = beneficiary;
        escrow.deadline = deadline;
        escrow.status = Status.Locked;

        // Verified here rather than in the token, so the proof is bound to this contract and the
        // creator. The token needs its own (transient) permission to compute with the amount.
        euint64 requested = FHE.fromExternal(encAmount, inputProof);
        FHE.allowTransient(requested, address(token));
        euint64 transferred = token.confidentialTransferFrom(msg.sender, address(this), requested);

        // The token already grants itself, the sender and the recipient access to what it returns,
        // but IERC7984 does not promise that; the escrow grants what it relies on itself.
        FHE.allowThis(transferred);
        FHE.allow(transferred, msg.sender);
        FHE.allow(transferred, beneficiary);
        FHE.allow(transferred, auditor);
        escrow.amount = transferred;

        emit Locked(msg.sender, todoRef, beneficiary, deadline);
    }

    /**
     * @notice Sends the amount locked under the caller's `todoRef` to its beneficiary.
     * @dev Only the creator can release, at any time while the escrow is locked, including after the
     * deadline. The beneficiary has no on-chain claim: releasing stays the creator's decision.
     */
    function release(bytes32 todoRef) external {
        Escrow storage escrow = _lockedEscrow(msg.sender, todoRef);
        escrow.status = Status.Released;
        _send(escrow.amount, escrow.beneficiary);
        emit Released(msg.sender, todoRef, escrow.beneficiary);
    }

    /// @notice Returns the amount locked under the caller's `todoRef` to the caller once the deadline
    /// has passed, that is from the first block whose timestamp is later than the deadline.
    function refund(bytes32 todoRef) external {
        Escrow storage escrow = _lockedEscrow(msg.sender, todoRef);
        if (block.timestamp <= escrow.deadline) revert DeadlineNotReached(escrow.deadline);
        escrow.status = Status.Refunded;
        _send(escrow.amount, msg.sender);
        emit Refunded(msg.sender, todoRef);
    }

    /**
     * @notice The escrow `creator` holds under `todoRef`.
     * @return beneficiary Who a release pays.
     * @return deadline Once a block is later than this, the creator may take the amount back.
     * @return status None, Locked, Released or Refunded.
     * @return amount Handle of the locked amount. Stays decryptable by the creator, the beneficiary
     * and the auditor after a release or refund, as a record of what was locked.
     */
    function escrowOf(address creator, bytes32 todoRef)
        external
        view
        returns (address beneficiary, uint64 deadline, Status status, euint64 amount)
    {
        Escrow storage escrow = _escrows[creator][todoRef];
        return (escrow.beneficiary, escrow.deadline, escrow.status, escrow.amount);
    }

    function _lockedEscrow(address creator, bytes32 todoRef) private view returns (Escrow storage escrow) {
        escrow = _escrows[creator][todoRef];
        if (escrow.status == Status.None) revert EscrowNotFound(creator, todoRef);
        if (escrow.status != Status.Locked) revert EscrowClosed(creator, todoRef, escrow.status);
    }

    function _send(euint64 amount, address to) private {
        // The token computes with the amount, so it needs permission to use it. OpenZeppelin's ERC7984
        // kept a persistent one when it returned this handle from the lock, but IERC7984 does not
        // promise that, so the escrow grants one for this transaction. The escrow holds at least what
        // was locked, so the transfer moves all of it.
        FHE.allowTransient(amount, address(token));
        token.confidentialTransfer(to, amount);
    }
}
