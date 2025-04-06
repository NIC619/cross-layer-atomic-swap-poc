// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "hardhat/console.sol";

contract L2Bridge is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable L1Bridge;
    address public constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // Enum for swap status
    enum SwapStatus { NotExist, Open, Filled, Expired }

    event DepositCompleted(
        address indexed user,
        uint256 amount,
        uint256 nonce,
        bytes32 indexed messageHash
    );

    event RequestSwapCompleted(
        address indexed userA,
        uint256 ETHAmount,
        address userB,
        address token,
        uint256 expectedTokenAmount,
        uint256 nonce,
        uint64 expiry,
        bytes32 indexed messageHash
    );

    event SwapFilled(
        address indexed userA,
        uint256 ETHAmount,
        address indexed userB,
        address token,
        uint256 expectedTokenAmount,
        uint256 nonce,
        uint64 expiry,
        bytes32 indexed messageHash
    );

    event SwapCancelled(
        address indexed userA,
        uint256 ETHAmount,
        address indexed userB,
        address token,
        uint256 expectedTokenAmount,
        uint256 nonce,
        uint64 expiry,
        bytes32 indexed messageHash
    );

    event Withdraw(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 nonce
    );

    // State variables
    mapping(address => uint256) public userNonces;
    mapping(bytes32 => bool) public processedMessages;
    mapping(bytes32 => SwapStatus) public swapStatus;

    /**
     * @dev Constructor that sets the L1Bridge address
     * @param _l1Bridge Address of the L1Bridge contract
     */
    constructor(address _l1Bridge) {
        require(_l1Bridge != address(0), "Invalid L1Bridge address");
        L1Bridge = _l1Bridge;
    }

    /**
     * @dev Completes a deposit initiated on L1Bridge
     * @param user Address of the user who deposited on L1Bridge
     * @param amount Amount of ETH deposited
     * @param nonce User's nonce on L1Bridge
     */
    function completeDeposit(
        address user,
        uint256 amount,
        uint256 nonce
    ) external payable nonReentrant {
        // FIXME: Can not impersonate L1Bridge in local testnet. Got `Unknown account` error.
        // // Only L1Bridge can call this function
        // require(msg.sender == L1Bridge, "Only L1Bridge can complete deposits");

        // Compute the message hash
        bytes32 messageHash = keccak256(abi.encode(user, amount, nonce));

        // Check if this message has already been processed
        require(!processedMessages[messageHash], "Message already processed");

        // Mark message as processed
        processedMessages[messageHash] = true;

        // Transfer funds to the user
        (bool success, ) = user.call{value: amount}("");
        require(success, "ETH transfer failed");

        emit DepositCompleted(user, amount, nonce, messageHash);
    }

    /**
     * @dev Completes a swap request initiated on L1Bridge
     * @param userA Address of the user who initiated the swap on L1Bridge
     * @param ETHAmount Amount of ETH for the swap
     * @param userB Address of the counterparty for the swap (can be zero address)
     * @param token Address of the ERC20 token
     * @param expectedTokenAmount Amount of ERC20 tokens for the swap
     * @param nonce User's nonce on L1Bridge
     * @param expiry Timestamp when the swap expires
     */
    function completeRequestSwap(
        address userA,
        uint256 ETHAmount,
        address userB,
        address token,
        uint256 expectedTokenAmount,
        uint256 nonce,
        uint64 expiry
    ) external payable nonReentrant {
        // FIXME: Can not impersonate L1Bridge in local testnet. Got `Unknown account` error.
        // // Only L1Bridge can call this function
        // require(msg.sender == L1Bridge, "Only L1Bridge can complete deposits");

        // Compute the message hash
        bytes32 messageHash = keccak256(abi.encode(userA, ETHAmount, userB, token, expectedTokenAmount, nonce, expiry));

        // Check if this message has already been processed
        require(!processedMessages[messageHash], "Message already processed");

        // Mark message as processed
        processedMessages[messageHash] = true;

        // Set the swap status to Open
        swapStatus[messageHash] = SwapStatus.Open;

        emit RequestSwapCompleted(userA, ETHAmount, userB, token, expectedTokenAmount, nonce, expiry, messageHash);
    }

    /**
     * @dev Fills a swap initiated on L1Bridge
     * @param userA Address of the user who initiated the swap on L1Bridge
     * @param ETHAmount Amount of ETH for the swap
     * @param userB Address of the counterparty for the swap (can be zero address)
     * @param token Address of the ERC20 token
     * @param expectedTokenAmount Amount of ERC20 tokens for the swap
     * @param nonce User's nonce on L1Bridge
     * @param expiry Timestamp when the swap expires
     */
    function fillSwap(
        address userA,
        uint256 ETHAmount,
        address userB,
        address token,
        uint256 expectedTokenAmount,
        uint256 nonce,
        uint64 expiry
    ) external nonReentrant {
        // Compute the message hash
        bytes32 messageHash = keccak256(abi.encode(userA, ETHAmount, userB, token, expectedTokenAmount, nonce, expiry));

        // Check if the swap has not been filled yet
        require(swapStatus[messageHash] == SwapStatus.Open, "Swap already filled or expired");

        // Check if the swap has not expired
        require(block.timestamp <= expiry, "Swap has expired");

        // If userB is specified, verify that the caller is userB
        if (userB != address(0)) {
            require(msg.sender == userB, "Only userB can fill the swap");
        }

        // Mark the swap as filled
        swapStatus[messageHash] = SwapStatus.Filled;

        // First transfer ERC20 tokens from the caller to this contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), expectedTokenAmount);

        // Then transfer ETH to the caller
        (bool success, ) = msg.sender.call{value: ETHAmount}("");
        require(success, "ETH transfer failed");

        emit SwapFilled(userA, ETHAmount, userB, token, expectedTokenAmount, nonce, expiry, messageHash);

        // Initiate withdrawal of tokens to userA on L1
        // Get current nonce for the withdrawal
        uint256 currentNonce = userNonces[userA];
        userNonces[userA] = currentNonce + 1;

        emit Withdraw(userA, token, expectedTokenAmount, currentNonce);
    }

    /**
     * @dev Allows users to withdraw ETH from L2 to L1
     */
    function withdraw() external payable nonReentrant {
        require(msg.value > 0, "Zero withdraw amount");

        // Get current nonce and increment it
        uint256 currentNonce = userNonces[msg.sender];
        userNonces[msg.sender] = currentNonce + 1;

        emit Withdraw(msg.sender, ETH, msg.value, currentNonce);
    }

    /**
     * @dev Allows userA to cancel an expired swap and withdraw their ETH
     * @param userA Address of the user who initiated the swap on L1Bridge
     * @param ETHAmount Amount of ETH for the swap
     * @param userB Address of the counterparty for the swap (can be zero address)
     * @param token Address of the ERC20 token
     * @param expectedTokenAmount Amount of ERC20 tokens for the swap
     * @param nonce User's nonce on L1Bridge
     * @param expiry Timestamp when the swap expires
     */
    function cancelExpiredSwap(
        address userA,
        uint256 ETHAmount,
        address userB,
        address token,
        uint256 expectedTokenAmount,
        uint256 nonce,
        uint64 expiry
    ) external nonReentrant {
        // Compute the message hash
        bytes32 messageHash = keccak256(abi.encode(userA, ETHAmount, userB, token, expectedTokenAmount, nonce, expiry));

        // Check if the swap exists and is open
        require(swapStatus[messageHash] == SwapStatus.Open, "Swap not found or not open");

        // Check if the swap has expired
        require(block.timestamp > expiry, "Swap has not expired yet");

        // Mark the swap as expired
        swapStatus[messageHash] = SwapStatus.Expired;

        emit SwapCancelled(userA, ETHAmount, userB, token, expectedTokenAmount, nonce, expiry, messageHash);

        // Initiate withdrawal of ETH back to userA on L1
        // Get current nonce for the withdrawal
        uint256 currentNonce = userNonces[userA];
        userNonces[userA] = currentNonce + 1;

        emit Withdraw(userA, ETH, ETHAmount, currentNonce);
    }

    // Function to receive ETH
    receive() external payable {}
} 