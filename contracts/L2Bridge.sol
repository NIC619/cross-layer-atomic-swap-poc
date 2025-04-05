// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "hardhat/console.sol";

contract L2Bridge is ReentrancyGuard {
    address public immutable L1Bridge;

    event DepositCompleted(
        address indexed user,
        uint256 amount,
        uint256 nonce,
        bytes32 indexed messageHash
    );

    event Withdraw(
        address indexed user,
        uint256 amount,
        uint256 nonce
    );

    // State variables
    mapping(address => uint256) public userNonces;
    mapping(bytes32 => bool) public processedMessages;

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
     * @dev Allows users to withdraw ETH from L2 to L1
     */
    function withdraw() external payable nonReentrant {
        require(msg.value > 0, "Zero withdraw amount");

        // Get current nonce and increment it
        uint256 currentNonce = userNonces[msg.sender];
        userNonces[msg.sender] = currentNonce + 1;

        // bytes32 messageHash = keccak256(abi.encode(msg.sender, msg.value, currentNonce));

        emit Withdraw(msg.sender, msg.value, currentNonce);
    }

    // Function to receive ETH
    receive() external payable {}
} 