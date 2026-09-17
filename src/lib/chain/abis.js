/**
 * The parts of the contracts escrow01 calls, as viem ABIs. The escrow's are
 * `contracts/src/ConfidentialTodoEscrow.sol`; the tokens are Zama's cUSDTMock
 * and its underlying USDTMock on Sepolia.
 */

import { parseAbi } from 'viem';

export const escrowAbi = parseAbi([
	'function lock(bytes32 todoRef, address beneficiary, bytes32 encAmount, bytes inputProof, uint64 deadline)',
	'function release(bytes32 todoRef)',
	'function refund(bytes32 todoRef)',
	'function escrowOf(address creator, bytes32 todoRef) view returns (address beneficiary, uint64 deadline, uint8 status, bytes32 amount)',
	'event Locked(address indexed creator, bytes32 indexed todoRef, address indexed beneficiary, uint64 deadline)',
	'event Released(address indexed creator, bytes32 indexed todoRef, address indexed beneficiary)',
	'event Refunded(address indexed creator, bytes32 indexed todoRef)'
]);

export const tokenAbi = parseAbi([
	'function wrap(address to, uint256 amount) returns (bytes32)',
	'function setOperator(address operator, uint48 until)',
	'function confidentialBalanceOf(address account) view returns (bytes32)'
]);

export const underlyingAbi = parseAbi([
	'function mint(address to, uint256 amount)',
	'function approve(address spender, uint256 value) returns (bool)'
]);

/** `ConfidentialTodoEscrow.Status`, by the number the contract returns. */
export const ESCROW_STATUS = /** @type {const} */ (['none', 'locked', 'released', 'refunded']);

export const ZERO_HANDLE = `0x${'00'.repeat(32)}`;
