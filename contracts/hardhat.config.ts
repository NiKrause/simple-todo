import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";
import type { HardhatUserConfig } from "hardhat/config";

// Only a Sepolia deployment reads these (see scripts/deploy-sepolia.ts and
// .env.example). Tests run on the in-process Hardhat network in FHEVM mock
// mode and need none of them. They are not read from a .env file: export them
// in the shell that runs the deployment.
const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL ?? "";
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  networks: {
    // chainId 31337 is what ZamaEthereumConfig maps to the mock host contracts.
    hardhat: { chainId: 31337 },
    sepolia: {
      chainId: 11155111,
      url: sepoliaRpcUrl,
      accounts: deployerPrivateKey ? [deployerPrivateKey] : [],
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY ?? "",
  },
  sourcify: {
    enabled: false,
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  solidity: {
    // Same compiler and EVM target as Zama's fhevm-hardhat-template and
    // OpenZeppelin's confidential contracts. FHEVM needs at least cancun.
    version: "0.8.27",
    settings: {
      optimizer: { enabled: true, runs: 800 },
      evmVersion: "cancun",
      metadata: { bytecodeHash: "none" },
    },
  },
  typechain: {
    outDir: "types",
    target: "ethers-v6",
  },
};

export default config;
