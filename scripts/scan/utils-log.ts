import * as config from "./config";
import * as fs from "fs";
import * as path from "path";

// Make sure the data directory exists
function ensureDirectoryExists(directory: string): void {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, {recursive: true});
  }
}

export function debugLog(message?: any, ...optionalParams: any[]) {
  if (config.DEBUG) {
    if (config.DEBUG_TO_FILE) {
      try {
        // Ensure the data directory exists
        const dataDir = path.join(__dirname, "../../data");
        ensureDirectoryExists(dataDir);

        // Format the log message
        const timestamp = new Date().toISOString();
        let logMessage = `[${timestamp}] ${message || ""}`;

        // Format optional parameters
        if (optionalParams.length > 0) {
          // Handle objects and arrays by stringifying them
          const formattedParams = optionalParams.map((param) =>
            typeof param === "object" ? JSON.stringify(param, null, 2) : param
          );
          logMessage += " " + formattedParams.join(" ");
        }

        // Append to log file with a newline
        fs.appendFileSync(path.join(dataDir, "debug.log"), logMessage + "\n", {
          encoding: "utf8",
        });
      } catch (error) {
        // If file logging fails, fall back to console
        console.error("Error writing to debug log file:", error);
        console.log(message, ...optionalParams);
      }
    } else {
      console.log(message, ...optionalParams);
    }
  }
}
