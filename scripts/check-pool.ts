// scripts/check-pool-liquidity.ts
import {ethers} from "hardhat";

async function main() {
  const FACTORY = "0x6725F303b657a9451d8BA641348b6761A6CC7a17";
  const BUSD = "0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7";
  const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";
  const CAKE = "0xFa60D973F7642B748046464e165A65B7323b0DEE";
  const USDT = "0x7ef95a0FEE0Dd31b22626fA2e10Ee6A223F8a684";
  const USDC = "0x64544969ed7EBf5f083679233325356EbE738930";

  // Factory ABI (just the getPair function)
  const factoryAbi = [
    "function getPair(address tokenA, address tokenB) external view returns (address pair)",
  ];
  const factory = new ethers.Contract(FACTORY, factoryAbi, ethers.provider);

  const TOKEN0 = BUSD;
  const TOKEN1 = USDC;

  // Get the pair address
  const pairAddress = await factory.getPair(TOKEN0, TOKEN1);
  console.log(`${TOKEN0} => ${TOKEN1} Pair Address: ${pairAddress}`);

  if (pairAddress === "0x0000000000000000000000000000000000000000") {
    console.log("Pool doesn't exist! You need to create it first.");
    return;
  }

  // Get reserves in the pair
  const pairAbi = [
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  ];
  const pair = new ethers.Contract(pairAddress, pairAbi, ethers.provider);

  const [reserve0, reserve1] = await pair.getReserves();

  // Find out which token is token0 and which is token1
  const token0Abi = ["function token0() external view returns (address)"];
  const tokenContract = new ethers.Contract(
    pairAddress,
    token0Abi,
    ethers.provider
  );
  const token0 = await tokenContract.token0();

  // Display the reserves
  if (token0.toLowerCase() === TOKEN0.toLowerCase()) {
    console.log(`${TOKEN0} Reserve: ${ethers.formatUnits(reserve0, 18)}`);
    console.log(`${TOKEN1} Reserve: ${ethers.formatUnits(reserve1, 18)}`);
  } else {
    console.log(`${TOKEN1} Reserve: ${ethers.formatUnits(reserve1, 18)}`);
    console.log(`${TOKEN0} Reserve: ${ethers.formatUnits(reserve0, 18)}`);
  }
}

main().catch(console.error);
