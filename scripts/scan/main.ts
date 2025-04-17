import * as scannerOps from "./monitor";

async function main() {
  console.log("Starting PancakeSwap V2 Arbitrage Scanner...");

  // Start the monitoring
  await scannerOps.startMonitoring();
}

// Execute the script
main()
  .then(() => {
    // Keep running indefinitely
    console.log("Arbitrage scanner running. Press Ctrl+C to exit.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
