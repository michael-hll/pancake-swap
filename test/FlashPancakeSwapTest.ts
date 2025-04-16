import {expect, assert} from "chai";
import {ethers, network} from "hardhat";
import {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/signers";
import {impersonateFundErc20} from "../utils/utilities";
import {abi} from "../artifacts/contracts/interfaces/IERC20.sol/IERC20.json";
import {FlashSwap} from "../typechain-types";
import {IERC20__factory, IERC20} from "../typechain-types";

const provider = ethers.provider;

describe("FlashSwap Contract", () => {
  let FLASHSWAP: FlashSwap;
  let BORROW_AMOUNT: bigint;
  let FUND_AMOUNT: bigint;
  let initialFundingHuman: string;
  let txArbitrage: any;
  let gasUsedUSD: number;
  let owner: HardhatEthersSigner;

  const DECIMALS = 18;

  // https://www.coincarp.com/currencies/binanceusd/richlist/
  /** Find the WHALE address has BUSD is a crusial step for this test  */
  const BUSD_WHALE = "0x8894e0a0c962cb723c1976a4421c95949be2d4e3";
  const BUSD = "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56";
  const CAKE = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82";
  const CROX = "0x2c094F5A7D1146BB93850f629501eB749f6Ed491";
  const USDT = "0x55d398326f99059fF775485246999027B3197955";

  const BASE_TOKEN_ADDRESS = BUSD;

  const tokenBase: IERC20 = IERC20__factory.connect(
    BASE_TOKEN_ADDRESS,
    provider
  );

  before(async () => {
    /* Important: It seems a contract deploy can trigger the fork state initialized */
    // const FlashSwap = await ethers.getContractFactory("PancakeFlashSwap");
    // FLASHSWAP = await FlashSwap.deploy();
  });

  beforeEach(async () => {
    //Get owner as signer
    [owner] = await ethers.getSigners();
    // Ensure that the WHALE has a balance
    // Configure Funding - FOR TESTING ONLY
    initialFundingHuman = "100";
    FUND_AMOUNT = ethers.parseUnits(initialFundingHuman, DECIMALS);

    // Deploy smart contract
    const FlashSwap = await ethers.getContractFactory("FlashSwap");
    FLASHSWAP = await FlashSwap.deploy();

    // Check if whale has enough balance
    const whale_balance = await provider.getBalance(BUSD_WHALE);
    console.log("Whale balance:", ethers.formatUnits(whale_balance, DECIMALS));

    //Ensure that the WHALE has enough BUSD
    const whale_busd_balance = await tokenBase.balanceOf(BUSD_WHALE);
    console.log(
      "Whale BUSD balance:",
      ethers.formatUnits(whale_busd_balance, DECIMALS)
    );
    expect(whale_busd_balance).to.be.gt(FUND_AMOUNT);

    // Configure our Borrowing
    const borrowAmountHuman = "1"; // 1 BUSD
    BORROW_AMOUNT = ethers.parseUnits(borrowAmountHuman, DECIMALS);

    // Fund our Contract - FOR TESTING ONLY
    await impersonateFundErc20(
      tokenBase,
      BUSD_WHALE,
      await FLASHSWAP.getAddress(),
      initialFundingHuman
    );
  });

  describe("Arbitrage Execution", () => {
    it("ensures the contract is funded", async () => {
      const flashSwapBalance = await FLASHSWAP.getBalanceOfToken(
        BASE_TOKEN_ADDRESS
      );
      const flashSwapBalanceHuman = ethers.formatUnits(
        flashSwapBalance,
        DECIMALS
      );
      expect(Number(flashSwapBalanceHuman)).equal(Number(initialFundingHuman));
    });

    it("executes the arbitrage", async () => {
      txArbitrage = await FLASHSWAP.start(
        BASE_TOKEN_ADDRESS,
        BORROW_AMOUNT,
        CAKE,
        CROX
      );

      assert(txArbitrage);

      // Print balances
      const contractBalanceBUSD = await FLASHSWAP.getBalanceOfToken(BUSD);
      const formattedBalBUSD = Number(
        ethers.formatUnits(contractBalanceBUSD, DECIMALS)
      );
      console.log("Balance of BUSD: " + formattedBalBUSD);

      const contractBalanceCROX = await FLASHSWAP.getBalanceOfToken(CROX);
      const formattedBalCROX = Number(
        ethers.formatUnits(contractBalanceCROX, DECIMALS)
      );
      console.log("Balance of CROX: " + formattedBalCROX);

      const contractBalanceCAKE = await FLASHSWAP.getBalanceOfToken(CAKE);
      const formattedBalCAKE = Number(
        ethers.formatUnits(contractBalanceCAKE, DECIMALS)
      );
      console.log("Balance of CAKE: " + formattedBalCAKE);
    });
  });
});
