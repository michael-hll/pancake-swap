// SPDX-License-Identifier: MIT
pragma solidity ^0.6.8;

//import "hardhat/console.sol";

import "./libraries/UniswapV2Library.sol";
import "./libraries/SafeERC20.sol";

import "./interfaces/IUniswapV2Pair.sol";
import "./interfaces/IUniswapV2Router01.sol";
import "./interfaces/IUniswapV2Router02.sol";
import "./interfaces/IUniswapV2Factory.sol";
import "./interfaces/IERC20.sol";

contract FlashSwap {
    using SafeERC20 for IERC20;
    address private owner;

    constructor() public {
        owner = msg.sender;
    }

    // Factory and Routing Addresses
    address private constant PANCAKE_FACTORY =
        0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73;
    address private constant PANCAKE_ROUTER =
        0x10ED43C718714eb63d5aA57B78B54704E256024E;

    // Token Addresses
    address private constant WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c; // WBNB
    address private TOKEN0 = 0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56; // BUSD
    address private TOKEN1 = 0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82; // CAKE
    address private TOKEN2 = 0x2c094F5A7D1146BB93850f629501eB749f6Ed491; // CROX

    // Trade Variables
    uint256 private deadline = block.timestamp + 1 days;
    uint256 private constant MAX_INT = type(uint256).max;

    event ArbitrageExecuted(
        address indexed tokenBorrowed,
        uint256 amountBorrowed,
        uint256 amountReturned,
        uint256 profit,
        bool success
    );

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

    function emergencyWithdraw(address _token) external {
        require(msg.sender == owner, "Only owner can withdraw");
        uint256 balance = IERC20(_token).balanceOf(address(this));
        if (balance > 0) {
            IERC20(_token).safeTransfer(owner, balance);
        }
    }

    // Add this function to receive BNB
    receive() external payable {}

    // Add a function to withdraw BNB
    function withdrawBNB() external {
        require(msg.sender == owner, "Only owner can withdraw");
        (bool success, ) = owner.call{value: address(this).balance}("");
        require(success, "BNB transfer failed");
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

        //console.log("expectedAmount", expectedAmount);

        // Add slippage tolerance
        uint256 amountOutMin = (expectedAmount * 997) / 1000; // 0.3% slippage max

        // Perform Arbitrage - Swap for another token
        uint256 amountReceived = IUniswapV2Router01(PANCAKE_ROUTER)
            .swapExactTokensForTokens(
                _amountIn,
                amountOutMin,
                path,
                address(this),
                deadline
            )[1];

        //console.log("Actually received:", amountReceived);
        //console.log("Slippage experienced:", expectedAmount - amountReceived);

        require(amountReceived > 0, "Aborted Tx: Trade returned zero");

        return amountReceived;
    }

    // CHECK PROFITABILITY
    // Checks whether output > input
    function checkProfitability(
        uint256 _input,
        uint256 _output
    ) private pure returns (bool) {
        return _output > (_input * 1005) / 1000; // 0.5% profit;
    }

    function start(
        address _token01,
        uint256 _borrow_amt,
        address _token02,
        address _token03
    ) external {
        require(msg.sender == owner, "Only owner can initiate arbitrage");
        TOKEN0 = _token01;
        TOKEN1 = _token02;
        TOKEN2 = _token03;
        IERC20(TOKEN0).safeApprove(address(PANCAKE_ROUTER), 0);
        IERC20(TOKEN0).safeApprove(address(PANCAKE_ROUTER), _borrow_amt);
        IERC20(TOKEN1).safeApprove(address(PANCAKE_ROUTER), MAX_INT);
        IERC20(TOKEN2).safeApprove(address(PANCAKE_ROUTER), MAX_INT);

        // Get the Factory Pair address for combined tokens
        address pair = IUniswapV2Factory(PANCAKE_FACTORY).getPair(
            _token01,
            WBNB
        );

        // Return error if combination does not exist
        require(
            pair != address(0),
            "TOKEN0-WBNB Pool does not exist on PancakeSwap"
        );

        // Figure out which token (0 or 1) has the amount and assign
        address token0 = IUniswapV2Pair(pair).token0();
        address token1 = IUniswapV2Pair(pair).token1();
        uint256 amount0Out = _token01 == token0 ? _borrow_amt : 0;
        uint256 amount1Out = _token01 == token1 ? _borrow_amt : 0;

        // Passing data as bytes so that the 'swap' function knows it is a flashloan
        bytes memory data = abi.encode(_token01, _borrow_amt, msg.sender);

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

        // Calculate the amount to repay at the end
        uint256 fee = ((amount * 3) / 997) + 1; // 0.3% ~ 0.4%
        uint256 amountToRepay = amount + fee;

        // DO ARBITRAGE

        // Assign loan amount
        uint256 loanAmount = _amount0 > 0 ? _amount0 : _amount1;
        // Verify loan amount matches the expected amount
        require(loanAmount == amount, "Flash loan amount mismatch");

        // Place Trades
        uint256 trade1AcquiredCoin = placeTrade(TOKEN0, TOKEN1, loanAmount);
        uint256 trade2AcquiredCoin = placeTrade(
            TOKEN1,
            TOKEN2,
            trade1AcquiredCoin
        );
        uint256 trade3AcquiredCoin = placeTrade(
            TOKEN2,
            TOKEN0,
            trade2AcquiredCoin
        );

        bool profCheck = checkProfitability(amountToRepay, trade3AcquiredCoin);
        emit ArbitrageExecuted(
            tokenBorrow,
            amount,
            trade3AcquiredCoin,
            trade3AcquiredCoin > amountToRepay
                ? trade3AcquiredCoin - amountToRepay
                : 0,
            profCheck
        );
        require(profCheck, "Arbitrage not profitable - trade cancelled");

        //  Pay Myself
        if (profCheck) {
            uint256 profit = trade3AcquiredCoin - amountToRepay;
            if (profit > 0) {
                IERC20(TOKEN0).safeTransfer(myAddress, profit);
            }
        }

        // Pay Loan Back
        IERC20(tokenBorrow).transfer(pair, amountToRepay);
    }
}
