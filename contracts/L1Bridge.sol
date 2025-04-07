// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "hardhat/console.sol";

interface IMintableERC20 {
    function mint(address to, uint256 amount) external;
}

contract L1Bridge is ReentrancyGuard {
    address public constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    event Deposit(
        address indexed user,
        uint256 amount,
        uint256 nonce
    );

    event RequestSwap(
        address indexed userA,
        uint256 ETHAmount,
        address indexed userB,
        address indexed token,
        uint256 expectedTokenAmount,
        uint256 nonce,
        uint64 expiry
    );

    event WithdrawalVerified(
        bytes32 indexed withdrawMessageHash
    );

    event WithdrawalClaimed(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 nonce,
        bytes32 indexed withdrawMessageHash
    );

    // State variables
    mapping(address => uint256) public userNonces;
    mapping(bytes32 => bool) public verifiedWithdrawals;
    mapping(bytes32 => bool) public claimedWithdrawals;

    // Function to deposit
    function deposit() external payable nonReentrant {
        require(msg.value > 0, "Zero deposit amount");

        uint256 currentNonce = userNonces[msg.sender];
        userNonces[msg.sender] = currentNonce + 1;

        emit Deposit(msg.sender, msg.value, currentNonce);
    }

    // Function to request an atomic swap
    function requestSwap(
        uint64 expiry,
        address userB,
        address token,
        uint256 expectedTokenAmount
    ) external payable nonReentrant {
        console.log("Expiry", expiry);
        console.log("Current time", block.timestamp);
        require(msg.value > 0, "Zero swap amount");
        require(expiry > block.timestamp, "Expiry must be in the future");
        require(token != address(0), "Invalid token address");
        require(expectedTokenAmount > 0, "Zero token amount");
        require(userB != msg.sender, "Cannot swap with yourself");

        uint256 currentNonce = userNonces[msg.sender];
        userNonces[msg.sender] = currentNonce + 1;

        emit RequestSwap(msg.sender, msg.value, userB, token, expectedTokenAmount, currentNonce, expiry);
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
        address token,
        uint256 amount,
        uint256 userL2Nonce,
        bytes32 withdrawMessageHash
    ) external nonReentrant {
        require(verifiedWithdrawals[withdrawMessageHash], "Withdrawal not verified");
        require(!claimedWithdrawals[withdrawMessageHash], "Withdrawal already claimed");

        // Verify the withdrawMessageHash matches the parameters
        bytes32 expectedHash = keccak256(abi.encode(user, token, amount, userL2Nonce));
        require(withdrawMessageHash == expectedHash, "Invalid withdrawal parameters");

        // Mark as claimed
        claimedWithdrawals[withdrawMessageHash] = true;

        // Transfer funds
        if (token == ETH) {
            // ETH withdrawal
            (bool success, ) = user.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            // Assume tokens are L2 native, use `mint` instead of `transfer`
            IMintableERC20(token).mint(user, amount);
        }

        emit WithdrawalClaimed(user, token, amount, userL2Nonce, withdrawMessageHash);
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