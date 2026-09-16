/**
 * Publishes the source of a deployed ConfidentialTodoEscrow on Etherscan, submitting the full standard
 * JSON input this directory compiled: the same input Sourcify matched.
 *
 *   ESCROW_ADDRESS=0x...       # required: the deployed escrow
 *   ETHERSCAN_API_KEY=...      # required, from .env or the shell; never printed
 *   npm run verify:etherscan
 *
 * `npx hardhat verify` submits a minimal input first, the escrow and its imports only. For this
 * deployment Etherscan refused that ("Compiled contract deployment bytecode does NOT match"), and
 * hardhat-verify 2.1.3 stopped there instead of retrying with the full input. The constructor
 * arguments are read from the deployed escrow (`token()`, `auditor()`).
 *
 * Signs nothing and sends no transaction. Compile the commit that was deployed.
 */
import { artifacts, ethers, network } from "hardhat";

const ETHERSCAN_API = "https://api.etherscan.io/v2/api";
const CONTRACT = "src/ConfidentialTodoEscrow.sol:ConfidentialTodoEscrow";
const POLL_MS = 5_000;
const TIMEOUT_MS = 180_000;

type EtherscanResponse = { status: string; message: string; result: string };

async function call(chainId: number, apiKey: string, params: Record<string, string>, post = false) {
  const query = new URLSearchParams({ chainid: String(chainId), ...(post ? {} : { ...params, apikey: apiKey }) });
  const response = await fetch(`${ETHERSCAN_API}?${query}`, {
    method: post ? "POST" : "GET",
    ...(post
      ? {
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ ...params, apikey: apiKey }),
        }
      : {}),
  });
  const text = await response.text();
  try {
    return JSON.parse(text) as EtherscanResponse;
  } catch {
    throw new Error(`Etherscan answered ${response.status} with something that is not JSON: ${text.slice(0, 120)}`);
  }
}

async function main() {
  const chainId = network.config.chainId;
  if (!chainId) {
    throw new Error(`Network "${network.name}" has no chainId. Run: npm run verify:etherscan`);
  }
  const apiKey = process.env.ETHERSCAN_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ETHERSCAN_API_KEY is required.");
  }
  const raw = process.env.ESCROW_ADDRESS?.trim();
  if (!raw || !ethers.isAddress(raw)) {
    throw new Error("ESCROW_ADDRESS must be the deployed escrow's address.");
  }
  const address = ethers.getAddress(raw);

  const escrow = new ethers.Contract(
    address,
    ["function token() view returns (address)", "function auditor() view returns (address)"],
    ethers.provider,
  );
  const [token, auditor] = await Promise.all([escrow.token(), escrow.auditor()]);
  const constructorArguments = ethers.AbiCoder.defaultAbiCoder().encode(["address", "address"], [token, auditor]);

  const buildInfo = await artifacts.getBuildInfo(CONTRACT);
  if (!buildInfo) {
    throw new Error(`No build info for ${CONTRACT}. Run: npx hardhat compile`);
  }

  const submitted = await call(
    chainId,
    apiKey,
    {
      module: "contract",
      action: "verifysourcecode",
      codeformat: "solidity-standard-json-input",
      sourceCode: JSON.stringify(buildInfo.input),
      contractaddress: address,
      contractname: CONTRACT,
      compilerversion: `v${buildInfo.solcLongVersion}`,
      constructorArguements: constructorArguments.slice(2),
    },
    true,
  );
  if (submitted.status !== "1") {
    if (/already verified/i.test(submitted.result)) {
      console.log(`already verified`);
      return report(chainId, address);
    }
    throw new Error(`Etherscan refused the submission: ${submitted.result}`);
  }
  console.log(`submitted: token ${token}, auditor ${auditor}; waiting for Etherscan`);

  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const status = await call(chainId, apiKey, { module: "contract", action: "checkverifystatus", guid: submitted.result });
    if (/pending/i.test(status.result)) {
      if (Date.now() > deadline) throw new Error(`Etherscan is still pending after ${TIMEOUT_MS / 1000} s.`);
      continue;
    }
    if (status.status === "1" || /already verified/i.test(status.result)) {
      console.log(`verified: ${status.result}`);
      return report(chainId, address);
    }
    throw new Error(`Etherscan could not verify: ${status.result}`);
  }
}

function report(chainId: number, address: string) {
  const host = chainId === 11155111 ? "sepolia.etherscan.io" : "etherscan.io";
  console.log(`etherscan   https://${host}/address/${address}#code`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
