import { FhevmType } from "@fhevm/hardhat-plugin";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import type { ContractTransactionReceipt, ContractTransactionResponse } from "ethers";
import { ethers, fhevm } from "hardhat";

import type { ConfidentialTodoEscrow, ConfidentialUSDTMock, USDTMock } from "../types";

// ConfidentialTodoEscrow.Status
const Status = { None: 0n, Locked: 1n, Released: 2n, Refunded: 3n };

const DAY = 24 * 60 * 60;

// Token units: cUSDTMock has 6 decimals, like USDT.
const usdt = (whole: number) => BigInt(Math.round(whole * 1_000_000));

/** A todo reference as a client computes it: keccak256(abi.encode(todoId, salt)), salt random. */
function todoRef(todoId: string): string {
  const salt = ethers.hexlify(ethers.randomBytes(32));
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string", "bytes32"], [todoId, salt]));
}

async function mined(tx: Promise<ContractTransactionResponse>): Promise<ContractTransactionReceipt> {
  const receipt = await (await tx).wait();
  if (!receipt) throw new Error("transaction was not mined");
  return receipt;
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  expect.fail("expected the promise to reject");
}

describe("ConfidentialTodoEscrow", function () {
  let alice: HardhatEthersSigner; // creates the todo and locks its budget
  let bob: HardhatEthersSigner; // the todo is delegated to him
  let auditor: HardhatEthersSigner;
  let mallory: HardhatEthersSigner; // everyone else

  let usdtMock: USDTMock;
  let cusdt: ConfidentialUSDTMock;
  let cusdtAddress: string;
  let escrow: ConfidentialTodoEscrow;
  let escrowAddress: string;

  // What each step cost, printed once at the end of the run.
  const costs = new Map<string, { gas: bigint; hcu: number; depth: number }>();

  function record(step: string, receipt: ContractTransactionReceipt) {
    const { globalHCU, maxHCUDepth } = fhevm.computeTransactionHCU(receipt);
    costs.set(step, { gas: receipt.gasUsed, hcu: globalHCU, depth: maxHCUDepth });
  }

  before(async function () {
    [, alice, bob, auditor, mallory] = await ethers.getSigners();
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      // Time travel and the mock coprocessor's instant decryption do not exist on Sepolia.
      this.skip();
    }

    usdtMock = await (await ethers.getContractFactory("USDTMock")).deploy();
    cusdt = await (await ethers.getContractFactory("ConfidentialUSDTMock")).deploy(await usdtMock.getAddress());
    cusdtAddress = await cusdt.getAddress();
    escrow = await (await ethers.getContractFactory("ConfidentialTodoEscrow")).deploy(cusdtAddress, auditor.address);
    escrowAddress = await escrow.getAddress();
    await fhevm.assertCoprocessorInitialized(escrow, "ConfidentialTodoEscrow");
  });

  after(function () {
    if (costs.size === 0) return;
    console.log("\n    Cost per step (mock coprocessor; HCU uses the same per-operation prices as Sepolia):");
    for (const [step, { gas, hcu, depth }] of costs) {
      console.log(
        `      ${step.padEnd(22)} gas ${gas.toString().padStart(7)}   HCU ${String(hcu).padStart(7)}   depth ${depth}`,
      );
    }
  });

  /** Mints USDT to `holder` and wraps it into the confidential token, as a user does before locking. */
  async function wrap(holder: HardhatEthersSigner, amount: bigint) {
    await mined(usdtMock.mint(holder.address, amount));
    await mined(usdtMock.connect(holder).approve(cusdtAddress, amount));
    await mined(cusdt.connect(holder).wrap(holder.address, amount));
  }

  /** Makes the escrow an operator of `holder`'s balance, lapsing ten minutes later, as a client should. */
  async function approveEscrow(holder: HardhatEthersSigner) {
    await mined(cusdt.connect(holder).setOperator(escrowAddress, (await time.latest()) + 10 * 60));
  }

  async function lock(
    creator: HardhatEthersSigner,
    ref: string,
    beneficiary: string,
    amount: bigint,
    deadline: number,
  ): Promise<ContractTransactionReceipt> {
    const input = await fhevm.createEncryptedInput(escrowAddress, creator.address).add64(amount).encrypt();
    return mined(escrow.connect(creator).lock(ref, beneficiary, input.handles[0], input.inputProof, deadline));
  }

  async function deadlineIn(seconds: number): Promise<number> {
    return (await time.latest()) + seconds;
  }

  /** `holder`'s balance, decrypted by `holder`. A balance never touched has no ciphertext yet: 0. */
  async function balanceOf(holder: HardhatEthersSigner): Promise<bigint> {
    const handle = await cusdt.confidentialBalanceOf(holder.address);
    if (handle === ethers.ZeroHash) return 0n;
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, cusdtAddress, holder);
  }

  /** A contract cannot sign a decryption request, so the escrow's own balance is read via the mock's debugger. */
  async function escrowBalance(): Promise<bigint> {
    const handle = await cusdt.confidentialBalanceOf(escrowAddress);
    if (handle === ethers.ZeroHash) return 0n;
    return fhevm.debugger.decryptEuint(FhevmType.euint64, handle);
  }

  /** The amount locked under (`creator`, `ref`), decrypted by `reader`. */
  async function lockedAmount(creator: HardhatEthersSigner, ref: string, reader: HardhatEthersSigner): Promise<bigint> {
    const { amount } = await escrow.escrowOf(creator.address, ref);
    return fhevm.userDecryptEuint(FhevmType.euint64, amount, escrowAddress, reader);
  }

  it("locks a budget and releases it to the beneficiary", async function () {
    await wrap(alice, usdt(1000));
    const ref = todoRef("todo-1");
    const deadline = await deadlineIn(7 * DAY);

    expect(await balanceOf(alice)).to.equal(usdt(1000));
    expect(await balanceOf(bob)).to.equal(0n);
    expect(await escrowBalance()).to.equal(0n);

    await approveEscrow(alice);
    const lockReceipt = await lock(alice, ref, bob.address, usdt(250), deadline);
    record("lock", lockReceipt);
    await expect(lockReceipt).to.emit(escrow, "Locked").withArgs(alice.address, ref, bob.address, deadline);

    const locked = await escrow.escrowOf(alice.address, ref);
    expect(locked.beneficiary).to.equal(bob.address);
    expect(locked.deadline).to.equal(BigInt(deadline));
    expect(locked.status).to.equal(Status.Locked);
    expect(await lockedAmount(alice, ref, alice)).to.equal(usdt(250));
    expect(await balanceOf(alice)).to.equal(usdt(750));
    expect(await balanceOf(bob)).to.equal(0n);
    expect(await escrowBalance()).to.equal(usdt(250));

    const releaseReceipt = await mined(escrow.connect(alice).release(ref));
    record("release", releaseReceipt);
    await expect(releaseReceipt).to.emit(escrow, "Released").withArgs(alice.address, ref, bob.address);

    expect((await escrow.escrowOf(alice.address, ref)).status).to.equal(Status.Released);
    expect(await balanceOf(alice)).to.equal(usdt(750));
    expect(await balanceOf(bob)).to.equal(usdt(250));
    expect(await escrowBalance()).to.equal(0n);
  });

  it("stores an encrypted 0 for an underfunded lock, and a release moves 0", async function () {
    await wrap(alice, usdt(100));
    await approveEscrow(alice);
    const ref = todoRef("todo-underfunded");

    const receipt = await lock(alice, ref, bob.address, usdt(250), await deadlineIn(7 * DAY));
    record("lock (underfunded)", receipt);

    // The lock did not revert, and nothing public says it came up short.
    expect((await escrow.escrowOf(alice.address, ref)).status).to.equal(Status.Locked);
    expect(await lockedAmount(alice, ref, alice)).to.equal(0n);
    expect(await balanceOf(alice)).to.equal(usdt(100));
    expect(await escrowBalance()).to.equal(0n);

    await mined(escrow.connect(alice).release(ref));

    expect(await balanceOf(bob)).to.equal(0n);
    expect(await balanceOf(alice)).to.equal(usdt(100));
  });

  it("lets the auditor decrypt the locked amount, and not a stranger", async function () {
    await wrap(alice, usdt(500));
    await approveEscrow(alice);
    const ref = todoRef("todo-audited");
    await lock(alice, ref, bob.address, usdt(123.456789), await deadlineIn(7 * DAY));

    expect(await lockedAmount(alice, ref, auditor)).to.equal(usdt(123.456789));
    expect(await lockedAmount(alice, ref, bob)).to.equal(usdt(123.456789));
    expect(await lockedAmount(alice, ref, alice)).to.equal(usdt(123.456789));

    const refused = await rejection(lockedAmount(alice, ref, mallory));
    expect(refused.message).to.match(/is not authorized to user decrypt handle/);

    // The refusal is the ACL's answer, not the client's.
    const { amount } = await escrow.escrowOf(alice.address, ref);
    const { ACLAddress } = await fhevm.getCoprocessorConfig(escrowAddress);
    const acl = new ethers.Contract(
      ACLAddress,
      ["function persistAllowed(bytes32 handle, address account) view returns (bool)"],
      ethers.provider,
    );
    for (const account of [escrowAddress, alice.address, bob.address, auditor.address]) {
      expect(await acl.persistAllowed(amount, account), account).to.equal(true);
    }
    expect(await acl.persistAllowed(amount, mallory.address)).to.equal(false);
  });

  it("reverts a release by anyone but the creator", async function () {
    await wrap(alice, usdt(300));
    await approveEscrow(alice);
    const ref = todoRef("todo-not-yours");
    await lock(alice, ref, bob.address, usdt(300), await deadlineIn(7 * DAY));

    for (const caller of [mallory, bob, auditor]) {
      await expect(escrow.connect(caller).release(ref))
        .to.be.revertedWithCustomError(escrow, "EscrowNotFound")
        .withArgs(caller.address, ref);
    }

    expect((await escrow.escrowOf(alice.address, ref)).status).to.equal(Status.Locked);
    expect(await balanceOf(bob)).to.equal(0n);
    expect(await escrowBalance()).to.equal(usdt(300));
  });

  it("refunds only after the deadline", async function () {
    await wrap(alice, usdt(400));
    await approveEscrow(alice);
    const ref = todoRef("todo-refund");
    const deadline = await deadlineIn(2 * DAY);
    await lock(alice, ref, bob.address, usdt(400), deadline);
    expect(await balanceOf(alice)).to.equal(0n);

    await expect(escrow.connect(alice).refund(ref))
      .to.be.revertedWithCustomError(escrow, "DeadlineNotReached")
      .withArgs(deadline);

    // A block stamped exactly at the deadline is not after it.
    await time.setNextBlockTimestamp(deadline);
    await expect(escrow.connect(alice).refund(ref))
      .to.be.revertedWithCustomError(escrow, "DeadlineNotReached")
      .withArgs(deadline);

    // Nobody else can take the refund once it is due.
    await time.setNextBlockTimestamp(deadline + 1);
    await expect(escrow.connect(mallory).refund(ref))
      .to.be.revertedWithCustomError(escrow, "EscrowNotFound")
      .withArgs(mallory.address, ref);

    const receipt = await mined(escrow.connect(alice).refund(ref));
    record("refund", receipt);
    await expect(receipt).to.emit(escrow, "Refunded").withArgs(alice.address, ref);

    expect((await escrow.escrowOf(alice.address, ref)).status).to.equal(Status.Refunded);
    expect(await balanceOf(alice)).to.equal(usdt(400));
    expect(await balanceOf(bob)).to.equal(0n);
    expect(await escrowBalance()).to.equal(0n);
  });

  it("reverts a second release", async function () {
    await wrap(alice, usdt(200));
    await approveEscrow(alice);
    const ref = todoRef("todo-twice");
    await lock(alice, ref, bob.address, usdt(200), await deadlineIn(7 * DAY));

    await mined(escrow.connect(alice).release(ref));
    await expect(escrow.connect(alice).release(ref))
      .to.be.revertedWithCustomError(escrow, "EscrowClosed")
      .withArgs(alice.address, ref, Status.Released);

    expect(await balanceOf(bob)).to.equal(usdt(200));
  });

  it("reverts a release after a refund, and a refund after a release", async function () {
    await wrap(alice, usdt(600));
    await approveEscrow(alice);
    const refunded = todoRef("todo-refunded");
    const released = todoRef("todo-released");
    const deadline = await deadlineIn(DAY);
    await lock(alice, refunded, bob.address, usdt(100), deadline);
    await lock(alice, released, bob.address, usdt(200), deadline);

    await mined(escrow.connect(alice).release(released));
    await time.increaseTo(deadline + 1);
    await mined(escrow.connect(alice).refund(refunded));

    await expect(escrow.connect(alice).release(refunded))
      .to.be.revertedWithCustomError(escrow, "EscrowClosed")
      .withArgs(alice.address, refunded, Status.Refunded);
    await expect(escrow.connect(alice).refund(released))
      .to.be.revertedWithCustomError(escrow, "EscrowClosed")
      .withArgs(alice.address, released, Status.Released);

    expect(await balanceOf(alice)).to.equal(usdt(400));
    expect(await balanceOf(bob)).to.equal(usdt(200));
    expect(await escrowBalance()).to.equal(0n);
  });

  it("reverts a second lock under the same todoRef, also after a release", async function () {
    await wrap(alice, usdt(300));
    await approveEscrow(alice);
    const ref = todoRef("todo-relock");
    await lock(alice, ref, bob.address, usdt(100), await deadlineIn(7 * DAY));

    const input = await fhevm.createEncryptedInput(escrowAddress, alice.address).add64(usdt(100)).encrypt();
    const relock = async () =>
      escrow.connect(alice).lock(ref, bob.address, input.handles[0], input.inputProof, await deadlineIn(7 * DAY));

    await expect(relock()).to.be.revertedWithCustomError(escrow, "EscrowExists").withArgs(alice.address, ref);
    await mined(escrow.connect(alice).release(ref));
    await expect(relock()).to.be.revertedWithCustomError(escrow, "EscrowExists").withArgs(alice.address, ref);

    expect(await balanceOf(alice)).to.equal(usdt(200));
    expect(await balanceOf(bob)).to.equal(usdt(100));
  });

  it("keeps a creator's todoRef out of reach of someone who locks under it first", async function () {
    await wrap(alice, usdt(500));
    const ref = todoRef("todo-front-run");
    const deadline = await deadlineIn(7 * DAY);

    // Mallory copies the reference from Alice's pending transaction and locks under it first.
    await approveEscrow(mallory);
    await lock(mallory, ref, mallory.address, usdt(1), deadline);

    await approveEscrow(alice);
    await lock(alice, ref, bob.address, usdt(500), deadline);
    await mined(escrow.connect(alice).release(ref));

    expect(await balanceOf(bob)).to.equal(usdt(500));
    expect((await escrow.escrowOf(mallory.address, ref)).status).to.equal(Status.Locked);
    expect((await escrow.escrowOf(alice.address, ref)).status).to.equal(Status.Released);
  });

  it("needs the escrow to be an operator of the creator's balance", async function () {
    await wrap(alice, usdt(50));
    const ref = todoRef("todo-no-operator");

    const input = await fhevm.createEncryptedInput(escrowAddress, alice.address).add64(usdt(50)).encrypt();
    await expect(
      escrow.connect(alice).lock(ref, bob.address, input.handles[0], input.inputProof, await deadlineIn(DAY)),
    )
      .to.be.revertedWithCustomError(cusdt, "ERC7984UnauthorizedSpender")
      .withArgs(alice.address, escrowAddress);

    // An approval that has lapsed is no approval.
    await approveEscrow(alice);
    await time.increase(11 * 60);
    await expect(
      escrow.connect(alice).lock(ref, bob.address, input.handles[0], input.inputProof, await deadlineIn(DAY)),
    )
      .to.be.revertedWithCustomError(cusdt, "ERC7984UnauthorizedSpender")
      .withArgs(alice.address, escrowAddress);

    expect(await balanceOf(alice)).to.equal(usdt(50));
  });

  it("rejects an encrypted amount made for someone else", async function () {
    await wrap(alice, usdt(50));
    await approveEscrow(mallory);
    const ref = todoRef("todo-replayed-input");

    // Alice's encrypted amount and proof, as they appear in her pending transaction.
    const input = await fhevm.createEncryptedInput(escrowAddress, alice.address).add64(usdt(50)).encrypt();
    const replay = escrow
      .connect(mallory)
      .lock(ref, mallory.address, input.handles[0], input.inputProof, await deadlineIn(DAY));
    await expect(replay).to.be.revertedWithCustomError(
      ...fhevm.revertedWithCustomErrorArgs("InputVerifier", "InvalidSigner"),
    );
    expect((await escrow.escrowOf(mallory.address, ref)).status).to.equal(Status.None);
  });

  it("verifies the encrypted amount itself instead of forwarding it to the token", async function () {
    await wrap(alice, usdt(70));
    await approveEscrow(alice);
    const ref = todoRef("todo-bound-input");
    const deadline = await deadlineIn(DAY);

    // lock() takes an amount encrypted for the escrow and the creator, as in every test above.
    // One encrypted for the token instead fails the escrow's own verification.
    const forToken = await fhevm.createEncryptedInput(cusdtAddress, alice.address).add64(usdt(70)).encrypt();
    await expect(
      escrow.connect(alice).lock(ref, bob.address, forToken.handles[0], forToken.inputProof, deadline),
    ).to.be.revertedWithCustomError(...fhevm.revertedWithCustomErrorArgs("InputVerifier", "InvalidSigner"));

    // A contract that forwards handle and proof to the token's confidentialTransferFrom(from, to,
    // externalEuint64, bytes) fails with an amount encrypted for it and the creator: the token verifies
    // the proof for (token, forwarding contract), not for (forwarding contract, creator).
    const forwarder = await (await ethers.getContractFactory("ForwardingEscrowMock")).deploy(cusdtAddress);
    const forwarderAddress = await forwarder.getAddress();
    await mined(cusdt.connect(alice).setOperator(forwarderAddress, (await time.latest()) + 10 * 60));
    const forForwarder = await fhevm.createEncryptedInput(forwarderAddress, alice.address).add64(usdt(70)).encrypt();
    await expect(
      forwarder.connect(alice).lock(forForwarder.handles[0], forForwarder.inputProof),
    ).to.be.revertedWithCustomError(...fhevm.revertedWithCustomErrorArgs("InputVerifier", "InvalidSigner"));

    // Encrypting for what the token checks makes forwarding work, but then the proof names no creator:
    // Mallory replays Alice's input against her own balance and decrypts Alice's amount.
    const replayable = await fhevm.createEncryptedInput(cusdtAddress, forwarderAddress).add64(usdt(70)).encrypt();
    await wrap(mallory, usdt(1000));
    await mined(cusdt.connect(mallory).setOperator(forwarderAddress, (await time.latest()) + 10 * 60));
    const receipt = await mined(forwarder.connect(mallory).lock(replayable.handles[0], replayable.inputProof));
    const transfer = receipt.logs
      .filter((log) => log.address.toLowerCase() === cusdtAddress.toLowerCase())
      .map((log) => cusdt.interface.parseLog(log))
      .find((event) => event?.name === "ConfidentialTransfer");
    expect(transfer, "ConfidentialTransfer event").to.not.equal(undefined);
    expect(await fhevm.userDecryptEuint(FhevmType.euint64, transfer!.args.amount, cusdtAddress, mallory)).to.equal(
      usdt(70),
    );

    expect(await balanceOf(alice)).to.equal(usdt(70));
  });

  it("takes an existing handle without a proof only from someone who may use it", async function () {
    await wrap(alice, usdt(300));
    await approveEscrow(alice);
    const first = todoRef("todo-first");
    await lock(alice, first, bob.address, usdt(120), await deadlineIn(7 * DAY));
    const { amount } = await escrow.escrowOf(alice.address, first);

    // With an empty proof, FHE.fromExternal takes the handle as it is, if the caller may use it.
    // Mallory may not use the amount Alice locked.
    await wrap(mallory, usdt(300));
    await approveEscrow(mallory);
    await expect(
      escrow.connect(mallory).lock(todoRef("todo-copy"), mallory.address, amount, "0x", await deadlineIn(DAY)),
    )
      .to.be.revertedWithCustomError(escrow, "SenderNotAllowedToUseHandle")
      .withArgs(amount, mallory.address);

    // Alice may: the same amount again for another todo, without encrypting it again.
    const second = todoRef("todo-second");
    await mined(escrow.connect(alice).lock(second, bob.address, amount, "0x", await deadlineIn(7 * DAY)));
    expect(await lockedAmount(alice, second, alice)).to.equal(usdt(120));
    expect(await balanceOf(alice)).to.equal(usdt(60));
    expect(await balanceOf(mallory)).to.equal(usdt(300));
  });

  it("validates a lock's arguments before touching the token", async function () {
    const ref = todoRef("todo-arguments");
    const input = await fhevm.createEncryptedInput(escrowAddress, alice.address).add64(usdt(1)).encrypt();
    const attempt = (todo: string, beneficiary: string, deadline: number | bigint) =>
      escrow.connect(alice).lock(todo, beneficiary, input.handles[0], input.inputProof, deadline);

    const now = await time.latest();
    await expect(attempt(ethers.ZeroHash, bob.address, now + DAY)).to.be.revertedWithCustomError(escrow, "ZeroTodoRef");
    await expect(attempt(ref, ethers.ZeroAddress, now + DAY))
      .to.be.revertedWithCustomError(escrow, "InvalidBeneficiary")
      .withArgs(ethers.ZeroAddress);
    await expect(attempt(ref, escrowAddress, now + DAY))
      .to.be.revertedWithCustomError(escrow, "InvalidBeneficiary")
      .withArgs(escrowAddress);
    await expect(attempt(ref, bob.address, now))
      .to.be.revertedWithCustomError(escrow, "InvalidDeadline")
      .withArgs(now);
    const tooFar = now + 400 * DAY;
    await expect(attempt(ref, bob.address, tooFar))
      .to.be.revertedWithCustomError(escrow, "InvalidDeadline")
      .withArgs(tooFar);
    // A deadline in milliseconds, the classic JavaScript slip.
    const inMilliseconds = BigInt(now + DAY) * 1000n;
    await expect(attempt(ref, bob.address, inMilliseconds))
      .to.be.revertedWithCustomError(escrow, "InvalidDeadline")
      .withArgs(inMilliseconds);
  });

  it("accepts only an ERC-7984 token and a non-zero auditor", async function () {
    const factory = await ethers.getContractFactory("ConfidentialTodoEscrow");
    const plainErc20 = await usdtMock.getAddress();

    await expect(factory.deploy(plainErc20, auditor.address))
      .to.be.revertedWithCustomError(factory, "TokenNotERC7984")
      .withArgs(plainErc20);
    await expect(factory.deploy(mallory.address, auditor.address))
      .to.be.revertedWithCustomError(factory, "TokenNotERC7984")
      .withArgs(mallory.address);
    await expect(factory.deploy(cusdtAddress, ethers.ZeroAddress)).to.be.revertedWithCustomError(
      factory,
      "ZeroAuditor",
    );

    expect(await escrow.token()).to.equal(cusdtAddress);
    expect(await escrow.auditor()).to.equal(auditor.address);
  });

  it("emits no amounts and no amount handles", async function () {
    await wrap(alice, usdt(90));
    await approveEscrow(alice);
    const released = todoRef("todo-events-released");
    const refunded = todoRef("todo-events-refunded");
    const deadline = await deadlineIn(DAY);

    const receipts = [
      await lock(alice, released, bob.address, usdt(40), deadline),
      await lock(alice, refunded, bob.address, usdt(50), deadline),
      await mined(escrow.connect(alice).release(released)),
    ];
    await time.increaseTo(deadline + 1);
    receipts.push(await mined(escrow.connect(alice).refund(refunded)));

    const handles = [
      (await escrow.escrowOf(alice.address, released)).amount,
      (await escrow.escrowOf(alice.address, refunded)).amount,
    ].map((handle) => handle.slice(2).toLowerCase());

    const escrowLogs = receipts.flatMap((receipt) =>
      receipt.logs.filter((log) => log.address.toLowerCase() === escrowAddress.toLowerCase()),
    );
    expect(escrowLogs.map((log) => escrow.interface.parseLog(log)?.name)).to.deep.equal([
      "Locked",
      "Locked",
      "Released",
      "Refunded",
    ]);
    for (const log of escrowLogs) {
      const payload = [...log.topics, log.data].join("").toLowerCase();
      for (const handle of handles) expect(payload).to.not.contain(handle);
    }

    // The only bytes32 an event carries is the todo reference.
    for (const name of ["Locked", "Released", "Refunded"] as const) {
      const inputs = escrow.interface.getEvent(name).inputs.map((input) => `${input.type} ${input.name}`);
      expect(inputs.filter((input) => !input.startsWith("address ") && input !== "uint64 deadline")).to.deep.equal([
        "bytes32 todoRef",
      ]);
    }
  });
});
