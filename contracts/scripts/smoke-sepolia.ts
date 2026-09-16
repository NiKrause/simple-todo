/**
 * Smoke-tests ConfidentialTodoEscrow on Sepolia against Zama's live relayer and KMS.
 *
 *   npm run smoke:sepolia:dry   # needs no key: signs nothing, sends nothing
 *   npm run smoke:sepolia       # full run: DEPLOYER_PRIVATE_KEY locks and releases cUSDTMock and pays the gas
 *
 * Read from contracts/.env (git ignores it; see .env.example) or the shell, which wins:
 *
 *   SEPOLIA_RPC_URL=https://...  # required, never printed
 *   DEPLOYER_PRIVATE_KEY=0x...   # full run only: the creator. The dry run never reads it.
 *   ESCROW_ADDRESS=0x...         # optional, defaults to the deployment recorded in README.md
 *   SMOKE_AMOUNT=1               # optional, in cUSDTMock with up to 6 decimals, default 1
 *   SMOKE_REFUND=1               # optional, full run: also lock with a 90 s deadline and refund
 *   SMOKE_DEBUG=1                # optional: SDK diagnostics, and @fhevm/sdk's own trace of each relayer request
 *
 * The dry run checks the chain, the escrow and its token, encrypts SMOKE_AMOUNT for (escrow, a random
 * address) through the relayer, simulates the lock that input makes (eth_call), public-decrypts an amount
 * cUSDTMock published for decryption, and prints the plan of the full run.
 *
 * The full run's beneficiary is a wallet made in memory for the run. It only signs decryption requests, so
 * it needs no ETH. Its key is never printed and is gone when the run ends, with what it received.
 *
 * Every relayer call (encrypt, decrypt) gets 3 attempts, 10 s and 30 s apart, and every failure is logged
 * with the SDK's own message: that is the part of Sepolia that has been flaky. Transactions are not
 * retried. The run exits with 1 if any step failed.
 *
 * Expects the escrow's token to be Zama's cUSDTMock: ConfidentialWrapper (verified on Sourcify) behind an
 * ERC-1967 proxy, over USDTMock (verified on Blockscout).
 */
import { readFileSync } from "node:fs";
import { dirname } from "node:path";

import { createConfig, MemoryStorage, ZamaSDK, type GenericLogger } from "@zama-fhe/sdk";
import { sepolia as sepoliaFhe } from "@zama-fhe/sdk/chains";
import { EthersProvider, EthersSigner } from "@zama-fhe/sdk/ethers";
import { node as nodeRelayer } from "@zama-fhe/sdk/node";
import {
  AbiCoder,
  Contract,
  formatEther,
  formatUnits,
  getAddress,
  hexlify,
  Interface,
  isAddress,
  JsonRpcProvider,
  keccak256,
  parseUnits,
  randomBytes,
  Wallet,
  ZeroHash,
  type ContractTransactionReceipt,
  type ContractTransactionResponse,
  type ErrorDescription,
  type Signer,
} from "ethers";
import { network } from "hardhat";

import { ConfidentialTodoEscrow__factory, type ConfidentialTodoEscrow } from "../types";

const DEFAULT_ESCROW = "0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429";
const SEPOLIA_CHAIN_ID = 11155111n;
// ZamaConfig's confidential protocol id for Zama's testnet.
const ZAMA_TESTNET_PROTOCOL_ID = 10001n;
const ETHERSCAN_TX = "https://sepolia.etherscan.io/tx/";

const RELAYER_ATTEMPTS = 3;
const RELAYER_BACKOFF_MS = [10_000, 30_000];
// Bounds one relayer request inside the SDK, whose default is an hour.
const RELAYER_REQUEST_TIMEOUT_MS = 120_000;
// Bounds a whole attempt, including the SDK's start-up (FHE key download, WASM), which the SDK does not bound.
const RELAYER_ATTEMPT_TIMEOUT_MS = 240_000;

// Blocks to wait before decrypting what a transaction produced. The relayer checks the ACL against its own
// view of the chain; in the incident of 2026-08-31 part of it read stale RPC data and fresh handles failed.
const CONFIRMATIONS_BEFORE_DECRYPT = 2;
const TX_TIMEOUT_MS = 10 * 60_000;

const OPERATOR_SECONDS = 60 * 60;
const LOCK_SECONDS = 24 * 60 * 60;
const REFUND_LOCK_SECONDS = 90;
const REFUND_WAIT_LIMIT_MS = 5 * 60_000;
// More than any euint64 balance can hold, so the lock must move an encrypted 0.
const MAX_UINT64 = 2n ** 64n - 1n;

// Where the dry run looks for an amount cUSDTMock made publicly decryptable (an unwrap request).
const UNWRAP_SEARCH_BLOCKS = 5_000;
const UNWRAP_SEARCH_CHUNK = 500;
const UNWRAP_MIN_AGE_BLOCKS = 20;

// Rough gas per transaction, for the plan and the balance check; the run prints what it paid. USDTMock and
// cUSDTMock calls as mined on Sepolia in September 2026, lock from eth_estimateGas on Sepolia, release and
// refund from the FHEVM mock in `npm test` scaled by the lock's ratio (1.3).
const GAS = {
  mint: 52_000n,
  approve: 47_000n,
  wrap: 350_000n,
  setOperator: 52_000n,
  lock: 710_000n,
  release: 460_000n,
  refund: 430_000n,
};

// ConfidentialTodoEscrow.Status
const STATUS = ["None", "Locked", "Released", "Refunded"] as const;
type StatusName = (typeof STATUS)[number];

// cUSDTMock is an ERC-1967 proxy. Its implementation, ConfidentialWrapper at
// 0xAe37b998d453E1FaBE85DD46cf04295ca4A3af04, is verified on Sourcify (exact match); these are the
// signatures that source declares, for what this script calls or decodes.
const TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function rate() view returns (uint256)",
  "function underlying() view returns (address)",
  "function paused() view returns (bool)",
  "function observers() view returns (address[])",
  "function isBlocked(address user) view returns (bool)",
  "function isOperator(address holder, address spender) view returns (bool)",
  "function setOperator(address operator, uint48 until)",
  "function confidentialBalanceOf(address account) view returns (bytes32)",
  "function wrap(address to, uint256 amount) returns (bytes32)",
  "event UnwrapRequested(address indexed receiver, bytes32 indexed unwrapRequestId, bytes32 amount)",
  "error ERC7984UnauthorizedSpender(address holder, address spender)",
  "error ERC7984TotalSupplyOverflow()",
  "error EnforcedPause()",
  "error WrapperBlockedAddress(address user)",
  "error UnderlyingDenyListedAddress(address user)",
];

