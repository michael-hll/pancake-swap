import { ethers } from "hardhat";

async function checkCode(address: string) {
  // Use Hardhat's configured provider (respects --network flag)
  const code = await ethers.provider.getCode(address);
  console.log("Code:", code);

  if (!code || code === "0x") {
    console.log("Address is likely an EOA (no contract)");
  } else {
    console.log("Address has contract bytecode!");
  }
}

async function main() {
  const addr = process.argv[2] || "0x31CAB5aa101991d064613f5b6D79738Cb63045b8";
  console.log(`Checking code at ${addr} using network provider`);
  await checkCode(addr);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});