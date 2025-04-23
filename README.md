# Flash Loan Arbitrage for PancakeSwap

This project implements a flash loan arbitrage system for PancakeSwap V2 on Binance Smart Chain (BSC). It consists of a smart contract for executing triangle arbitrage opportunities and a scanning system to detect profitable trading paths.

## Project Structure

- contracts: Smart contracts for flash loan arbitrage execution
- scan: Opportunity scanner that monitors pools and identifies profitable trades

## Features

- Automatic arbitrage opportunity scanning across pools
- Optimized triangle arbitrage execution (token0 → token1 → token2 → token0)
- Flexible profit threshold configuration
- Simulation mode to test opportunities without real transactions
- Queue system for managing multiple arbitrage opportunities

## Setup and Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Compile the contracts:
   ```bash
   npm run compile
   ```

## Usage

### 1. Deploy the FlashSwap Contract

Deploy to BSC Testnet:

```bash
npm run deploy:testnet
```

Deploy to BSC Mainnet:

```bash
npm run deploy:mainnet
```

### 2. Simulate Arbitrage (Test Before Execution)

Simulate on BSC Testnet:

```bash
npm run start-simulation:testnet
```

Simulate on BSC Mainnet:

```bash
npm run start-simulation:mainnet
```

### 3. Execute Arbitrage

Execute on BSC Testnet:

```bash
npm run start:testnet
```

Execute on BSC Mainnet:

```bash
npm run start:mainnet
```

### 4. Run the Scanner

Start the scanner to automatically find arbitrage opportunities:

```bash
npx hardhat run scripts/scan/main.ts
```

## Configuration

- Edit config.ts to adjust:
  - Minimum profit threshold
  - Token priorities
  - Scanning intervals
  - Pool sampling parameters

## License

MIT

## Disclaimer

This software is for educational purposes only. Use at your own risk. Trading cryptocurrencies involves significant risk and you could lose your money.
