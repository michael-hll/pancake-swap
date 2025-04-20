import {HardhatUserConfig} from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import {execSync} from "child_process";

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
    testnet: {
      url: "https://data-seed-prebsc-1-s1.binance.org:8545/",
      chainId: 97,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    mainnet: {
      url: "https://bsc-dataseed.binance.org/",
      chainId: 56,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      timeout: 120000, // Longer timeout for large data queries
      gasPrice: 5000000000, // 5 Gwei - not needed for read operations, but good to have
    },
    localnode: {
      url: "http://127.0.0.1:8545",
      chainId: 56,
    },
  },
  mocha: {
    timeout: 300000,
  },
};

export default config;
