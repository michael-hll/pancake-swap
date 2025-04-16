import {HardhatUserConfig} from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import {execSync} from "child_process";
import * as fs from "fs";
import * as yaml from "js-yaml";
import {resolve} from "path";

function getRecentBlockNumber() {
  try {
    const result = execSync(
      "curl -s -X POST https://bsc-dataseed.binance.org/ " +
        '-H "Content-Type: application/json" ' +
        '--data \'{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}\''
    ).toString();

    const blockHex = JSON.parse(result).result;
    const blockNumber = parseInt(blockHex, 16);
    const forkBlockNumber = blockNumber - 50;
    //console.log("Forking from block number:", forkBlockNumber);
    return forkBlockNumber;
  } catch (error) {
    console.warn("Could not get latest block, using default");
    return 48000000; // Fallback to a recent known block
  }
}
const forkBlockNumber = getRecentBlockNumber();

// Read private key from YAML file if it exists
let privateKey: string;
const privateKeyPath = resolve(__dirname, "./private-key.yaml");

if (fs.existsSync(privateKeyPath)) {
  try {
    const fileContent = fs.readFileSync(privateKeyPath, "utf8");
    const yamlData = yaml.load(fileContent) as {PRIVATE_KEY: string};
    privateKey = yamlData.PRIVATE_KEY;
    if (
      !privateKey ||
      !privateKey.startsWith("0x") ||
      privateKey.length !== 66
    ) {
      throw new Error("Invalid private key format");
    }
    console.log("Private key loaded from ./private-key.yaml");
  } catch (error) {
    console.warn("Warning: Could not parse private-key.yaml file", error);
    // Fallback to empty key
    privateKey = "";
  }
} else {
  console.warn("Warning: private-key.yaml file not found");
  // Fallback to empty key or environment variable
  privateKey = process.env.PRIVATE_KEY || "";
}

const config: HardhatUserConfig = {
  solidity: {
    compilers: [{version: "0.5.5"}, {version: "0.6.8"}, {version: "0.8.8"}],
  },
  networks: {
    hardhat: {
      forking: {
        url: "https://bsc-dataseed.binance.org/",
        blockNumber: forkBlockNumber,
        enabled: true,
      },
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      timeout: 30000,
    },
    testnet: {
      url: "https://data-seed-prebsc-1-s1.binance.org:8545/",
      chainId: 97,
      accounts: [
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      ],
    },
    mainnet: {
      url: "https://bsc-dataseed.binance.org/",
      chainId: 56,
      accounts: privateKey ? [privateKey] : [],
      timeout: 120000, // Longer timeout for large data queries
      gasPrice: 5000000000, // 5 Gwei - not needed for read operations, but good to have
    },
    localnode: {
      url: "http://192.168.5.7:8545",
      chainId: 56,
    },
  },
  mocha: {
    timeout: 300000,
  },
};

export default config;