// USDTMock, verified on Blockscout: OpenZeppelin's ERC20 with 6 decimals, a mint anyone may call for up to
// MAX_MINT_AMOUNT_TOKENS whole tokens at a time, and USDT's approve rule: a non-zero allowance goes to 0 first.
const UNDERLYING_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function MAX_MINT_AMOUNT_TOKENS() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function mint(address to, uint256 amount)",
  "error MintAmountExceedsMax(uint256 amount, uint256 maxAmount)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
];

// How Sepolia's InputVerifier rejects an input proof made for another contract or user.
const INPUT_VERIFIER_ABI = ["error InvalidSigner(address signerRecovered)"];

type Context = {
  provider: JsonRpcProvider;
  rpcUrl: string;
  debug: boolean;
  refund: boolean;
  runLabel: string;
  escrowAddress: string;
  escrow: ConfidentialTodoEscrow;
  auditor: string;
  tokenAddress: string;
  token: Contract;
  symbol: string;
  decimals: number;
  rate: bigint;
  underlyingAddress: string;
  underlying: Contract;
  underlyingSymbol: string;
  underlyingDecimals: number;
  mintCap: bigint;
  amount: bigint;
};

// ----- Output --------------------------------------------------------------------------------------------

type Row = { step: string; outcome: "ok" | "FAIL" | "skip"; ms?: number; attempts?: number; tx?: string };

const rows: Row[] = [];
const secrets = new Set<string>();
let spentWei = 0n;
let mined = 0;
let unexpectedErrors = 0;
let balanceLine: string | undefined;

function keepSecret(value: string | undefined) {
  if (!value || value.length < 8) return;
  secrets.add(value);
  secrets.add(value.toLowerCase());
  if (value.startsWith("0x")) secrets.add(value.slice(2).toLowerCase());
}

/** Everything printed goes through here, so the RPC URL and the keys cannot leak into the log. */
function log(line = "") {
  let text = line;
  for (const secret of secrets) text = text.split(secret).join("[redacted]");
  console.log(text);
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** An error with its causes, as the SDK or ethers reported them. */
function describe(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 6; depth++) {
    if (!(current instanceof Error)) {
      parts.push(String(current));
      break;
    }
    const { code, statusCode } = current as { code?: unknown; statusCode?: unknown };
    const tags = [
      code === undefined ? "" : `code=${String(code)}`,
      statusCode === undefined ? "" : `status=${String(statusCode)}`,
    ];
    const tagText = tags.filter(Boolean).join(", ");
    parts.push(`${current.name}: ${current.message}${tagText ? ` [${tagText}]` : ""}`);
    if (current instanceof AggregateError) {
      for (const inner of current.errors)
        parts.push(inner instanceof Error ? `${inner.name}: ${inner.message}` : String(inner));
    }
    current = current.cause;
  }
  return parts.join("\n      caused by ");
}

// ----- Steps ---------------------------------------------------------------------------------------------

type Done<T> = { value: T; detail?: string | string[]; attempts?: number; tx?: string };

class StepFailure extends Error {
  constructor(
    message: string,
    readonly attempts?: number,
    readonly tx?: string,
  ) {
    super(message);
  }
}

/** Runs one step, logs it and records it for the table. Returns undefined when the step failed. */
async function step<T>(name: string, body: () => Promise<Done<T>>): Promise<T | undefined> {
  log(`\n${name}`);
  const started = performance.now();
  try {
    const { value, detail, attempts, tx } = await body();
    const ms = performance.now() - started;
    rows.push({ step: name, outcome: "ok", ms, attempts, tx });
    const lines = detail === undefined ? [] : Array.isArray(detail) ? detail : [detail];
    log(`  ok, ${seconds(ms)}${lines.length === 1 ? `: ${lines[0]}` : ""}`);
    if (lines.length > 1) for (const line of lines) log(`    ${line}`);
    return value;
  } catch (error) {
    const ms = performance.now() - started;
    const failure = error instanceof StepFailure ? error : undefined;
    rows.push({ step: name, outcome: "FAIL", ms, attempts: failure?.attempts, tx: failure?.tx });
    log(`  FAILED, ${seconds(ms)}: ${failure ? failure.message : describe(error)}`);
    return undefined;
  }
}

