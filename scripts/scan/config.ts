import {ethers} from "hardhat";
import {InputsArgs, TokenInfo} from "./types";

export const DEBUG = true;
export const DEBUG_LEVEL = 1; // 0: no debug, 1: basic debug, 2: detailed debug
export const DEBUG_TO_FILE = true;
export const DEBUG_DISABLE_PRIORITY = false;
export const DEBUG_DISABLE_RANDOM_POOLS = false;
export const DEBUG_DELETE_LOG_FILE = false;

// Constants
export const TEST_AMOUNTS = [1, 100, 1000, 10000];
export const PANCAKE_FACTORY = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73";
export const GAS_PRICE = 6; // Gwei
export const MAX_PROFIT_HISTORY_ITEMS = 100;

// Timing parameters (ms)
export const BATCH_SHORT_DELAY = 1000 * 5;
export const FULL_REFRESH_INTERVAL = 1000 * 60 * 5;
export const PRIORITY_REFRESH_INTERVAL = 1000 * 20;
export const RESET_INTERVAL = 1000 * 60 * 15;

// Random pool selection parameters
export const POOLS_TO_SAMPLE = 100; // Number of random pools to sample
export const RANDOM_START = 0; // Minimum pool index to consider
export let RANDOM_END = 10000; // Maximum pool index to consider (adjustable)
export const BATCH_SIZE = 20;
export const PRIORITY_BATCH_SIZE = 5;

// Profit thresholds
export const MIN_PROFIT_THRESHOLD = 0.01;
export const MIN_LIQUIDITY_USD = 50000;

export const INPUT_ARGS: InputsArgs = {};

export const UNKNOW_TOKEN_SYMBOL = "UNKNOW_SYMBOL";
export const UNKNOW_TOKEN_NAME = "UNKNOW_NAME";

// ABIs
export const FACTORY_ABI = [
  "function allPairsLength() external view returns (uint256)",
  "function allPairs(uint256) external view returns (address)",
  "function getPair(address, address) external view returns (address)",
];

export const PAIR_ABI = [
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function totalSupply() external view returns (uint256)",
];

export const ERC20_ABI = [
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
];

// Priority tokens to focus on
export const PRIORITY_TOKENS_MUTABLE = {
  WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // we can't use WBNB as a token in the pool, since we need to borrow amount from it
  BUSD: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
  USDT: "0x55d398326f99059fF775485246999027B3197955",
  CAKE: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
  ETH: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
  BTCB: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",

  // Additional high-liquidity tokens
  USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", // USD Coin
  DAI: "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3", // Dai Stablecoin
  //DOT: "0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402", // Binance-Peg Polkadot
  //ADA: "0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47", // Binance-Peg Cardano
  DOGE: "0xbA2aE424d960c26247Dd6c32edC70B295c744C43", // Binance-Peg Dogecoin
  //XRP: "0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE", // Binance-Peg XRP
  //MATIC: "0xCC42724C6683B7E57334c4E856f4c9965ED682bD", // Binance-Peg Polygon
  //LINK: "0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD", // Binance-Peg ChainLink

  //BABY: "0x53E562b9B7E5E94b81f10e96Ee70Ad06df3D2657", // BabySwap Token
  //BSW: "0x965F527D9159dCe6288a2219DB51fc6Eef120dD1", // Biswap Token
};

// Stablecoins for liquidity calculation
export const STABLECOINS = [
  PRIORITY_TOKENS_MUTABLE.BUSD.toLowerCase(),
  PRIORITY_TOKENS_MUTABLE.USDT.toLowerCase(),
  PRIORITY_TOKENS_MUTABLE.USDC.toLocaleLowerCase(),
  PRIORITY_TOKENS_MUTABLE.DAI.toLowerCase(),
];

// Provider setup
export const provider = ethers.provider;
export const factory = new ethers.Contract(
  PANCAKE_FACTORY,
  FACTORY_ABI,
  provider
);

// State variables (these are mutable and need to be exported as objects)
export const state = {
  lastProfitFound: Date.now(),
  currentPoolIndices: [] as number[],
  totalPools: 0,

  // Token info cache
  tokenCache: {} as {
    [address: string]: TokenInfo;
  },

  // In-memory pool data storage
  poolsMap: new Map<string, any>(),

  // Track which tokens are in which pools for quick lookup
  tokenPools: new Map<string, Set<string>>(),
};

// Update functions for mutable state
export function updateRandomEnd(newEnd: number) {
  RANDOM_END = newEnd;
}

export function updateTotalPools(newTotal: number) {
  state.totalPools = newTotal;
}
