/**
 * Publishes the source of a deployed ConfidentialTodoEscrow on Sourcify, through Sourcify's API v2.
 * It needs no key.
 *
 *   ESCROW_ADDRESS=0x...       # required: the deployed escrow
 *   ESCROW_DEPLOY_TX=0x...     # optional: its deployment transaction, for a creation-code match too
 *   npm run verify:sourcify
 *
 * `npx hardhat verify` cannot do this under Hardhat 2: hardhat-verify 2.1.3, its last release for
 * Hardhat 2, still calls Sourcify endpoints that Sourcify has removed. It still verifies on Etherscan
 * once ETHERSCAN_API_KEY is set.
 *
 * Signs nothing and sends no transaction. The source comes from this directory's build, so compile
 * the commit that was deployed.
 */
import { artifacts, ethers, network } from "hardhat";

const SOURCIFY_API = "https://sourcify.dev/server";
const CONTRACT = "src/ConfidentialTodoEscrow.sol:ConfidentialTodoEscrow";
const POLL_MS = 3_000;
const TIMEOUT_MS = 180_000;

type VerificationJob = {
  isJobCompleted: boolean;
  error?: { customCode?: string; message?: string };
  contract?: { match: string | null; creationMatch: string | null; runtimeMatch: string | null };
};

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Sourcify answered ${response.status} with something that is not JSON: ${text.slice(0, 120)}`);
  }
}

async function main() {
  const chainId = network.config.chainId;
  if (!chainId) {
    throw new Error(`Network "${network.name}" has no chainId. Run: npm run verify:sourcify`);
  }
  const raw = process.env.ESCROW_ADDRESS?.trim();
  if (!raw || !ethers.isAddress(raw)) {
    throw new Error("ESCROW_ADDRESS must be the deployed escrow's address.");
  }
  const address = ethers.getAddress(raw);
  const deployTx = process.env.ESCROW_DEPLOY_TX?.trim() || undefined;

  if ((await ethers.provider.getCode(address)) === "0x") {
    throw new Error(`There is no contract at ${address} on ${network.name}.`);
  }

  const existing = await fetch(`${SOURCIFY_API}/v2/contract/${chainId}/${address}`);
  const known = await readJson(existing);
  if (existing.ok && known.match) {
    console.log(`already verified: ${known.match} (creation ${known.creationMatch}, runtime ${known.runtimeMatch})`);
    return report(chainId, address);
  }

  const buildInfo = await artifacts.getBuildInfo(CONTRACT);
  if (!buildInfo) {
    throw new Error(`No build info for ${CONTRACT}. Run: npx hardhat compile`);
  }
  const submitted = await fetch(`${SOURCIFY_API}/v2/verify/${chainId}/${address}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      stdJsonInput: buildInfo.input,
      compilerVersion: buildInfo.solcLongVersion,
      contractIdentifier: CONTRACT,
      ...(deployTx ? { creationTransactionHash: deployTx } : {}),
    }),
  });
  const accepted = await readJson(submitted);
  if (!submitted.ok || !accepted.verificationId) {
    throw new Error(`Sourcify refused the request (${submitted.status}): ${JSON.stringify(accepted).slice(0, 300)}`);
  }
  console.log(`submitted: job ${accepted.verificationId}`);

  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const job: VerificationJob = await readJson(await fetch(`${SOURCIFY_API}/v2/verify/${accepted.verificationId}`));
    if (job.isJobCompleted) {
      if (job.error) {
        throw new Error(`Sourcify could not verify: ${job.error.customCode ?? ""} ${job.error.message ?? ""}`.trim());
      }
      console.log(
        `verified: ${job.contract?.match} (creation ${job.contract?.creationMatch}, runtime ${job.contract?.runtimeMatch})`,
      );
      return report(chainId, address);
    }
    if (Date.now() > deadline) {
      throw new Error(`Sourcify has not finished job ${accepted.verificationId} after ${TIMEOUT_MS / 1000} s.`);
    }
  }
}

function report(chainId: number, address: string) {
  console.log(`sourcify    https://repo.sourcify.dev/${chainId}/${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