function skip(name: string, reason: string) {
  rows.push({ step: name, outcome: "skip" });
  log(`\n${name}\n  skipped: ${reason}`);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no result within ${ms / 1000} s (the smoke test's own limit)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** A lazily built SDK instance that a failed attempt replaces. */
class SdkSlot {
  #sdk: Promise<ZamaSDK> | undefined;

  constructor(private readonly build: () => Promise<ZamaSDK>) {}

  get(): Promise<ZamaSDK> {
    return (this.#sdk ??= this.build());
  }

  /** The SDK keeps a failed start-up (FHE key, WASM) for good, so the next attempt gets a new instance. */
  reset() {
    const previous = this.#sdk;
    this.#sdk = undefined;
    previous?.then((sdk) => sdk.terminate()).catch(() => undefined);
  }
}

/** A relayer call with bounded retries. Each failure is logged as the SDK reported it. */
async function relayer<T>(slot: SdkSlot, call: (sdk: ZamaSDK) => Promise<T>): Promise<{ value: T; attempts: number }> {
  for (let attempt = 1; ; attempt++) {
    const started = performance.now();
    try {
      return { value: await withTimeout(slot.get().then(call), RELAYER_ATTEMPT_TIMEOUT_MS), attempts: attempt };
    } catch (error) {
      log(
        `  attempt ${attempt} of ${RELAYER_ATTEMPTS} failed, ${seconds(performance.now() - started)}: ${describe(error)}`,
      );
      slot.reset();
      if (attempt >= RELAYER_ATTEMPTS) {
        throw new StepFailure(`all ${RELAYER_ATTEMPTS} attempts failed, see above`, attempt);
      }
      const pause = RELAYER_BACKOFF_MS[Math.min(attempt, RELAYER_BACKOFF_MS.length) - 1];
      log(`  next attempt in ${pause / 1000} s`);
      await sleep(pause);
    }
  }
}

/** Sends a transaction and waits for it; counts what it cost even if it reverted. */
async function transact(
  send: () => Promise<ContractTransactionResponse>,
  confirmations = 1,
): Promise<{ receipt: ContractTransactionReceipt; tx: string }> {
  let response: ContractTransactionResponse;
  try {
    response = await send();
  } catch (error) {
    throw new StepFailure(`not sent: ${revertReason(error)}`);
  }
  log(
    `  sent ${ETHERSCAN_TX}${response.hash}, waiting for ${confirmations} confirmation${confirmations > 1 ? "s" : ""}`,
  );
  try {
    const receipt = await response.wait(confirmations, TX_TIMEOUT_MS);
    if (!receipt) throw new Error("the RPC returned no receipt");
    spentWei += receipt.fee;
    mined += 1;
    return { receipt, tx: response.hash };
  } catch (error) {
    const receipt = (error as { receipt?: { fee: bigint } | null }).receipt;
    if (receipt) {
      spentWei += receipt.fee;
      mined += 1;
    }
    throw new StepFailure(
      `${receipt ? "reverted" : "not confirmed"}: ${revertReason(error)}`,
      undefined,
      response.hash,
    );
  }
}

// ----- Chain helpers -------------------------------------------------------------------------------------

let errorInterface: Interface | undefined;

function knownErrors(): Interface {
  return (errorInterface ??= new Interface([
    ...ConfidentialTodoEscrow__factory.createInterface().fragments.filter((fragment) => fragment.type === "error"),
    ...[...TOKEN_ABI, ...UNDERLYING_ABI, ...INPUT_VERIFIER_ABI].filter((line) => line.startsWith("error ")),
  ]));
}

/** Revert data, wherever the provider put it on the error. */
function revertData(error: unknown): string | undefined {
  type WithData = { data?: unknown; error?: WithData; info?: { error?: WithData } };
  const candidates = [error as WithData, (error as WithData)?.error, (error as WithData)?.info?.error];
  const data = candidates.map((candidate) => candidate?.data).find((value) => typeof value === "string");
  return typeof data === "string" && data.length >= 10 ? data : undefined;
}

function parseRevert(error: unknown): ErrorDescription | undefined {
  const data = revertData(error);
  if (!data) return undefined;
  try {
    return knownErrors().parseError(data) ?? undefined;
  } catch {
    return undefined;
  }
}

function formatError(parsed: ErrorDescription): string {
  return `${parsed.name}(${parsed.args.map(String).join(", ")})`;
}

function revertReason(error: unknown): string {
  const parsed = parseRevert(error);
  if (parsed) return formatError(parsed);
  const { shortMessage, message } = (error ?? {}) as { shortMessage?: string; message?: string };
  const data = revertData(error);
  return `${shortMessage ?? message ?? String(error)}${data ? ` (revert data ${data})` : ""}`;
}

function hex(value: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]*$/.test(value)) throw new Error(`not a hex string: ${value}`);
  return value as `0x${string}`;
}

function randomAddress(): string {
  return getAddress(hexlify(randomBytes(20)));
}

function iso(unixSeconds: number | bigint): string {
  return new Date(Number(unixSeconds) * 1000).toISOString();
}

/** A todo reference as a client computes it: keccak256(abi.encode(label, salt)), salt random. */
function todoRef(ctx: Context): string {
  const salt = hexlify(randomBytes(32));
  return keccak256(AbiCoder.defaultAbiCoder().encode(["string", "bytes32"], [ctx.runLabel, salt]));
}

async function latestTimestamp(ctx: Context): Promise<number> {
  const block = await ctx.provider.getBlock("latest");
  if (!block) throw new Error("the RPC returned no latest block");
  return block.timestamp;
}

function tokens(ctx: Context, amount: bigint): string {
  return `${formatUnits(amount, ctx.decimals)} ${ctx.symbol}`;
}

function underlyingTokens(ctx: Context, amount: bigint): string {
  return `${formatUnits(amount, ctx.underlyingDecimals)} ${ctx.underlyingSymbol}`;
}

function hasEvent(
  ctx: Context,
  receipt: ContractTransactionReceipt,
  name: "Locked" | "Released" | "Refunded",
): boolean {
  return receipt.logs.some((entry) => {
    if (getAddress(entry.address) !== ctx.escrowAddress) return false;
    try {
      return ctx.escrow.interface.parseLog(entry)?.name === name;
    } catch {
      return false;
    }
  });
}

function plannedGas(refund: boolean, funding: boolean): bigint {
  let gas = GAS.setOperator + 2n * GAS.lock + GAS.release;
  if (funding) gas += GAS.mint + GAS.approve + GAS.wrap;
  if (refund) gas += GAS.lock + GAS.refund;
  return gas;
}

function millionGas(gas: bigint): string {
  return (Number(gas) / 1e6).toFixed(1);
}

// ----- Relayer helpers -----------------------------------------------------------------------------------

const sdkLogger: GenericLogger = {
  error: (message, data) => log(`  [sdk error] ${message}${sdkData(data)}`),
  warn: (message, data) => log(`  [sdk warn] ${message}${sdkData(data)}`),
  info: (message, data) => log(`  [sdk info] ${message}${sdkData(data)}`),
  debug: (message, data) => log(`  [sdk debug] ${message}${sdkData(data)}`),
};

function sdkData(data: Record<string, unknown> | undefined): string {
  if (!data) return "";
  try {
    return ` ${JSON.stringify(data, (_, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value instanceof Error ? describe(value) : value,
    )}`;
  } catch {
    return "";
  }
}

/** An SDK instance for Sepolia; with a signer it can user-decrypt as that account. */
function sdkSlot(ctx: Context, signer?: Signer): SdkSlot {
  return new SdkSlot(async () => {
    const chain = { ...sepoliaFhe, network: ctx.rpcUrl };
    let zamaSigner: EthersSigner | undefined;
    if (signer) {
      zamaSigner = new EthersSigner({ signer });
      // Otherwise the account is looked up in the background, and a decryption may start before it is known.
      await zamaSigner.refreshWalletAccount();
    }
    return new ZamaSDK(
      createConfig({
        chains: [chain],
        provider: new EthersProvider({ provider: ctx.provider }),
        signer: zamaSigner,
        relayers: { [chain.id]: nodeRelayer({ timeout: RELAYER_REQUEST_TIMEOUT_MS, debug: ctx.debug }) },
        storage: new MemoryStorage(),
        logger: ctx.debug ? sdkLogger : undefined,
      }),
    );
  });
}

function clearValueOf(values: Record<string, unknown>, handle: string): bigint {
  const entry = Object.entries(values).find(([key]) => key.toLowerCase() === handle.toLowerCase());
  if (!entry) throw new Error(`the SDK returned no clear value for ${handle}`);
  const value = entry[1];
  if (typeof value === "bigint") return value;
  if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) return BigInt(value);
  throw new Error(`the clear value of ${handle} is not a number: ${String(value)}`);
}

