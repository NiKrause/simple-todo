/**
 * Deploys ConfidentialTodoEscrow to Sepolia.
 *
 * Put these in contracts/.env (git ignores it; see .env.example) or export them in the shell:
 *
 *   SEPOLIA_RPC_URL=https://...        # any Sepolia JSON-RPC endpoint
 *   DEPLOYER_PRIVATE_KEY=0x...         # a throwaway key holding a little Sepolia ETH
 *   ESCROW_AUDITOR=0x...               # required: may decrypt every locked amount
 *   ESCROW_TOKEN=0x...                 # optional: defaults to Zama's cUSDTMock
 *
 *   npm run deploy:sepolia
 *
 * The auditor is fixed for the contract's lifetime. Changing it means deploying a new escrow.
 */
import { ethers, network } from "hardhat";

// Zama's confidential USDT mock on Sepolia (ERC-7984 wrapper over a USDT mock with a public mint).
const CUSDT_MOCK_SEPOLIA = "0x4E7B06D78965594eB5EF5414c357ca21E1554491";
const SEPOLIA_CHAIN_ID = 11155111n;
// ZamaConfig's confidential protocol id for Zama's testnet.
const ZAMA_TESTNET_PROTOCOL_ID = 10001n;
const CONFIRMATIONS = 2;

function addressFromEnv(name: string, fallback?: string): string {
  const raw = process.env[name]?.trim() || fallback;
  if (!raw) {
    throw new Error(`${name} is required.`);
  }
  if (!ethers.isAddress(raw)) {
    throw new Error(`${name} is not an address: ${raw}`);
  }
  const address = ethers.getAddress(raw);
  if (address === ethers.ZeroAddress) {
    throw new Error(`${name} must not be the zero address.`);
  }
  return address;
}

/** Revert data, wherever the provider put it on the error. */
function revertData(error: unknown): string | undefined {
  type WithData = { data?: unknown; error?: WithData; info?: { error?: WithData } };
  const candidates = [error as WithData, (error as WithData)?.error, (error as WithData)?.info?.error];
  const data = candidates.map((candidate) => candidate?.data).find((value) => typeof value === "string");
  return typeof data === "string" && data.length >= 10 ? data : undefined;
}

async function main() {
  if (network.name !== "sepolia") {
    throw new Error(`Refusing to deploy to "${network.name}". Run: npm run deploy:sepolia`);
  }
  if (!process.env.SEPOLIA_RPC_URL) {
    throw new Error("SEPOLIA_RPC_URL is required.");
  }
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(`SEPOLIA_RPC_URL serves chain ${chainId}, not Sepolia (${SEPOLIA_CHAIN_ID}).`);
  }

  const auditor = addressFromEnv("ESCROW_AUDITOR");
  const token = addressFromEnv("ESCROW_TOKEN", CUSDT_MOCK_SEPOLIA);

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("DEPLOYER_PRIVATE_KEY is required.");
  }

  if ((await ethers.provider.getCode(token)) === "0x") {
    throw new Error(`There is no contract at ESCROW_TOKEN ${token}.`);
  }
  const tokenInfo = new ethers.Contract(
    token,
    ["function name() view returns (string)", "function symbol() view returns (string)"],
    ethers.provider,
  );

  console.log(`network   sepolia (${chainId})`);
  console.log(`deployer  ${deployer.address}, ${ethers.formatEther(await ethers.provider.getBalance(deployer))} ETH`);
  console.log(`token     ${token} (${await tokenInfo.name()}, ${await tokenInfo.symbol()})`);
  console.log(`auditor   ${auditor}`);

  const factory = await ethers.getContractFactory("ConfidentialTodoEscrow", deployer);

  // The constructor checks ERC-7984 support through ERC-165 and a non-zero auditor. Estimating the
  // deployment runs those checks for free and names the failure before any gas is spent.
  try {
    await ethers.provider.estimateGas({
      ...(await factory.getDeployTransaction(token, auditor)),
      from: deployer.address,
    });
  } catch (error) {
    const reason = revertData(error) ? factory.interface.parseError(revertData(error)!) : null;
    throw new Error(`The deployment would revert${reason ? ` with ${reason.name}(${reason.args.join(", ")})` : ""}.`, {
      cause: error,
    });
  }

  const escrow = await factory.deploy(token, auditor);
  const deployment = escrow.deploymentTransaction();
  console.log(`tx        ${deployment?.hash}`);
  const receipt = await deployment?.wait(CONFIRMATIONS);
  const address = await escrow.getAddress();

  const protocolId = await escrow.confidentialProtocolId();
  if (protocolId !== ZAMA_TESTNET_PROTOCOL_ID) {
    throw new Error(
      `Deployed at ${address}, but confidentialProtocolId() is ${protocolId}, not ${ZAMA_TESTNET_PROTOCOL_ID}.`,
    );
  }

  console.log(`escrow    ${address} (block ${receipt?.blockNumber}, ${CONFIRMATIONS} confirmations)`);
  console.log(`verify    npx hardhat verify --network sepolia ${address} ${token} ${auditor}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
