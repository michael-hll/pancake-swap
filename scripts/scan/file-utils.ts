import fs from "fs";
import path from "path";
import {ArbitrageOpportunity, PoolData} from "./types";
import {MAX_PROFIT_HISTORY_ITEMS} from "./config";

const DATA_DIRECTORY = path.join(__dirname, "../../data");
const OPPORTUNITIES_FILE = path.join(
  DATA_DIRECTORY,
  "arbitrage_opportunities.json"
);

/**
 * Makes sure the data directory exists
 */
function ensureDataDirectory() {
  if (!fs.existsSync(DATA_DIRECTORY)) {
    fs.mkdirSync(DATA_DIRECTORY, {recursive: true});
  }
}

/**
 * Save arbitrage opportunities to file in append mode
 * @param opportunities Array of arbitrage opportunities
 * @param limit Maximum number of opportunities to save per entry (default: 100)
 */
export function saveArbitrageOpportunities(
  opportunities: ArbitrageOpportunity[],
  limit: number = 100
) {
  if (!opportunities || opportunities.length === 0) {
    return; // Don't save if no opportunities
  }

  ensureDataDirectory();

  // Read existing data (if any)
  let historyData: {
    history: Array<{
      timestamp: string;
      timestampLocal?: string;
      opportunities: ArbitrageOpportunity[];
    }>;
  } = {
    history: [],
  };

  try {
    if (fs.existsSync(OPPORTUNITIES_FILE)) {
      const fileContent = fs.readFileSync(OPPORTUNITIES_FILE, "utf8");
      const parsedData = JSON.parse(fileContent);

      // Handle both old and new format
      if (Array.isArray(parsedData.history)) {
        historyData = parsedData;
      } else {
        // If it's the old format (single entry), convert to history format
        historyData.history = [parsedData];
      }
    }
  } catch (error) {
    console.log("Error reading existing opportunities file, starting fresh");
  }

  // Add new opportunities with timestamp
  historyData.history.push({
    timestamp: new Date().toISOString(),
    timestampLocal: new Date().toLocaleString(),
    opportunities: opportunities.slice(0, limit),
  });

  console.log("History data length:", historyData.history.length);

  // Sort the history by timestamp in descending order
  historyData.history.sort((a, b) => {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  // Keep only first MAX_HISTORY_ENTRIES (newest ones) to prevent file from growing too large
  if (historyData.history.length > MAX_PROFIT_HISTORY_ITEMS) {
    historyData.history = historyData.history.slice(
      0,
      MAX_PROFIT_HISTORY_ITEMS
    );
  }

  // Write back the updated data
  fs.writeFileSync(OPPORTUNITIES_FILE, JSON.stringify(historyData, null, 2));

  console.log(
    `Saved ${Math.min(
      opportunities.length,
      limit
    )} opportunities to history file`
  );
}
/**
 * Get the most recent arbitrage opportunities from file
 * @returns The most recent opportunities or null if file doesn't exist
 */
export function getLatestOpportunities(): ArbitrageOpportunity[] | null {
  try {
    if (fs.existsSync(OPPORTUNITIES_FILE)) {
      const fileContent = fs.readFileSync(OPPORTUNITIES_FILE, "utf8");
      const data = JSON.parse(fileContent);

      if (data.history && data.history.length > 0) {
        return data.history[data.history.length - 1].opportunities;
      } else if (data.opportunities) {
        // Handle old format
        return data.opportunities;
      }
    }
  } catch (error) {
    console.log("Error reading opportunities file:", error);
  }

  return null;
}

export function saveLocalEstimatesForAnalysis(
  startToken: string,
  midToken: string,
  destToken: string,
  testResults: any[],
  pool1: PoolData,
  pool2: PoolData,
  pool3: PoolData
) {
  try {
    const DATA_DIRECTORY = path.join(__dirname, "../../data");
    const LOCAL_ESTIMATES_FILE = path.join(
      DATA_DIRECTORY,
      "local_estimate_analysis.json"
    );

    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIRECTORY)) {
      fs.mkdirSync(DATA_DIRECTORY, {recursive: true});
    }

    // Prepare data to save
    const analysisData = {
      timestamp: new Date().toISOString(),
      timestampLocal: new Date().toLocaleString(),
      path: [
        {
          poolAddress: pool1.address,
          tokenIn: startToken,
          tokenOut: midToken,
          tokenInSymbol:
            pool1.token0.address === startToken
              ? pool1.token0.symbol
              : pool1.token1.symbol,
          tokenOutSymbol:
            pool1.token0.address === startToken
              ? pool1.token1.symbol
              : pool1.token0.symbol,
        },
        {
          poolAddress: pool2.address,
          tokenIn: midToken,
          tokenOut: destToken,
          tokenInSymbol:
            pool2.token0.address === midToken
              ? pool2.token0.symbol
              : pool2.token1.symbol,
          tokenOutSymbol:
            pool2.token0.address === midToken
              ? pool2.token1.symbol
              : pool2.token0.symbol,
        },
        {
          poolAddress: pool3.address,
          tokenIn: destToken,
          tokenOut: startToken,
          tokenInSymbol:
            pool3.token0.address === destToken
              ? pool3.token0.symbol
              : pool3.token1.symbol,
          tokenOutSymbol:
            pool3.token0.address === destToken
              ? pool3.token1.symbol
              : pool3.token0.symbol,
        },
      ],
      testResults: testResults,
      poolData: {
        pool1: {
          address: pool1.address,
          token0: {
            symbol: pool1.token0.symbol,
            reserve: pool1.token0.reserve,
          },
          token1: {
            symbol: pool1.token1.symbol,
            reserve: pool1.token1.reserve,
          },
        },
        pool2: {
          address: pool2.address,
          token0: {
            symbol: pool2.token0.symbol,
            reserve: pool2.token0.reserve,
          },
          token1: {
            symbol: pool2.token1.symbol,
            reserve: pool2.token1.reserve,
          },
        },
        pool3: {
          address: pool3.address,
          token0: {
            symbol: pool3.token0.symbol,
            reserve: pool3.token0.reserve,
          },
          token1: {
            symbol: pool3.token1.symbol,
            reserve: pool3.token1.reserve,
          },
        },
      },
    };

    // Read existing data
    let historicalData = [];
    try {
      if (fs.existsSync(LOCAL_ESTIMATES_FILE)) {
        const fileContent = fs.readFileSync(LOCAL_ESTIMATES_FILE, "utf8");
        historicalData = JSON.parse(fileContent);
      }
    } catch (error) {
      console.log("Starting new local estimates analysis file");
    }

    // Add new data and limit size to prevent file growth
    historicalData.push(analysisData);
    if (historicalData.length > 100) {
      historicalData = historicalData.slice(-100);
    }

    // Write updated data
    fs.writeFileSync(
      LOCAL_ESTIMATES_FILE,
      JSON.stringify(historicalData, null, 2)
    );
    console.log(
      `Saved local estimate analysis for ${pool1.token0.symbol}-${pool2.token1.symbol}-${pool3.token0.symbol} path`
    );
  } catch (error) {
    console.error("Error saving local estimate analysis:", error);
  }
}