async function encrypt(ctx: Context, slot: SdkSlot, amount: bigint, user: string) {
  return relayer(slot, (sdk) =>
    sdk.encrypt({
      values: [{ type: "euint64", value: amount }],
      contractAddress: hex(ctx.escrowAddress),
      userAddress: hex(user),
    }),
  );
}

/** User decryption through the relayer, signed by the slot's account. */
async function userDecrypt(
  slot: SdkSlot,
  handle: string,
  contract: string,
): Promise<{ value: bigint; attempts?: number }> {
  // A balance that was never written has no ciphertext yet; the SDK answers 0 without asking the relayer.
  if (handle === ZeroHash) return { value: 0n };
  const { value, attempts } = await relayer(slot, (sdk) =>
    sdk.decryption.decryptValues([{ encryptedValue: hex(handle), contractAddress: hex(contract) }]),
  );
  return { value: clearValueOf(value, handle), attempts };
}

async function decryptBalance(ctx: Context, slot: SdkSlot, holder: string): Promise<Done<bigint>> {
  const handle: string = await ctx.token.confidentialBalanceOf(holder);
  const { value, attempts } = await userDecrypt(slot, handle, ctx.tokenAddress);
  return { value, attempts, detail: handle === ZeroHash ? `${tokens(ctx, value)}, never funded` : tokens(ctx, value) };
}

// ----- Steps shared by the full run ----------------------------------------------------------------------

async function expectEscrow(
  ctx: Context,
  creator: string,
  ref: string,
  status: StatusName,
  beneficiary: string,
  which?: string,
): Promise<string | undefined> {
  return step(`escrowOf: ${status}${which ? ` (${which})` : ""}`, async () => {
    const escrow = await ctx.escrow.escrowOf(creator, ref);
    const actual = STATUS[Number(escrow.status)] ?? `status ${escrow.status}`;
    if (actual !== status) throw new Error(`escrowOf says ${actual}`);
    if (getAddress(escrow.beneficiary) !== getAddress(beneficiary)) {
      throw new Error(`the beneficiary is ${escrow.beneficiary}, not ${beneficiary}`);
    }
    return { value: escrow.amount, detail: `amount handle ${escrow.amount}` };
  });
}

async function expectDecrypted(
  ctx: Context,
  name: string,
  slot: SdkSlot,
  handle: string,
  contract: string,
  expected: bigint,
): Promise<bigint | undefined> {
  return step(name, async () => {
    const { value, attempts } = await userDecrypt(slot, handle, contract);
    if (value !== expected) {
      throw new StepFailure(`decrypted ${tokens(ctx, value)}, expected ${tokens(ctx, expected)}`, attempts);
    }
    return { value, attempts, detail: tokens(ctx, value) };
  });
}

/** Encrypts `amount` for (escrow, creator) and locks it under a fresh todoRef. */
async function lock(
  ctx: Context,
  slot: SdkSlot,
  creator: Wallet,
  beneficiary: string,
  names: { encrypt: string; lock: string },
  amount: bigint,
  duration: number,
): Promise<{ ref: string; deadline: number } | undefined> {
  const input = await step(names.encrypt, async () => {
    const { value, attempts } = await encrypt(ctx, slot, amount, creator.address);
    return { value, attempts, detail: `handle ${value.encryptedValues[0]}` };
  });
  if (!input) {
    skip(names.lock, "there is no encrypted amount");
    return undefined;
  }
  return step(names.lock, async () => {
    const ref = todoRef(ctx);
    const deadline = (await latestTimestamp(ctx)) + duration;
    const escrow = ctx.escrow.connect(creator);
    const { receipt, tx } = await transact(
      () => escrow.lock(ref, beneficiary, input.encryptedValues[0], input.inputProof, deadline),
      CONFIRMATIONS_BEFORE_DECRYPT,
    );
    if (!hasEvent(ctx, receipt, "Locked")) throw new StepFailure("the receipt has no Locked event", undefined, tx);
    return { value: { ref, deadline }, tx, detail: [`todoRef ${ref}`, `deadline ${iso(deadline)}`] };
  });
}

/** Mints, approves and wraps what the creator lacks. */
async function fund(ctx: Context, creator: Wallet, shortfall: bigint) {
  const needed = shortfall * ctx.rate;
  const underlying = new Contract(ctx.underlyingAddress, UNDERLYING_ABI, creator);
  const token = new Contract(ctx.tokenAddress, TOKEN_ABI, creator);

  const holdings = await step(`read ${ctx.underlyingSymbol} balance and allowance`, async () => {
    const [held, allowance]: bigint[] = await Promise.all([
      ctx.underlying.balanceOf(creator.address),
      ctx.underlying.allowance(creator.address, ctx.tokenAddress),
    ]);
    return {
      value: { held, allowance },
      detail: `${underlyingTokens(ctx, held)} held, ${underlyingTokens(ctx, allowance)} approved for ${ctx.symbol}`,
    };
  });
  if (!holdings) {
    skip(`wrap ${underlyingTokens(ctx, needed)}`, `the ${ctx.underlyingSymbol} balance and allowance are unknown`);
    return;
  }

  if (holdings.held >= needed) {
    skip(`mint ${ctx.underlyingSymbol}`, `the creator holds ${underlyingTokens(ctx, holdings.held)} already`);
  } else {
    const toMint = needed - holdings.held;
    await step(`mint ${underlyingTokens(ctx, toMint)}`, async () => {
      if (toMint > ctx.mintCap) {
        throw new Error(
          `${ctx.underlyingSymbol} mints at most ${underlyingTokens(ctx, ctx.mintCap)} a call; lower SMOKE_AMOUNT`,
        );
      }
      const { tx } = await transact(() => underlying.mint(creator.address, toMint));
      return { value: true, tx };
    });
  }

  if (holdings.allowance >= needed) {
    skip(`approve ${ctx.underlyingSymbol}`, `the allowance of ${underlyingTokens(ctx, holdings.allowance)} is enough`);
  } else {
    if (holdings.allowance > 0n) {
      // USDTMock, like USDT, refuses to change a non-zero allowance to another non-zero one.
      await step(`reset ${ctx.underlyingSymbol} allowance to 0`, async () => {
        const { tx } = await transact(() => underlying.approve(ctx.tokenAddress, 0n));
        return { value: true, tx };
      });
    }
    await step(`approve ${underlyingTokens(ctx, needed)}`, async () => {
      const { tx } = await transact(() => underlying.approve(ctx.tokenAddress, needed));
      return { value: true, tx };
    });
  }

  await step(`wrap ${underlyingTokens(ctx, needed)}`, async () => {
    const { tx } = await transact(() => token.wrap(creator.address, needed));
    return { value: true, tx, detail: `into ${tokens(ctx, shortfall)}` };
  });
}

