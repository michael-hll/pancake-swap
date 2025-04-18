import fs from "fs";
import path from "path";
import {ArbitrageOpportunity} from "./types";

const DATA_DIRECTORY = path.join(__dirname, "../../data");
const OPPORTUNITIES_FILE = path.join(
  DATA_DIRECTORY,
  "arbitrage_opportunities.json"
);
const MAX_HISTORY_ENTRIES = 20; // Keep only the most recent 50 entries

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
 * @param limit Maximum number of opportunities to save per entry (default: 20)
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
    history: Array<{timestamp: string; opportunities: ArbitrageOpportunity[]}>;
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
    opportunities: opportunities.slice(0, limit),
  });

  console.log("History data length:", historyData.history.length);
  // Sort the history by timestamp in descending order
  historyData.history.sort((a, b) => {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  // Keep only last MAX_HISTORY_ENTRIES to prevent file from growing too large
  if (historyData.history.length > MAX_HISTORY_ENTRIES) {
    historyData.history = historyData.history.slice(-MAX_HISTORY_ENTRIES);
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
