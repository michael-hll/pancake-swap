// SPDX-License-Identifier: MIT
pragma solidity ^0.6.8;

import "hardhat/console.sol";

import "./libraries/UniswapV2Library.sol";
import "./libraries/SafeERC20.sol";

import "./interfaces/IUniswapV2Pair.sol";
import "./interfaces/IUniswapV2Router01.sol";
import "./interfaces/IUniswapV2Router02.sol";
import "./interfaces/IUniswapV2Factory.sol";
import "./interfaces/IERC20.sol";

contract PancakeFlashSwap {
    using SafeERC20 for IERC20;

    // Factory and Routing Addresses
    address private constant PANCAKE_FACTORY =
        0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73;
    address private constant PANCAKE_ROUTER =
        0x10ED43C718714eb63d5aA57B78B54704E256024E;

    // Token Addresses
    address private constant WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    address private constant BUSD = 0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56;
    address private constant CAKE = 0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82;
    address private constant CROX = 0x2c094F5A7D1146BB93850f629501eB749f6Ed491;

    // Trade Variables
    uint256 private deadline = block.timestamp + 1 days;
    uint256 private constant MAX_INT = type(uint256).max;

    // FUND SMART CONTRACT
    // Provides a function to allow contract to be funded
    function fundFlashSwapContract(
        address _owner,
        address _token,
        uint256 _amount
    ) public {
        IERC20(_token).transferFrom(_owner, address(this), _amount);
    }

    // GET CONTRACT BALANCE
    // Allows public view of balance for contract
    function getBalanceOfToken(address _token) public view returns (uint256) {
        return IERC20(_token).balanceOf(address(this));
    }

    // PLACE A TRADE
    // Executed placing a trade
    function placeTrade(
        address _fromToken,
        address _toToken,
        uint256 _amountIn
    ) private returns (uint256) {
        address pair = IUniswapV2Factory(PANCAKE_FACTORY).getPair(
            _fromToken,
            _toToken
        );
        require(pair != address(0), "Pool does not exist");

        // Calculate Amount Out
        address[] memory path = new address[](2);
        path[0] = _fromToken;
        path[1] = _toToken;

        uint256 expectedAmount = IUniswapV2Router01(PANCAKE_ROUTER)
            .getAmountsOut(_amountIn, path)[1];

        // console.log("expectedAmount", expectedAmount);

        // Add slippage tolerance
        uint256 amountOutMin = (expectedAmount * 997) / 1000; // 0.3% slippage max

        // Perform Arbitrage - Swap for another token
        uint256 amountReceived = IUniswapV2Router01(PANCAKE_ROUTER)
            .swapExactTokensForTokens(
                _amountIn, // amountIn
                amountOutMin, // amountOutMin
                path, // path
                address(this), // address to
                deadline // deadline
            )[1];

        console.log("Actually received:", amountReceived);
        console.log("Slippage experienced:", expectedAmount - amountReceived);

        require(amountReceived > 0, "Aborted Tx: Trade returned zero");

        return amountReceived;
    }

    // CHECK PROFITABILITY
    // Checks whether > output > input
    function checkProfitability(
        uint256 _input,
        uint256 _output
    ) private pure returns (bool) {
        return _output > _input;
    }

    // INITIATE ARBITRAGE
    // Begins receiving loan to engage performing arbitrage trades
    function startArbitrage(address _tokenBorrow, uint256 _amount) external {
        IERC20(BUSD).safeApprove(address(PANCAKE_ROUTER), MAX_INT);
        IERC20(CROX).safeApprove(address(PANCAKE_ROUTER), MAX_INT);
        IERC20(CAKE).safeApprove(address(PANCAKE_ROUTER), MAX_INT);

        // Get the Factory Pair address for combined tokens
        address pair = IUniswapV2Factory(PANCAKE_FACTORY).getPair(
            _tokenBorrow,
            WBNB
        );

        // Return error if combination does not exist
        require(pair != address(0), "Pool does not exist");

        // Figure out which token (0 or 1) has the amount and assign
        address token0 = IUniswapV2Pair(pair).token0();
        address token1 = IUniswapV2Pair(pair).token1();
        uint256 amount0Out = _tokenBorrow == token0 ? _amount : 0;
        uint256 amount1Out = _tokenBorrow == token1 ? _amount : 0;

        // Passing data as bytes so that the 'swap' function knows it is a flashloan
        bytes memory data = abi.encode(_tokenBorrow, _amount, msg.sender);

        // Execute the initial swap to get the loan
        IUniswapV2Pair(pair).swap(amount0Out, amount1Out, address(this), data);
    }

    function pancakeCall(
        address _sender,
        uint256 _amount0,
        uint256 _amount1,
        bytes calldata _data
    ) external {
        // Ensure this request came from the contract
        address token0 = IUniswapV2Pair(msg.sender).token0();
        address token1 = IUniswapV2Pair(msg.sender).token1();
        address pair = IUniswapV2Factory(PANCAKE_FACTORY).getPair(
            token0,
            token1
        );
        require(msg.sender == pair, "The sender needs to match the pair");
        require(_sender == address(this), "Sender should match this contract");

        // Decode data for calculating the repayment
        (address tokenBorrow, uint256 amount, address myAddress) = abi.decode(
            _data,
            (address, uint256, address)
        );

        // Add after decoding the data
        // This is only to confirm we borrowed the money
        console.log("Borrowed amount received:", amount);
        console.log(
            "Current balance:",
            IERC20(tokenBorrow).balanceOf(address(this))
        );

        // Calculate the amount to repay at the end
        uint256 fee = ((amount * 3) / 997) + 1; // 0.3% ~ 0.4%
        uint256 amountToRepay = amount + fee;

        // DO ARBITRAGE

        // Assign loan amount
        uint256 loanAmount = _amount0 > 0 ? _amount0 : _amount1;
        // Verify loan amount matches the expected amount
        require(loanAmount == amount, "Flash loan amount mismatch");

        // // Place Trades
        uint256 trade1AcquiredCoin = placeTrade(BUSD, CROX, loanAmount);
        uint256 trade2AcquiredCoin = placeTrade(CROX, CAKE, trade1AcquiredCoin);
        uint256 trade3AcquiredCoin = placeTrade(CAKE, BUSD, trade2AcquiredCoin);

        //  Check Profitability
        console.log("=======================");
        console.log("Amount borrowed: ", amount);
        console.log("Amount fee:", fee);
        console.log("Amount to repay (amount + fee): ", amountToRepay);
        console.log("Amount received: ", trade3AcquiredCoin);

        // Correctly handle the profit/loss display with signed integers
        if (trade3AcquiredCoin > amountToRepay) {
            console.log("Final Profit: ", trade3AcquiredCoin - amountToRepay);
        } else {
            console.log("Final Loss: ", amountToRepay - trade3AcquiredCoin);

            // Calculate loss percentage for better context
            uint256 lossPercentage = ((amountToRepay - trade3AcquiredCoin) *
                10000) / amountToRepay;
            console.log(
                "Loss percentage(%): ",
                lossPercentage / 100,
                ".",
                lossPercentage % 100
            );
        }

        bool profCheck = checkProfitability(amountToRepay, trade3AcquiredCoin);
        //require(profCheck, "Arbitrage not profitable");

        //  Pay Myself
        if (profCheck) {
            IERC20 otherToken = IERC20(BUSD);
            otherToken.transfer(myAddress, trade3AcquiredCoin - amountToRepay);
        }

        // Pay Loan Back
        IERC20(tokenBorrow).transfer(pair, amountToRepay);
    }
}