// ----- Runs ----------------------------------------------------------------------------------------------

async function dryRun(ctx: Context) {
  const sdk = sdkSlot(ctx);
  const stranger = randomAddress();

  const input = await step(`encrypt ${tokens(ctx, ctx.amount)} for (escrow, random address)`, async () => {
    const { value, attempts } = await encrypt(ctx, sdk, ctx.amount, stranger);
    const proofBytes = (value.inputProof.length - 2) / 2;
    return {
      value,
      attempts,
      detail: [`user ${stranger}`, `handle ${value.encryptedValues[0]}, proof ${proofBytes} bytes`],
    };
  });

  const simulation = "simulate the lock (eth_call)";
  if (input) {
    await step(simulation, async () => {
      const deadline = (await latestTimestamp(ctx)) + LOCK_SECONDS;
      try {
        await ctx.escrow.lock.staticCall(
          todoRef(ctx),
          randomAddress(),
          input.encryptedValues[0],
          input.inputProof,
          deadline,
          {
            from: stranger,
          },
        );
      } catch (error) {
        const parsed = parseRevert(error);
        if (parsed?.name === "ERC7984UnauthorizedSpender") {
          return {
            value: true,
            detail: [
              `reverted with ${formatError(parsed)}, as it should:`,
              "the escrow verified the input proof and called the token, which only misses the operator approval",
            ],
          };
        }
        if (parsed?.name === "InvalidSigner") {
          throw new Error(`Sepolia's InputVerifier refused the relayer's input proof: ${formatError(parsed)}`);
        }
        throw new Error(`unexpected revert: ${revertReason(error)}`);
      }
      throw new Error("the lock did not revert, although nobody made the escrow an operator of the random address");
    });
  } else {
    skip(simulation, "there is no encrypted amount");
  }

  // No user decryption without a key and an ACL grant, but a public decryption goes through the same relayer
  // and KMS: take the newest amount cUSDTMock made publicly decryptable for an unwrap.
  const decryption = "public decrypt (relayer and KMS)";
  const published = await findPublishedAmount(ctx);
  if ("handle" in published) {
    await step(decryption, async () => {
      const { value, attempts } = await relayer(sdk, (zama) =>
        zama.decryption.decryptPublicValues([hex(published.handle)]),
      );
      const clear = clearValueOf(value.clearValues, published.handle);
      return {
        value: clear,
        attempts,
        detail: [
          `handle ${published.handle}, unwrap requested in block ${published.block}`,
          `${tokens(ctx, clear)}, with the KMS signatures`,
        ],
      };
    });
  } else {
    skip(decryption, published.reason);
  }
  sdk.reset();

  const gasPrice = (await ctx.provider.getFeeData()).gasPrice ?? 0n;
  const amount = tokens(ctx, ctx.amount);
  const cheapest = plannedGas(ctx.refund, false);
  const dearest = plannedGas(ctx.refund, true);
  const eth = (gas: bigint) => Number(formatEther(gas * gasPrice)).toFixed(4);
  log(`
Plan of the full run, npm run smoke:sepolia
  creator      the DEPLOYER_PRIVATE_KEY account, which pays the gas (this dry run did not read the key)
  beneficiary  a wallet made in memory: signs decryption requests only, needs no ETH, key never printed
  1 fund       decrypt the creator's ${ctx.symbol}; below ${ctx.refund ? `2 x ${amount}` : amount}: mint ${ctx.underlyingSymbol}, approve, wrap
  2 operator   setOperator(escrow, now + 1 h)
  3 lock       encrypt ${amount} for (escrow, creator), lock it under a fresh todoRef until now + 1 day
  4 check      escrowOf shows Locked; the amount decrypts to ${amount} for the creator and for the beneficiary
  5 shortfall  lock ${tokens(ctx, MAX_UINT64)} under a second todoRef: it goes through and decrypts to 0
  6 release    release the first lock; escrowOf shows Released; the beneficiary's balance decrypts to ${amount}
  7 refund     ${ctx.refund ? "included" : "only with SMOKE_REFUND=1"}: lock with a 90 s deadline, wait, refund; the creator's balance rises by ${amount}
  cost         ${ctx.refund ? "6" : "4"} transactions, ${ctx.refund ? "9" : "7"} if step 1 wraps: about ${millionGas(cheapest)} to ${millionGas(dearest)} M gas,
               ${eth(cheapest)} to ${eth(dearest)} ETH at the current ${Number(formatUnits(gasPrice, "gwei")).toFixed(2)} gwei;
               the ${amount} each run releases stays with the throwaway beneficiary`);
}

