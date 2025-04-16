import {ethers} from "hardhat";
import fs from "fs";
import path from "path";

// Type definitions
interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  reserve: string;
}

interface PoolData {
  index: number;
  address: string;
  token0: TokenInfo;
  token1: TokenInfo;
  prices: {[key: string]: number};
  liquidityUSD: string;
  totalSupply: string;
  updated: string;
  retrySuccess?: boolean;
}

interface ErrorItem {
  index: number;
  address: string;
  error: string;
  updated: string;
}

interface ProcessResult {
  success: boolean;
  data?: PoolData;
  error?: ErrorItem;
  item?: ErrorItem;
}

interface ResultsFile {
  totalPairs: number;
  scannedPairs: number;
  scanTime: string;
  lastUpdated?: string;
  pools: PoolData[];
}

interface ErrorsFile {
  totalErrors: number;
  lastUpdated: string;
  errors: ErrorItem[];
}

// Process command line arguments
const args = process.argv.slice(2);
const processErrors = args.includes("--process-errors");

async function main() {
  console.log("Starting PancakeSwap V2 Pool Scanner...");
  console.log(
    `Mode: ${processErrors ? "Processing error items" : "Normal scan"}`
  );

  // PancakeSwap V2 Factory address
  const PANCAKE_FACTORY = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73";

  // Factory ABI - only what we need
  const FACTORY_ABI = [
    "function allPairsLength() external view returns (uint256)",
    "function allPairs(uint256) external view returns (address)",
    "function getPair(address, address) external view returns (address)",
  ];

  // Pair ABI - only what we need
  const PAIR_ABI = [
    "function token0() external view returns (address)",
    "function token1() external view returns (address)",
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function totalSupply() external view returns (uint256)",
    "function kLast() external view returns (uint256)",
  ];

  // ERC20 ABI - only what we need
  const ERC20_ABI = [
    "function name() external view returns (string)",
    "function symbol() external view returns (string)",
    "function decimals() external view returns (uint8)",
  ];

  // Set up file paths
  const dataDir = path.join(__dirname, "../data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, {recursive: true});
  }

  const resultsPath = path.join(dataDir, "pancake_pools.json");
  const errorsPath = path.join(dataDir, "pancake_errors.json");

  // Connect to contracts
  const provider = ethers.provider;
  const factory = new ethers.Contract(PANCAKE_FACTORY, FACTORY_ABI, provider);

  // Token address to metadata cache (to avoid redundant calls)
  const tokenCache: {
    [address: string]: {name: string; symbol: string; decimals: number};
  } = {};

  // Function to get token info with caching and retries
  async function getTokenInfo(address: string) {
    if (tokenCache[address]) {
      return tokenCache[address];
    }

    try {
      const token = new ethers.Contract(address, ERC20_ABI, provider);

      // Add retry mechanism
      let retries = 3;
      let name, symbol, decimals;

      while (retries > 0) {
        try {
          [name, symbol, decimals] = await Promise.all([
            token.name(),
            token.symbol(),
            token.decimals(),
          ]);
          break; // Success, exit the retry loop
        } catch (error) {
          retries--;
          if (retries === 0) throw error;
          console.log(`Retrying token info for ${address}...`);
          await new Promise((r) => setTimeout(r, 2000)); // Wait 2 seconds before retry
        }
      }

      tokenCache[address] = {name, symbol, decimals};
      return tokenCache[address];
    } catch (error) {
      console.log(`Error fetching token info for ${address}: ${error}`);
      return {name: "Unknown", symbol: "UNKNOWN", decimals: 18};
    }
  }

  // Process errors or do regular scan
  if (processErrors) {
    await processErrorItems(errorsPath);
  } else {
    await performRegularScan();
  }

  async function processErrorItems(errorFilePath: string) {
    if (!fs.existsSync(errorFilePath)) {
      console.log("No error file found. Run a regular scan first.");
      return;
    }

    console.log("Processing error items from previous runs...");
    const errorData = JSON.parse(
      fs.readFileSync(errorFilePath, "utf8")
    ) as ErrorsFile;
    const errorItems = errorData.errors;

    if (!errorItems || errorItems.length === 0) {
      console.log("No error items to process.");
      return;
    }

    console.log(`Found ${errorItems.length} error items to process.`);
    const successfullyProcessed: PoolData[] = [];
    const stillFailing: ErrorItem[] = [];

    // Process in small batches
    const BATCH_SIZE = 5; // Even smaller batch for retries

    for (let i = 0; i < errorItems.length; i += BATCH_SIZE) {
      const batch: Promise<ProcessResult>[] = [];
      const batchEnd = Math.min(i + BATCH_SIZE, errorItems.length);

      console.log(`Processing error batch ${i} to ${batchEnd - 1}...`);

      for (let j = i; j < batchEnd; j++) {
        const errorItem = errorItems[j];
        batch.push(
          (async (): Promise<ProcessResult> => {
            try {
              // Get pair info
              const pair = new ethers.Contract(
                errorItem.address,
                PAIR_ABI,
                provider
              );

              // Get pair data with retries
              let retries = 3;
              let token0, token1, reserves, totalSupply;

              while (retries > 0) {
                try {
                  [token0, token1, reserves, totalSupply] = await Promise.all([
                    pair.token0(),
                    pair.token1(),
                    pair.getReserves(),
                    pair.totalSupply(),
                  ]);
                  break; // Success, exit the retry loop
                } catch (error) {
                  retries--;
                  if (retries === 0) throw error;
                  console.log(`Retrying pair data for ${errorItem.address}...`);
                  await new Promise((r) => setTimeout(r, 2000)); // Wait 2 seconds before retry
                }
              }

              // Get token info
              const [token0Info, token1Info] = await Promise.all([
                getTokenInfo(token0),
                getTokenInfo(token1),
              ]);

              // Format results
              const reserve0 = ethers.formatUnits(
                reserves[0],
                token0Info.decimals
              );
              const reserve1 = ethers.formatUnits(
                reserves[1],
                token1Info.decimals
              );

              const token0Price = Number(reserve1) / Number(reserve0);
              const token1Price = Number(reserve0) / Number(reserve1);

              // Calculate liquidity
              let liquidityUSD = "Unknown";
              if (
                token0Info.symbol === "USDT" ||
                token0Info.symbol === "USDC" ||
                token0Info.symbol === "BUSD" ||
                token0Info.symbol === "DAI"
              ) {
                liquidityUSD = (Number(reserve0) * 2).toString();
              } else if (
                token1Info.symbol === "USDT" ||
                token1Info.symbol === "USDC" ||
                token1Info.symbol === "BUSD" ||
                token1Info.symbol === "DAI"
              ) {
                liquidityUSD = (Number(reserve1) * 2).toString();
              }

              const poolData: PoolData = {
                index: errorItem.index,
                address: errorItem.address,
                token0: {
                  address: token0,
                  name: token0Info.name,
                  symbol: token0Info.symbol,
                  decimals: token0Info.decimals,
                  reserve: reserve0,
                },
                token1: {
                  address: token1,
                  name: token1Info.name,
                  symbol: token1Info.symbol,
                  decimals: token1Info.decimals,
                  reserve: reserve1,
                },
                prices: {
                  [`${token0Info.symbol}_PER_${token1Info.symbol}`]:
                    token1Price,
                  [`${token1Info.symbol}_PER_${token0Info.symbol}`]:
                    token0Price,
                },
                liquidityUSD,
                totalSupply: ethers.formatEther(totalSupply),
                retrySuccess: true,
                updated: new Date().toISOString(),
              };

              // Add to results file
              addPoolToResultsFile(poolData);

              return {success: true, data: poolData};
            } catch (error) {
              console.log(
                `Still failed to process ${errorItem.address}: ${error}`
              );
              return {
                success: false,
                item: errorItem,
              };
            }
          })()
        );
      }

      // Execute batch
      const results = await Promise.all(batch);

      // Sort results
      results.forEach((result) => {
        if (result.success && result.data) {
          successfullyProcessed.push(result.data);
        } else if (result.item) {
          stillFailing.push(result.item);
        }
      });

      // Throttle requests
      if (batchEnd < errorItems.length) {
        console.log("Throttling requests...");
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }

    // Update error file with remaining errors
    fs.writeFileSync(
      errorFilePath,
      JSON.stringify(
        {
          totalErrors: stillFailing.length,
          lastUpdated: new Date().toISOString(),
          errors: stillFailing,
        } as ErrorsFile,
        (_, v) => (typeof v === "bigint" ? v.toString() : v),
        2
      )
    );

    console.log(`Error processing complete!`);
    console.log(`Successfully processed: ${successfullyProcessed.length}`);
    console.log(`Still failing: ${stillFailing.length}`);
  }

  async function performRegularScan() {
    // Get total number of pairs
    const pairCount = await factory.allPairsLength();
    console.log(`Found ${pairCount} total pairs on PancakeSwap V2`);

    // We'll store pool data here
    const pools: PoolData[] = [];
    const errors: ErrorItem[] = [];

    // Number of pools to scan (limit it to avoid rate limiting)
    const LIMIT = 100; // CHANGED: Reduced from 1000 to 100
    const actualLimit = Math.min(Number(pairCount), LIMIT);

    console.log(`Scanning ${actualLimit} pools...`);

    // Initialize results file with empty data
    if (!fs.existsSync(resultsPath)) {
      fs.writeFileSync(
        resultsPath,
        JSON.stringify(
          {
            totalPairs: Number(pairCount),
            scannedPairs: 0,
            scanTime: new Date().toISOString(),
            pools: [],
          } as ResultsFile,
          (_, v) => (typeof v === "bigint" ? v.toString() : v),
          2
        )
      );
    }

    // Process pools in batches to avoid overloading the node
    const BATCH_SIZE = 10; // CHANGED: Reduced from 50 to 10

    for (let i = 0; i < actualLimit; i += BATCH_SIZE) {
      const batch: Promise<ProcessResult>[] = [];
      const end = Math.min(i + BATCH_SIZE, actualLimit);

      console.log(`Processing batch ${i} to ${end - 1}...`);

      // Create batch of promises
      for (let j = i; j < end; j++) {
        batch.push(
          (async (): Promise<ProcessResult> => {
            try {
              const pairAddress = await factory.allPairs(j);
              const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);

              // Get pair data
              const [token0, token1, reserves, totalSupply] = await Promise.all(
                [
                  pair.token0(),
                  pair.token1(),
                  pair.getReserves(),
                  pair.totalSupply(),
                ]
              );

              // Get token info
              const [token0Info, token1Info] = await Promise.all([
                getTokenInfo(token0),
                getTokenInfo(token1),
              ]);

              // Calculate prices
              const reserve0 = ethers.formatUnits(
                reserves[0],
                token0Info.decimals
              );
              const reserve1 = ethers.formatUnits(
                reserves[1],
                token1Info.decimals
              );

              const token0Price = Number(reserve1) / Number(reserve0);
              const token1Price = Number(reserve0) / Number(reserve1);

              // Calculate liquidity in USD (very rough estimate)
              let liquidityUSD = "Unknown";

              // If one of the tokens is a stablecoin, we can estimate
              if (
                token0Info.symbol === "USDT" ||
                token0Info.symbol === "USDC" ||
                token0Info.symbol === "BUSD" ||
                token0Info.symbol === "DAI"
              ) {
                liquidityUSD = (Number(reserve0) * 2).toString();
              } else if (
                token1Info.symbol === "USDT" ||
                token1Info.symbol === "USDC" ||
                token1Info.symbol === "BUSD" ||
                token1Info.symbol === "DAI"
              ) {
                liquidityUSD = (Number(reserve1) * 2).toString();
              }

              const poolData: PoolData = {
                index: j,
                address: pairAddress,
                token0: {
                  address: token0,
                  name: token0Info.name,
                  symbol: token0Info.symbol,
                  decimals: token0Info.decimals,
                  reserve: reserve0,
                },
                token1: {
                  address: token1,
                  name: token1Info.name,
                  symbol: token1Info.symbol,
                  decimals: token1Info.decimals,
                  reserve: reserve1,
                },
                prices: {
                  [`${token0Info.symbol}_PER_${token1Info.symbol}`]:
                    token1Price,
                  [`${token1Info.symbol}_PER_${token0Info.symbol}`]:
                    token0Price,
                },
                liquidityUSD,
                totalSupply: ethers.formatEther(totalSupply),
                updated: new Date().toISOString(),
              };

              // Add to results immediately
              addPoolToResultsFile(poolData);

              return {success: true, data: poolData};
            } catch (error) {
              console.log(`Error processing pair ${j}: ${error}`);
              const errorData: ErrorItem = {
                index: j,
                address: await factory.allPairs(j).catch(() => "Unknown"),
                error: `Failed to process: ${error}`,
                updated: new Date().toISOString(),
              };
              errors.push(errorData);
              return {success: false, error: errorData};
            }
          })()
        );
      }

      // Execute batch
      const results = await Promise.all(batch);

      // Add successful items to our pools array for summary
      results.forEach((result) => {
        if (result.success && result.data) {
          pools.push(result.data);
        }
      });

      // Optional: throttle requests to avoid rate limiting
      if (i + BATCH_SIZE < actualLimit) {
        console.log("Throttling requests...");
        await new Promise((resolve) => setTimeout(resolve, 3000)); // Increased from 1000ms to 3000ms
      }
    }

    // Save errors to file
    fs.writeFileSync(
      errorsPath,
      JSON.stringify(
        {
          totalErrors: errors.length,
          lastUpdated: new Date().toISOString(),
          errors: errors,
        } as ErrorsFile,
        (_, v) => (typeof v === "bigint" ? v.toString() : v),
        2
      )
    );

    console.log(`Scan complete! Found data for ${pools.length} pools.`);
    console.log(`Results saved to ${resultsPath}`);
    console.log(`Errors saved to ${errorsPath}`);

    if (errors.length > 0) {
      console.log(`\nEncountered ${errors.length} errors during processing.`);
      console.log(`Run with --process-errors to retry these items.`);
    }

    // Output some interesting stats
    const validPools = pools.filter((pool) => pool.token0 && pool.token1);

    // Find pools with highest liquidity (if we have that data)
    const poolsWithLiquidity = validPools
      .filter((pool) => pool.liquidityUSD !== "Unknown")
      .sort((a, b) => Number(b.liquidityUSD) - Number(a.liquidityUSD))
      .slice(0, 10);

    console.log("\nTop 10 Pools by Liquidity:");
    poolsWithLiquidity.forEach((pool, i) => {
      console.log(
        `${i + 1}. ${pool.token0.symbol}-${pool.token1.symbol}: $${Number(
          pool.liquidityUSD
        ).toLocaleString()}`
      );
    });
  }

  // Helper function to add a pool to the results file (incremental updates)
  function addPoolToResultsFile(poolData: PoolData): boolean {
    try {
      // Read current data
      const fileContent = fs.readFileSync(resultsPath, "utf8");
      const data = JSON.parse(fileContent) as ResultsFile;

      // Check if this pool already exists (by index)
      const existingIndex = data.pools.findIndex(
        (p: PoolData) => p.index === poolData.index
      );

      if (existingIndex >= 0) {
        // Update existing entry
        data.pools[existingIndex] = poolData;
      } else {
        // Add new entry
        data.pools.push(poolData);
      }

      // Update metadata
      data.scannedPairs = data.pools.length;
      data.lastUpdated = new Date().toISOString();

      // Write back to file
      fs.writeFileSync(
        resultsPath,
        JSON.stringify(
          data,
          (_, v) => (typeof v === "bigint" ? v.toString() : v),
          2
        )
      );

      return true;
    } catch (error) {
      console.error(`Error updating results file: ${error}`);
      return false;
    }
  }
}

// Execute the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
