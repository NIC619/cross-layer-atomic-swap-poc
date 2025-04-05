// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "hardhat/console.sol";

contract L1Bridge is ReentrancyGuard {
    event Deposit(
        address indexed user,
        uint256 amount,
        uint256 nonce
    );

    event WithdrawalVerified(
        bytes32 indexed withdrawMessageHash
    );

    event WithdrawalClaimed(
        address indexed user,
        uint256 amount,
        uint256 nonce,
        bytes32 indexed withdrawMessageHash
    );

    // State variables
    mapping(address => uint256) public userNonces;
    mapping(bytes32 => bool) public verifiedWithdrawals;
    mapping(bytes32 => bool) public claimedWithdrawals;

    constructor() {}

    // Function to deposit
    function deposit() external payable nonReentrant {
        require(msg.value > 0, "Zero deposit amount");

        uint256 currentNonce = userNonces[msg.sender];
        userNonces[msg.sender] = currentNonce + 1;

        emit Deposit(msg.sender, msg.value, currentNonce);
    }

    // Function to prove and register withdrawals
    function prove(
        bytes calldata proof,
        bytes32[] calldata withdrawMessageHashes
    ) external {
        // Verify the proof
        require(verifyProof(proof, withdrawMessageHashes), "Invalid proof");

        // Register all withdraw message hashes as verified
        for (uint256 i = 0; i < withdrawMessageHashes.length; i++) {
            verifiedWithdrawals[withdrawMessageHashes[i]] = true;
            emit WithdrawalVerified(withdrawMessageHashes[i]);
        }
    }

    // Function to claim withdrawal
    function completeWithdraw(
        address user,
        uint256 amount,
        uint256 userL2Nonce,
        bytes32 withdrawMessageHash
    ) external nonReentrant {
        require(user != address(0), "Invalid user address");
        require(amount > 0, "Amount must be greater than 0");
        require(verifiedWithdrawals[withdrawMessageHash], "Withdrawal not verified");
        require(!claimedWithdrawals[withdrawMessageHash], "Withdrawal already claimed");

        // Verify the withdrawMessageHash matches the parameters
        bytes32 expectedHash = keccak256(abi.encode(user, amount, userL2Nonce));
        require(withdrawMessageHash == expectedHash, "Invalid withdrawal parameters");

        // Mark as claimed
        claimedWithdrawals[withdrawMessageHash] = true;

        // Transfer funds
        (bool success, ) = user.call{value: amount}("");
        require(success, "ETH transfer failed");

        emit WithdrawalClaimed(user, amount, userL2Nonce, withdrawMessageHash);
    }

    // Placeholder function for proof verification
    function verifyProof(
        bytes calldata proof,
        bytes32[] calldata withdrawMessageHashes
    ) internal pure returns (bool) {
        return true;
    }

    // Function to receive ETH
    receive() external payable {}
} 