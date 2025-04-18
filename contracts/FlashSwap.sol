// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./libraries/UniswapV2Library.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "./interfaces/IUniswapV2Pair.sol";
import "./interfaces/IUniswapV2Router01.sol";
import "./interfaces/IUniswapV2Router02.sol";
import "./interfaces/IUniswapV2Factory.sol";

/// @title FlashSwap - PancakeSwap V2 Flash Loan Arbitrage Contract
/// @notice This contract is designed for PancakeSwap V2
/// @dev Functions will not work with V3 pools
contract FlashSwap is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address private owner;
    bool private testMode;
    bool private debugMode;
    bool private locked;
    uint256 private deadlineMinutes = 5;

    address private PANCAKE_FACTORY;
    address private PANCAKE_ROUTER;
    address private BASE_TOKEN;

    constructor(address _factory, address _router, address _baseToken) {
        owner = msg.sender;
        PANCAKE_FACTORY = _factory;
        PANCAKE_ROUTER = _router;
        BASE_TOKEN = _baseToken;
    }

    // Token Addresses
    address private TOKEN0 = 0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56; // BUSD
    address private TOKEN1 = 0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82; // CAKE
    address private TOKEN2 = 0x2c094F5A7D1146BB93850f629501eB749f6Ed491; // CROX

    event ArbitrageExecuted(
        address indexed tokenBorrowed,
        uint256 amountBorrowed,
        uint256 amountReturned,
        uint256 profit,
        bool success
    );
    event DebugFlashLoanReceived(address token, uint256 amount);
    event DebugTradeExecuted(
        uint8 tradeNumber,
        address fromToken,
        address toToken,
        uint256 amountIn,
        uint256 amountOut
    );
    event DebugPoolLiquidity(
        address pair,
        address token0,
        address token1,
        uint256 reserve0,
        uint256 reserve1
    );

    function setTestMode(bool _testMode) external {
        require(msg.sender == owner, "Only owner can set test mode");
        testMode = _testMode;
    }

    function getTestMode() external view returns (bool) {
        require(msg.sender == owner, "Only owner can get test mode");
        return testMode;
    }

    function setDebugMode(bool _debugMode) external {
        require(msg.sender == owner, "Only owner can set debug mode");
        debugMode = _debugMode;
    }

    function getDebugMode() external view returns (bool) {
        require(msg.sender == owner, "Only owner can get debug mode");
        return debugMode;
    }

    function setDeadlineMinutes(uint256 _minutes) public {
        require(msg.sender == owner, "Only owner can set deadline minutes");
        require(
            _minutes > 0 && _minutes <= 60,
            "Minutes must be between 1 and 60"
        );
        deadlineMinutes = _minutes;
    }

    function getDeadlineMinutes() external view returns (uint256) {
        require(msg.sender == owner, "Only owner can get deadline minutes");
        return deadlineMinutes;
    }

    function getFactory() external view returns (address) {
        require(msg.sender == owner, "Only owner can get factory");
        return PANCAKE_FACTORY;
    }

    function getRouter() external view returns (address) {
        require(msg.sender == owner, "Only owner can get router");
        return PANCAKE_ROUTER;
    }

    function getBaseToken() external view returns (address) {
        require(msg.sender == owner, "Only owner can get base token");
        return BASE_TOKEN;
    }

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

    // Add this function to receive Base Token
    receive() external payable {}

    // Add a function to withdraw Base Token
    function withdrawBaseToken() external {
        require(msg.sender == owner, "Only owner can withdraw");
        (bool success, ) = owner.call{value: address(this).balance}("");
        require(success, "BaseToken transfer failed");
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

        // Add slippage tolerance
        uint256 amountOutMin = (expectedAmount * 997) / 1000; // 0.3% slippage max

        uint256 currentDeadline = block.timestamp +
            (deadlineMinutes * 1 minutes);
        // Perform Arbitrage - Swap for another token
        uint256 amountReceived = IUniswapV2Router01(PANCAKE_ROUTER)
            .swapExactTokensForTokens(
                _amountIn,
                amountOutMin,
                path,
                address(this),
                currentDeadline
            )[1];

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

    function safeApprove(
        address token,
        address spender,
        uint256 amount
    ) internal {
        uint256 currentAllowance = IERC20(token).allowance(
            address(this),
            spender
        );
        if (currentAllowance < amount) {
            IERC20(token).safeApprove(spender, 0);
            IERC20(token).safeApprove(spender, amount);
        }
    }

    function validateArbitrageParameters(
        address _token0,
        uint256 _borrow_amt,
        address _token1,
        address _token2
    ) private view returns (address) {
        // Basic parameter validation
        require(_token0 != address(0), "Token0 cannot be zero address");
        require(_token1 != address(0), "Token1 cannot be zero address");
        require(_token2 != address(0), "Token2 cannot be zero address");
        require(_borrow_amt > 0, "Borrow amount must be greater than zero");

        // Prevent token conflicts
        require(_token0 != _token1, "Token0 and Token1 must be different");
        require(_token1 != _token2, "Token1 and Token2 must be different");
        require(_token2 != _token0, "Token2 and Token0 must be different");
        require(
            _token0 != BASE_TOKEN,
            "Token0 cannot be base token to avoid lock conflict"
        );
        require(
            _token1 != BASE_TOKEN,
            "Token1 cannot be base token to avoid lock conflict"
        );
        require(
            _token2 != BASE_TOKEN,
            "Token2 cannot be base token to avoid lock conflict"
        );

        // Check all required pools exist
        address pairBorrow = IUniswapV2Factory(PANCAKE_FACTORY).getPair(
            _token0,
            BASE_TOKEN
        );
        require(
            pairBorrow != address(0),
            "TOKEN0-BASE_TOKEN Pool does not exist"
        );

        address pair01 = IUniswapV2Factory(PANCAKE_FACTORY).getPair(
            _token0,
            _token1
        );
        require(pair01 != address(0), "TOKEN0-TOKEN1 Pool does not exist");

        address pair12 = IUniswapV2Factory(PANCAKE_FACTORY).getPair(
            _token1,
            _token2
        );
        require(pair12 != address(0), "TOKEN1-TOKEN2 Pool does not exist");

        address pair20 = IUniswapV2Factory(PANCAKE_FACTORY).getPair(
            _token2,
            _token0
        );
        require(pair20 != address(0), "TOKEN2-TOKEN0 Pool does not exist");

        // this can reduce one getPair call
        return pairBorrow;
    }

    /// @notice Executes a flash loan arbitrage opportunity
    /// @param _token0 The token to borrow from flash loan
    /// @param _borrow_amt Amount to borrow
    /// @param _token1 First token to swap to
    /// @param _token2 Second token to swap to
    /// @param _deadlineMinutes Maximum time the transaction can be pending; Value 0 will use default
    function start(
        address _token0,
        uint256 _borrow_amt,
        address _token1,
        address _token2,
        uint256 _deadlineMinutes
    ) external {
        require(msg.sender == owner, "Only owner can initiate arbitrage");

        address pair = validateArbitrageParameters(
            _token0,
            _borrow_amt,
            _token1,
            _token2
        );

        if (_deadlineMinutes > 0) {
            setDeadlineMinutes(_deadlineMinutes);
        }
        TOKEN0 = _token0;
        TOKEN1 = _token1;
        TOKEN2 = _token2;
        uint256 MAX_UINT = type(uint256).max;
        safeApprove(TOKEN0, address(PANCAKE_ROUTER), MAX_UINT);
        safeApprove(TOKEN1, address(PANCAKE_ROUTER), MAX_UINT);
        safeApprove(TOKEN2, address(PANCAKE_ROUTER), MAX_UINT);

        // Figure out which token (0 or 1) has the amount and assign
        address token0 = IUniswapV2Pair(pair).token0();
        address token1 = IUniswapV2Pair(pair).token1();
        uint256 amount0Out = TOKEN0 == token0 ? _borrow_amt : 0;
        uint256 amount1Out = TOKEN0 == token1 ? _borrow_amt : 0;

        // Passing data as bytes so that the 'swap' function knows it is a flashloan
        bytes memory data = abi.encode(TOKEN0, _borrow_amt, msg.sender);

        // Execute the initial swap to get the loan
        IUniswapV2Pair(pair).swap(amount0Out, amount1Out, address(this), data);
    }

    function pancakeCall(
        address _sender,
        uint256 _amount0,
        uint256 _amount1,
        bytes calldata _data
    ) external nonReentrant {
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
        (address tokenBorrow, uint256 amount, address myAccountAddress) = abi
            .decode(_data, (address, uint256, address));
        if (debugMode) {
            emit DebugFlashLoanReceived(tokenBorrow, amount);
        }

        // Calculate the amount to repay at the end
        uint256 fee = ((amount * 3) / 997) + 1; // 0.3% ~ 0.4%
        uint256 amountToRepay = amount + fee;

        // DO TRIANGLE ARBITRAGE
        // Assign loan amount
        uint256 loanAmount = _amount0 > 0 ? _amount0 : _amount1;
        // Verify loan amount matches the expected amount
        require(loanAmount == amount, "Flash loan amount mismatch");

        if (debugMode) {
            (uint112 reserve0, uint112 reserve1, ) = IUniswapV2Pair(pair)
                .getReserves();
            address token0Pair = IUniswapV2Pair(pair).token0();
            address token1Pair = IUniswapV2Pair(pair).token1();
            emit DebugPoolLiquidity(
                pair,
                token0Pair,
                token1Pair,
                reserve0,
                reserve1
            );
            // emit all pool reserves
            debugAllPoolReserves();
        }

        // Place Trades
        // Trade: TOKEN0 -> TOKEN1
        uint256 trade1AcquiredCoin = placeTrade(TOKEN0, TOKEN1, loanAmount);
        if (debugMode) {
            emit DebugTradeExecuted(
                1,
                TOKEN0,
                TOKEN1,
                loanAmount,
                trade1AcquiredCoin
            );
        }

        // Trade: TOKEN1 -> TOKEN2
        uint256 trade2AcquiredCoin = placeTrade(
            TOKEN1,
            TOKEN2,
            trade1AcquiredCoin
        );
        if (debugMode) {
            emit DebugTradeExecuted(
                2,
                TOKEN1,
                TOKEN2,
                trade1AcquiredCoin,
                trade2AcquiredCoin
            );
        }

        // Trade: TOKEN2 -> TOKEN0
        uint256 trade3AcquiredCoin = placeTrade(
            TOKEN2,
            TOKEN0,
            trade2AcquiredCoin
        );
        if (debugMode) {
            emit DebugTradeExecuted(
                3,
                TOKEN2,
                TOKEN0,
                trade2AcquiredCoin,
                trade3AcquiredCoin
            );
        }

        // Profit Check
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
        if (!testMode) {
            require(profCheck, "Arbitrage not profitable - trade cancelled");
        }

        // Pay Loan Back
        IERC20(tokenBorrow).safeTransfer(pair, amountToRepay);

        // Pay Myself
        if (profCheck) {
            if (trade3AcquiredCoin > amountToRepay) {
                IERC20(TOKEN0).safeTransfer(
                    myAccountAddress,
                    trade3AcquiredCoin - amountToRepay
                );
            }
        }
    }

    function debugAllPoolReserves() private {
        // Check borrowing pool (already done in main code)

        // Check TOKEN0-TOKEN1 pool
        address pair01 = IUniswapV2Factory(PANCAKE_FACTORY).getPair(
            TOKEN0,
            TOKEN1
        );
        if (pair01 != address(0)) {
            (uint112 reserve0, uint112 reserve1, ) = IUniswapV2Pair(pair01)
                .getReserves();
            address token0 = IUniswapV2Pair(pair01).token0();
            address token1 = IUniswapV2Pair(pair01).token1();
            emit DebugPoolLiquidity(pair01, token0, token1, reserve0, reserve1);
        }

        // Check TOKEN1-TOKEN2 pool
        address pair12 = IUniswapV2Factory(PANCAKE_FACTORY).getPair(
            TOKEN1,
            TOKEN2
        );
        if (pair12 != address(0)) {
            (uint112 reserve0, uint112 reserve1, ) = IUniswapV2Pair(pair12)
                .getReserves();
            address token0 = IUniswapV2Pair(pair12).token0();
            address token1 = IUniswapV2Pair(pair12).token1();
            emit DebugPoolLiquidity(pair12, token0, token1, reserve0, reserve1);
        }

        // Check TOKEN2-TOKEN0 pool
        address pair20 = IUniswapV2Factory(PANCAKE_FACTORY).getPair(
            TOKEN2,
            TOKEN0
        );
        if (pair20 != address(0)) {
            (uint112 reserve0, uint112 reserve1, ) = IUniswapV2Pair(pair20)
                .getReserves();
            address token0 = IUniswapV2Pair(pair20).token0();
            address token1 = IUniswapV2Pair(pair20).token1();
            emit DebugPoolLiquidity(pair20, token0, token1, reserve0, reserve1);
        }
    }
}