/** The newest amount the token made publicly decryptable, searched backwards in chunks the RPC accepts. */
async function findPublishedAmount(ctx: Context): Promise<{ handle: string; block: number } | { reason: string }> {
  const event = ctx.token.interface.getEvent("UnwrapRequested");
  if (!event) return { reason: "the token ABI has no UnwrapRequested event" };
  let chunk = UNWRAP_SEARCH_CHUNK;
  try {
    const latest = await ctx.provider.getBlockNumber();
    const floor = latest - UNWRAP_SEARCH_BLOCKS;
    for (let to = latest - UNWRAP_MIN_AGE_BLOCKS; to > floor; ) {
      const from = Math.max(floor + 1, to - chunk + 1);
      let logs;
      try {
        logs = await ctx.provider.getLogs({
          address: ctx.tokenAddress,
          topics: [event.topicHash],
          fromBlock: from,
          toBlock: to,
        });
      } catch (error) {
        // Some RPC plans cap eth_getLogs ranges well below 500 blocks.
        if (chunk === UNWRAP_SEARCH_CHUNK) {
          chunk = 50;
          continue;
        }
        throw error;
      }
      const newest = logs.at(-1);
      if (newest) {
        const handle: string = ctx.token.interface.decodeEventLog(event, newest.data, newest.topics).amount;
        return { handle, block: newest.blockNumber };
      }
      to = from - 1;
    }
    return { reason: `${ctx.symbol} published no amount in the last ${UNWRAP_SEARCH_BLOCKS} blocks` };
  } catch (error) {
    return { reason: `the RPC did not return ${ctx.symbol}'s UnwrapRequested logs: ${revertReason(error)}` };
  }
}

async function fullRun(ctx: Context) {
  const key = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (!key) {
    throw new Error("The full run needs DEPLOYER_PRIVATE_KEY. The dry run needs no key: npm run smoke:sepolia:dry");
  }
  keepSecret(key);
  let creator: Wallet;
  try {
    creator = new Wallet(key.startsWith("0x") ? key : `0x${key}`, ctx.provider);
  } catch {
    throw new Error("DEPLOYER_PRIVATE_KEY is not a valid private key.");
  }
  const beneficiary = Wallet.createRandom(ctx.provider);
  keepSecret(beneficiary.privateKey);
  keepSecret(beneficiary.mnemonic?.phrase);

  const creatorSdk = sdkSlot(ctx, creator);
  const beneficiarySdk = sdkSlot(ctx, beneficiary);
  const startBalance = await ctx.provider.getBalance(creator.address);

  const ready = await step("creator and beneficiary", async () => {
    const [creatorBlocked, beneficiaryBlocked, fees] = await Promise.all([
      ctx.token.isBlocked(creator.address),
      ctx.token.isBlocked(beneficiary.address),
      ctx.provider.getFeeData(),
    ]);
    if (creatorBlocked || beneficiaryBlocked) throw new Error(`${ctx.symbol} blocks the creator or the beneficiary`);
    const estimate = plannedGas(ctx.refund, true) * (fees.gasPrice ?? 0n);
    if (startBalance < estimate) {
      throw new Error(
        `the creator holds ${formatEther(startBalance)} ETH, and the run may cost about ${formatEther(estimate)} ETH`,
      );
    }
    return {
      value: true,
      detail: [
        `creator ${creator.address}, ${formatEther(startBalance)} ETH${creator.address === ctx.auditor ? ", also the escrow's auditor" : ""}`,
        `beneficiary ${beneficiary.address}, made for this run`,
      ],
    };
  });
  if (!ready) return;

  // 1. Fund the creator in the confidential token if needed.
  const required = ctx.amount * (ctx.refund ? 2n : 1n);
  const balance = await step(`decrypt creator's ${ctx.symbol} balance`, () =>
    decryptBalance(ctx, creatorSdk, creator.address),
  );
  if (balance !== undefined && balance >= required) {
    skip(`fund the creator`, `the creator holds ${tokens(ctx, balance)}, the run needs ${tokens(ctx, required)}`);
  } else {
    await fund(ctx, creator, balance === undefined ? required : required - balance);
  }

  // 2. Make the escrow an operator of the creator's balance.
  await step("setOperator(escrow, now + 1 h)", async () => {
    const until = (await latestTimestamp(ctx)) + OPERATOR_SECONDS;
    const token = new Contract(ctx.tokenAddress, TOKEN_ABI, creator);
    const { receipt, tx } = await transact(() => token.setOperator(ctx.escrowAddress, until));
    const operator: boolean = await ctx.token.isOperator(creator.address, ctx.escrowAddress, {
      blockTag: receipt.blockNumber,
    });
    if (!operator) throw new StepFailure("isOperator(creator, escrow) is false after the transaction", undefined, tx);
    return { value: true, tx, detail: `until ${iso(until)}` };
  });

  // 3. and 4. Lock the amount, and read it back as creator and beneficiary.
  const amount = tokens(ctx, ctx.amount);
  const first = await lock(
    ctx,
    creatorSdk,
    creator,
    beneficiary.address,
    { encrypt: `encrypt ${amount}`, lock: `lock ${amount}` },
    ctx.amount,
    LOCK_SECONDS,
  );
  const firstHandle = first && (await expectEscrow(ctx, creator.address, first.ref, "Locked", beneficiary.address));
  if (firstHandle) {
    await expectDecrypted(ctx, "decrypt amount as creator", creatorSdk, firstHandle, ctx.escrowAddress, ctx.amount);
    await expectDecrypted(
      ctx,
      "decrypt amount as beneficiary",
      beneficiarySdk,
      firstHandle,
      ctx.escrowAddress,
      ctx.amount,
    );
  } else {
    skip("decrypt the locked amount", "there is no lock to read");
  }

  // 5. An underfunded lock goes through and holds an encrypted 0.
  const short = await lock(
    ctx,
    creatorSdk,
    creator,
    beneficiary.address,
    { encrypt: "encrypt uint64 max", lock: "lock uint64 max (underfunded)" },
    MAX_UINT64,
    LOCK_SECONDS,
  );
  const shortHandle =
    short && (await expectEscrow(ctx, creator.address, short.ref, "Locked", beneficiary.address, "underfunded"));
  if (shortHandle) {
    await expectDecrypted(ctx, "decrypt underfunded amount", creatorSdk, shortHandle, ctx.escrowAddress, 0n);
  } else {
    skip("decrypt underfunded amount", "there is no underfunded lock to read");
  }

  // 6. Release the first lock to the beneficiary.
  if (first) {
    const released = await step("release", async () => {
      const escrow = ctx.escrow.connect(creator);
      const { receipt, tx } = await transact(() => escrow.release(first.ref), CONFIRMATIONS_BEFORE_DECRYPT);
      if (!hasEvent(ctx, receipt, "Released"))
        throw new StepFailure("the receipt has no Released event", undefined, tx);
      return { value: true, tx };
    });
    if (released) {
      await expectEscrow(ctx, creator.address, first.ref, "Released", beneficiary.address);
      await step(`decrypt beneficiary's ${ctx.symbol} balance`, async () => {
        const done = await decryptBalance(ctx, beneficiarySdk, beneficiary.address);
        if (done.value !== ctx.amount) {
          throw new StepFailure(`decrypted ${tokens(ctx, done.value)}, expected ${amount}`, done.attempts);
        }
        return done;
      });
    } else {
      skip(`decrypt beneficiary's ${ctx.symbol} balance`, "nothing was released");
    }
  } else {
    skip("release", "there is no lock to release");
  }

  // 7. Optionally, lock with a short deadline and take the amount back.
  if (!ctx.refund) {
    skip("refund", "set SMOKE_REFUND=1 to include it");
  } else {
    const refundable = await lock(
      ctx,
      creatorSdk,
      creator,
      beneficiary.address,
      { encrypt: `encrypt ${amount} (refund)`, lock: `lock ${amount}, 90 s deadline` },
      ctx.amount,
      REFUND_LOCK_SECONDS,
    );
    if (!refundable) {
      skip("refund", "there is no lock to refund");
    } else {
      const handle = await expectEscrow(
        ctx,
        creator.address,
        refundable.ref,
        "Locked",
        beneficiary.address,
        "refund lock",
      );
      if (handle) {
        await expectDecrypted(ctx, "decrypt refund lock as creator", creatorSdk, handle, ctx.escrowAddress, ctx.amount);
      } else {
        skip("decrypt refund lock as creator", "there is no amount handle to read");
      }
      const before = await step(`decrypt creator's balance before refund`, () =>
        decryptBalance(ctx, creatorSdk, creator.address),
      );
      const due = await step("wait for a block past the deadline", async () => {
        const giveUp = Date.now() + REFUND_WAIT_LIMIT_MS;
        for (;;) {
          const block = await ctx.provider.getBlock("latest");
          if (block && block.timestamp > refundable.deadline) {
            return { value: true, detail: `block ${block.number} at ${iso(block.timestamp)}` };
          }
          if (Date.now() > giveUp) throw new Error(`no block past ${iso(refundable.deadline)} yet`);
          await sleep(6_000);
        }
      });
      const refunded =
        due &&
        (await step("refund", async () => {
          const escrow = ctx.escrow.connect(creator);
          const { receipt, tx } = await transact(() => escrow.refund(refundable.ref), CONFIRMATIONS_BEFORE_DECRYPT);
          if (!hasEvent(ctx, receipt, "Refunded"))
            throw new StepFailure("the receipt has no Refunded event", undefined, tx);
          return { value: true, tx };
        }));
      if (refunded) {
        await expectEscrow(ctx, creator.address, refundable.ref, "Refunded", beneficiary.address, "refund lock");
        if (before === undefined) {
          skip(`decrypt creator's balance after refund`, "the balance before the refund is unknown");
        } else {
          await step(`decrypt creator's balance after refund`, async () => {
            const after = await decryptBalance(ctx, creatorSdk, creator.address);
            if (after.value - before !== ctx.amount) {
              throw new StepFailure(
                `the balance went from ${tokens(ctx, before)} to ${tokens(ctx, after.value)}, not up by ${amount}`,
                after.attempts,
              );
            }
            return { ...after, detail: `${tokens(ctx, before)} before, ${tokens(ctx, after.value)} after` };
          });
        }
      } else {
        skip("decrypt creator's balance after refund", "nothing was refunded");
      }
    }
  }

  creatorSdk.reset();
  beneficiarySdk.reset();
  const endBalance = await ctx.provider.getBalance(creator.address);
  balanceLine = `the creator went from ${formatEther(startBalance)} to ${formatEther(endBalance)} ETH`;
}

// ----- Main ----------------------------------------------------------------------------------------------

function smokeMode(): "dry" | "full" {
  const raw = process.env.SMOKE_MODE?.trim() || "dry";
  if (raw !== "dry" && raw !== "full") throw new Error(`SMOKE_MODE must be "dry" or "full", not "${raw}".`);
  return raw;
}

function flag(name: string): boolean {
  return ["1", "true", "yes"].includes(process.env[name]?.trim().toLowerCase() ?? "");
}

function addressFromEnv(name: string, fallback: string): string {
  const raw = process.env[name]?.trim() || fallback;
  if (!isAddress(raw)) throw new Error(`${name} is not an address: ${raw}`);
  return getAddress(raw);
}

function amountFromEnv(decimals: number): bigint {
  const raw = process.env.SMOKE_AMOUNT?.trim() || "1";
  let amount: bigint;
  try {
    amount = parseUnits(raw, decimals);
  } catch {
    throw new Error(`SMOKE_AMOUNT must be a token amount with at most ${decimals} decimals, not "${raw}".`);
  }
  if (amount <= 0n || amount * 2n > MAX_UINT64) throw new Error(`SMOKE_AMOUNT is out of range: ${raw}`);
  return amount;
}

function packageVersion(name: string, from?: string): string {
  try {
    const paths = from ? [dirname(require.resolve(`${from}/package.json`))] : undefined;
    const manifest = require.resolve(`${name}/package.json`, paths ? { paths } : undefined);
    return (JSON.parse(readFileSync(manifest, "utf8")) as { version: string }).version;
  } catch {
    return "unknown";
  }
}

async function main() {
  const mode = smokeMode();
  if (network.name !== "sepolia") {
    throw new Error(`Refusing to run on "${network.name}". Run: npm run smoke:sepolia:dry`);
  }
  const rpcUrl = process.env.SEPOLIA_RPC_URL?.trim();
  if (!rpcUrl) throw new Error("SEPOLIA_RPC_URL is required.");
  keepSecret(rpcUrl);
  const escrowAddress = addressFromEnv("ESCROW_ADDRESS", DEFAULT_ESCROW);
  const provider = new JsonRpcProvider(rpcUrl, Number(SEPOLIA_CHAIN_ID), { staticNetwork: true });

  log(
    mode === "dry"
      ? "ConfidentialTodoEscrow smoke test, dry run: signs nothing, sends nothing"
      : "ConfidentialTodoEscrow smoke test, full run: sends transactions from DEPLOYER_PRIVATE_KEY",
  );
  log(
    `@zama-fhe/sdk ${packageVersion("@zama-fhe/sdk")} (@fhevm/sdk ${packageVersion("@fhevm/sdk", "@zama-fhe/sdk")}), ` +
      `relayer ${sepoliaFhe.relayerUrl}`,
  );

  const onSepolia = await step("RPC serves Sepolia", async () => {
    const chainId = BigInt(await provider.send("eth_chainId", []));
    if (chainId !== SEPOLIA_CHAIN_ID) {
      throw new Error(`SEPOLIA_RPC_URL serves chain ${chainId}, not Sepolia (${SEPOLIA_CHAIN_ID}).`);
    }
    return { value: true, detail: `chain ${chainId}, block ${await provider.getBlockNumber()}` };
  });
  if (!onSepolia) return;

  const found = await step("escrow and token", async () => {
    if ((await provider.getCode(escrowAddress)) === "0x") throw new Error(`There is no contract at ${escrowAddress}.`);
    const escrow = ConfidentialTodoEscrow__factory.connect(escrowAddress, provider);
    const [tokenAddress, auditor, protocolId] = await Promise.all([
      escrow.token(),
      escrow.auditor(),
      escrow.confidentialProtocolId(),
    ]);
    if (protocolId !== ZAMA_TESTNET_PROTOCOL_ID) {
      throw new Error(`confidentialProtocolId() is ${protocolId}, not ${ZAMA_TESTNET_PROTOCOL_ID}.`);
    }
    const token = new Contract(tokenAddress, TOKEN_ABI, provider);
    const [name, symbol, decimals, rate, underlyingAddress, paused, observers, escrowBlocked] = await Promise.all([
      token.name(),
      token.symbol(),
      token.decimals(),
      token.rate(),
      token.underlying(),
      token.paused(),
      token.observers(),
      token.isBlocked(escrowAddress),
    ]);
    const underlying = new Contract(underlyingAddress, UNDERLYING_ABI, provider);
    const [underlyingName, underlyingSymbol, underlyingDecimals, mintCapTokens] = await Promise.all([
      underlying.name(),
      underlying.symbol(),
      underlying.decimals(),
      underlying.MAX_MINT_AMOUNT_TOKENS(),
    ]);
    if (paused) throw new Error(`${symbol} is paused: wraps, transfers and so locks revert.`);
    if (escrowBlocked) throw new Error(`${symbol} blocks the escrow.`);
    return {
      value: {
        escrow,
        auditor: getAddress(auditor),
        tokenAddress: getAddress(tokenAddress),
        token,
        symbol: String(symbol),
        decimals: Number(decimals),
        rate: BigInt(rate),
        underlyingAddress: getAddress(underlyingAddress),
        underlying,
        underlyingSymbol: String(underlyingSymbol),
        underlyingDecimals: Number(underlyingDecimals),
        mintCap: BigInt(mintCapTokens) * 10n ** BigInt(underlyingDecimals),
      },
      detail: [
        `escrow ${escrowAddress}, auditor ${auditor}`,
        `token ${tokenAddress}, ${name} (${symbol}), ${decimals} decimals, rate ${rate}, not paused, ` +
          `observers: ${observers.length ? observers.join(", ") : "none"}`,
        `underlying ${underlyingAddress}, ${underlyingName} (${underlyingSymbol}), ${underlyingDecimals} decimals, ` +
          `public mint of up to ${mintCapTokens} a call`,
      ],
    };
  });
  if (!found) return;

  const ctx: Context = {
    ...found,
    provider,
    rpcUrl,
    debug: flag("SMOKE_DEBUG"),
    refund: flag("SMOKE_REFUND"),
    runLabel: `smoke-${Math.floor(Date.now() / 1000)}`,
    escrowAddress,
    amount: amountFromEnv(found.decimals),
  };
  if (mode === "dry") {
    await dryRun(ctx);
  } else {
    await fullRun(ctx);
  }
}

function summary(stopped: boolean): number {
  if (rows.length > 0) {
    const width = Math.max(4, ...rows.map((row) => row.step.length));
    log(`\n${"step".padEnd(width)}  result      time  attempts  transaction`);
    for (const row of rows) {
      const time = row.ms === undefined ? "" : seconds(row.ms);
      const attempts = row.attempts === undefined ? "" : `${row.attempts}/${RELAYER_ATTEMPTS}`;
      const tx = row.tx ? `${ETHERSCAN_TX}${row.tx}` : "";
      log(
        `${row.step.padEnd(width)}  ${row.outcome.padEnd(6)}  ${time.padStart(8)}  ${attempts.padEnd(8)}  ${tx}`.trimEnd(),
      );
    }
  }
  if (mined > 0 || balanceLine) {
    const count = `${mined} transaction${mined === 1 ? "" : "s"}`;
    log(`\nspent ${formatEther(spentWei)} ETH in ${count}${balanceLine ? `; ${balanceLine}` : ""}`);
  }
  const failed = rows.filter((row) => row.outcome === "FAIL").length;
  const skipped = rows.filter((row) => row.outcome === "skip").length;
  const passed = rows.length - failed - skipped;
  if (failed > 0 || stopped || unexpectedErrors > 0) {
    const problems = [
      failed > 0 ? `${failed} of ${rows.length} steps failed` : "",
      stopped ? "the run stopped early" : "",
      unexpectedErrors > 0 ? `${unexpectedErrors} unexpected error${unexpectedErrors === 1 ? "" : "s"}` : "",
    ];
    log(`\nFAILED: ${problems.filter(Boolean).join(", ")}`);
    return 1;
  }
  log(`\npassed: ${passed} steps ok${skipped > 0 ? `, ${skipped} skipped` : ""}`);
  return 0;
}

process.on("unhandledRejection", (reason) => {
  unexpectedErrors += 1;
  log(`  unexpected error outside the steps: ${describe(reason)}`);
});

main()
  .then(
    () => summary(false),
    (error: unknown) => {
      log(`\nstopped: ${describe(error)}`);
      return summary(true);
    },
  )
  .then((code) => {
    // The TFHE worker threads @fhevm/sdk starts outlive ZamaSDK.terminate() and would keep Node running,
    // so exit once stdout is flushed.
    process.exitCode = code;
    process.stdout.write("", () => process.exit(code));
  });
