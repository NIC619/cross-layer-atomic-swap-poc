import hre from "hardhat";
import { createPublicClient, createWalletClient, http, parseEther, parseEventLogs, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { L1Monitor } from "./monitor";
import { Sequencer } from "./sequencer";
import { printStep, printSuccess, printError, printWarning } from "./utils";

// Create a public client for L1
const l1Client = createPublicClient({
    chain: foundry,
    transport: http("http://127.0.0.1:8545"),
});

// Create a public client for L2
const l2Client = createPublicClient({
    chain: foundry,
    transport: http("http://127.0.0.1:8546"),
});

// Create a wallet client for the user
const userAAccount = privateKeyToAccount(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
);
const userAWalletClient = createWalletClient({
    account: userAAccount,
    chain: foundry,
    transport: http("http://127.0.0.1:8545"),
});

// Create a wallet client for userB on L2
const userBAccount = privateKeyToAccount(
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
);
const userBWalletClient = createWalletClient({
    account: userBAccount,
    chain: foundry,
    transport: http("http://127.0.0.1:8546"),
});

// Create a wallet client for the sequencer
const sequencerAccount = privateKeyToAccount(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
);
const sequencerL1WalletClient = createWalletClient({
    account: sequencerAccount,
    chain: foundry,
    transport: http("http://127.0.0.1:8545"),
});
const sequencerL2WalletClient = createWalletClient({
    account: sequencerAccount,
    chain: foundry,
    transport: http("http://127.0.0.1:8546"),
});

// Create a wallet client for the token contract deployer.
// We use a different account to deploy token so it can be deployed to the same address on L1 and L2 across different runs.
const tokenDeployerAccount = privateKeyToAccount(
    "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e"
);
const tokenDeployerL1WalletClient = createWalletClient({
    account: tokenDeployerAccount,
    chain: foundry,
    transport: http("http://127.0.0.1:8545"),
});
const tokenDeployerL2WalletClient = createWalletClient({
    account: tokenDeployerAccount,
    chain: foundry,
    transport: http("http://127.0.0.1:8546"),
});

// Function to deploy contracts
async function deployContracts() {
    
    console.log("Deploying L1Bridge...");
    const l1BridgeDeployed = await hre.viem.deployContract("L1Bridge", [], {
        client: { public: l1Client, wallet: sequencerL1WalletClient }
    });
    console.log("L1Bridge deployed at:", l1BridgeDeployed.address);

    console.log("Deploying L2Bridge...");
    const l2BridgeDeployed = await hre.viem.deployContract("L2Bridge", [
        l1BridgeDeployed.address,
        sequencerAccount.address
    ], {
        client: { public: l2Client, wallet: sequencerL2WalletClient }
    });
    console.log("L2Bridge deployed at:", l2BridgeDeployed.address);

    console.log("Deploying ERC20 Token to L1...");
    const l1TokenDeployed = await hre.viem.deployContract("MockERC20", ["Mock Token", "MTK", 18], {
        client: { public: l1Client, wallet: tokenDeployerL1WalletClient }
    });
    console.log("ERC20 Token on L1 deployed at:", l1TokenDeployed.address);
    console.log("Deploying ERC20 Token to L2...");
    const l2TokenDeployed = await hre.viem.deployContract("MockERC20", ["Mock Token", "MTK", 18], {
        client: { public: l2Client, wallet: tokenDeployerL2WalletClient }
    });
    console.log("ERC20 Token on L2 deployed at:", l2TokenDeployed.address);
    // We assume the tokens are deployed on the same address on L1 and L2 so it's easier to be exchanged.
    // Otherwise we need a deterministic mapping between L1 and L2 tokens.
    if (l1TokenDeployed.address !== l2TokenDeployed.address) {
        throw new Error("L1 and L2 token addresses do not match");
    }

    const l1Bridge = await hre.viem.getContractAt("L1Bridge", l1BridgeDeployed.address, {
        client: { public: l2Client, wallet: userAWalletClient }
    });
    const l2Bridge = await hre.viem.getContractAt("L2Bridge", l2BridgeDeployed.address, {
        client: { public: l2Client, wallet: userBWalletClient }
    });
    const l1Token = await hre.viem.getContractAt("MockERC20", l1TokenDeployed.address, {
        client: { public: l2Client, wallet: userBWalletClient }
    });
    const l2Token = await hre.viem.getContractAt("MockERC20", l2TokenDeployed.address, {
        client: { public: l2Client, wallet: userBWalletClient }
    });
    return { l1Bridge, l2Bridge, l1Token, l2Token };
}

// Function to simulate a deposit
async function simulateDeposit(
    l1Client: any,
    l1Bridge: any,
    userA: any,
    amount: bigint
) {
    console.log("Simulating userA deposit...");
    console.log("UserA address:", userA.address);
    console.log("Deposit amount:", formatEther(amount), "ETH");

    // Check user's balance
    const balance = await l1Client.getBalance({ address: userA.address });
    console.log("UserA balance before deposit:", formatEther(balance), "ETH");

    // If balance is less than amount, set it
    if (balance < amount) {
        console.log("Setting user balance...");
        await l1Client.setBalance({
            address: userA.address,
            value: amount,
        });
        console.log("UserA balance set to:", formatEther(amount), "ETH");
    }

    // Make the deposit
    console.log("Making deposit...");
    const hash = await l1Bridge.write.deposit([], { value: amount });
    console.log("Deposit transaction hash:", hash);

    // Wait for the transaction to be mined
    const receipt = await l1Client.waitForTransactionReceipt({ hash });
    //   console.log("Deposit transaction receipt:", receipt);

    // Check user's balance after deposit
    const newBalance = await l1Client.getBalance({ address: userA.address });
    console.log("UserA balance after deposit:", formatEther(newBalance), "ETH");

    return receipt;
}

// Function to simulate a swap request
async function simulateRequestSwap(
    l1Client: any,
    l2Client: any,
    l1Bridge: any,
    userA: any,
    ETHAmount: bigint,
    userBAddress: string,
    tokenAddress: string,
    expectedTokenAmount: bigint,
    expiry: number
) {
    console.log("Simulating swap request...");
    console.log("UserA address:", userA.address);
    console.log("Swap ETH amount:", formatEther(ETHAmount), "ETH");
    console.log("UserB address:", userBAddress);
    console.log("Token address:", tokenAddress);
    console.log("Expected token amount:", formatEther(expectedTokenAmount), "tokens");
    console.log("Swap expiry:", expiry);

    const hash = await l1Bridge.write.requestSwap([
        expiry,
        userBAddress,
        tokenAddress,
        expectedTokenAmount
    ], { value: ETHAmount });
    // Wait for the transaction to be mined
    const receipt = await l1Client.waitForTransactionReceipt({ hash });

    return receipt;
}

// Function to fill a swap
async function fillSwap(
    l2Client: any,
    l2Bridge: any,
    userB: any,
    userA: string,
    ETHAmount: bigint,
    token: string,
    expectedTokenAmount: bigint,
    nonce: number,
    expiry: number
) {
    console.log("UserB filling swap...");

    // Check userB's balance
    const balance = await l2Client.getBalance({ address: userB.address });
    console.log("UserB L2 ETH balance before fill:", formatEther(balance), "ETH");

    // Make the fillSwap call
    const hash = await l2Bridge.write.fillSwap([
        userA,
        ETHAmount,
        userB.address,
        token,
        expectedTokenAmount,
        nonce,
        expiry,
    ]);
    // Wait for the transaction to be mined
    const receipt = await l2Client.waitForTransactionReceipt({ hash });

    // Check userB's balance after fill
    const newBalance = await l2Client.getBalance({ address: userB.address });
    console.log("UserB L2 ETH balance after fill:", formatEther(newBalance), "ETH");

    return receipt;
}

// Function to mint tokens to userB
async function mintTokensToUserB(
    l2Client: any,
    token: any,
    userB: any,
    amount: bigint
) {
    console.log("Minting tokens to userB to prepare for swap...");
    console.log("UserB address:", userB.address);
    console.log("Token amount to mint:", formatEther(amount), "tokens");

    // Mint tokens to userB
    const hash = await token.write.mint([userB.address, amount]);

    // Wait for the transaction to be mined
    const receipt = await l2Client.waitForTransactionReceipt({ hash });

    return receipt;
}

// Function to parse the RequestSwap event from a transaction receipt
async function parseRequestSwapEvent(
    l1Client: any,
    l1Bridge: any,
    receipt: any
) {
    console.log("Parsing RequestSwap event from transaction receipt...");
    
    // Use parseEventLogs to find and decode the RequestSwap event
    const parsedLogs = parseEventLogs({
        abi: l1Bridge.abi,
        eventName: 'RequestSwap',
        logs: receipt.logs,
    });
    
    if (parsedLogs.length === 0) {
        throw new Error("RequestSwap event not found in transaction logs");
    }
    
    // Get the first RequestSwap event
    const requestSwapEvent = parsedLogs[0] as any;
    
    // Extract the event parameters
    return {
        userA: requestSwapEvent.args?.userA,
        ETHAmount: requestSwapEvent.args?.ETHAmount,
        userB: requestSwapEvent.args?.userB,
        token: requestSwapEvent.args?.token,
        expectedTokenAmount: requestSwapEvent.args?.expectedTokenAmount,
        nonce: requestSwapEvent.args?.nonce,
        expiry: requestSwapEvent.args?.expiry,
    };
}

// Function to approve token transfer to L2Bridge
async function approveTokenTransfer(
    l2Client: any,
    token: any,
    userB: any,
    l2Bridge: any,
    amount: bigint
) {
    console.log("UserB approving token to L2Bridge...");
    const hash = await token.write.approve([l2Bridge.address, amount]);
    // Wait for the transaction to be mined
    const receipt = await l2Client.waitForTransactionReceipt({ hash });
    return receipt;
}

// Function to complete withdrawal on L1
async function completeWithdraw(
    l1Client: any,
    l1Bridge: any,
    userA: any,
    token: string,
    amount: bigint,
    userL2Nonce: number,
    withdrawMessageHash: `0x${string}`
) {
    console.log("Completing withdrawal on L1...");

    // Get initial token balance
    let initialBalance: bigint;
    if (token.toLowerCase() === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE".toLowerCase()) {
        // ETH withdrawal
        initialBalance = await l1Client.getBalance({ address: userA.address });
        console.log("UserA ETH balance before withdrawal:", formatEther(initialBalance), "ETH");
    } else {
        // ERC20 token withdrawal
        const tokenContract = await hre.viem.getContractAt("MockERC20", token as `0x${string}`, {
            client: { public: l1Client, wallet: userAWalletClient }
        });
        const balanceResult = await tokenContract.read.balanceOf([userA.address]);
        initialBalance = BigInt(balanceResult.toString());
        console.log("UserA token balance before withdrawal:", formatEther(initialBalance), "tokens");
    }

    // Complete the withdrawal
    const hash = await l1Bridge.write.completeWithdraw([
        userA.address,
        token,
        amount,
        userL2Nonce,
        withdrawMessageHash
    ]);
    await l1Client.waitForTransactionReceipt({ hash });

    // Get final token balance
    let finalBalance: bigint;
    if (token === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE") {
        // ETH withdrawal
        finalBalance = await l1Client.getBalance({ address: userA.address });
        console.log("UserA ETH balance after withdrawal:", formatEther(finalBalance), "ETH");
    } else {
        // ERC20 token withdrawal
        const tokenContract = await hre.viem.getContractAt("MockERC20", token, {
            client: { public: l1Client, wallet: userAWalletClient }
        });
        const balanceResult = await tokenContract.read.balanceOf([userA.address]);
        finalBalance = BigInt(balanceResult.toString());
        console.log("UserA token balance after withdrawal:", formatEther(finalBalance), "tokens");
    }

    return hash;
}

// Function to parse the Withdraw event and calculate the message hash
async function parseWithdrawMessageHash(
    l2Bridge: any,
    fillReceipt: any
) {
    console.log("Parsing Withdraw event from fill transaction receipt...");
    
    // Parse the Withdraw event from the fill transaction receipt
    const withdrawLogs = parseEventLogs({
        abi: l2Bridge.abi,
        eventName: 'Withdraw',
        logs: fillReceipt.logs,
    });
    
    if (withdrawLogs.length === 0) {
        throw new Error("Withdraw event not found in transaction logs");
    }
    
    const withdrawEvent = withdrawLogs[0] as any;
    const withdrawParams = {
        user: withdrawEvent.args?.user,
        token: withdrawEvent.args?.token,
        amount: withdrawEvent.args?.amount,
        nonce: withdrawEvent.args?.nonce,
    };

    // Calculate the withdraw message hash
    const { keccak256, encodeAbiParameters, parseAbiParameters } = await import('viem');
    const encodedParams = encodeAbiParameters(
        parseAbiParameters("address, address, uint256, uint256"),
        [withdrawParams.user, withdrawParams.token, withdrawParams.amount, withdrawParams.nonce]
    );
    const withdrawMessageHash = keccak256(encodedParams) as `0x${string}`;

    return {
        withdrawParams,
        withdrawMessageHash
    };
}

// Function to prove the withdrawal message hash on L1
async function proveWithdrawMessageHash(
    l1Client: any,
    l1Bridge: any,
    withdrawMessageHash: `0x${string}`
) {
    console.log("Proving withdrawal message hash on L1...");

    // Prove the withdrawal message hash
    const proveHash = await l1Bridge.write.prove(["0x" as `0x${string}`, [withdrawMessageHash]]);
    await l1Client.waitForTransactionReceipt({ hash: proveHash });

    return proveHash;
}

// Main function
async function main() {
    // Deploy contracts
    printStep("DEPLOYING CONTRACTS");
    const { l1Bridge, l2Bridge, l2Token } = await deployContracts();

    // Create monitors and sequencer
    printStep("INITIALIZING MONITORS AND SEQUENCER");
    const l1Monitor = new L1Monitor(l1Client, l1Bridge.address);
    const sequencer = new Sequencer(
        l2Client,
        l2Bridge.address,
        sequencerL2WalletClient,
        l1Monitor
    );

    // Start monitoring and sequencer
    console.log("Starting L1Monitor...");
    await l1Monitor.startMonitoring();
    console.log("Starting Sequencer...");
    await sequencer.start();

    // Simulate a deposit
    printStep("STEP 1: DEPOSIT ETH");
    printStep("STEP 1.a: USER A DEPOSITS ETH TO L1");
    const depositAmount = parseEther("1.0");
    const depositReceipt = await simulateDeposit(
        l1Client,
        l1Bridge,
        userAAccount,
        depositAmount
    );

    // Wait for the deposit to be processed
    printStep("STEP 1.b: WAITING FOR DEPOSIT TO BE PROCESSED ON L2");
    console.log("Waiting for deposit to be processed...");
    await new Promise((resolve) => setTimeout(resolve, 6000));

    // Simulate a swap request
    printStep("STEP 2: SWAP");
    printStep("STEP 2.a: USER A REQUESTS SWAP");
    const swapETHAmount = parseEther("0.5");
    const userBAddress = userBAccount.address; // Use userB's address for the swap
    const tokenAddress = l2Token.address; // Use the deployed token address
    const expectedTokenAmount = parseEther("100"); // Example token amount
    const expiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const swapReceipt = await simulateRequestSwap(
        l1Client,
        l2Client,
        l1Bridge,
        userAAccount,
        swapETHAmount,
        userBAddress,
        tokenAddress,
        expectedTokenAmount,
        expiry
    );

    // Wait for the swap request to be processed by the sequencer
    printStep("STEP 2.b: WAITING FOR SWAP REQUEST TO BE PROCESSED");
    console.log("Waiting for swap request to be processed by sequencer...");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Parse the RequestSwap event from the transaction receipt
    printStep("STEP 2.c: PARSING SWAP REQUEST EVENT");
    const swapParams = await parseRequestSwapEvent(l1Client, l1Bridge, swapReceipt);

    // Mint tokens to userB
    printStep("STEP 2.d: PREPARING FOR SWAP AND MINTING TOKENS TO USER B");
    const tokenAmount = parseEther("1000"); // Mint 1000 tokens to userB
    const mintReceipt = await mintTokensToUserB(
        l2Client,
        l2Token,
        userBAccount,
        tokenAmount
    );
    // Approve token transfer to L2Bridge
    printStep("STEP 2.e: USER B APPROVES TOKEN TRANSFER");
    const approveReceipt = await approveTokenTransfer(
        l2Client,
        l2Token,
        userBAccount,
        l2Bridge,
        swapParams.expectedTokenAmount
    );

    // Fill the swap with userB using parameters from the event
    printStep("STEP 2.f: USER B FILLS THE SWAP");
    const fillReceipt = await fillSwap(
        l2Client,
        l2Bridge,
        userBAccount,
        swapParams.userA,
        swapParams.ETHAmount,
        swapParams.token,
        swapParams.expectedTokenAmount,
        swapParams.nonce,
        swapParams.expiry
    );

    // Parse the Withdraw event and calculate the message hash
    printStep("STEP 3: USER A RECEIVES TOKEN");
    printStep("STEP 3.a: PROVING WITHDRAWAL ON L1");
    const { withdrawParams, withdrawMessageHash } = await parseWithdrawMessageHash(l2Bridge, fillReceipt);
    // Prove the withdrawal message hash on L1
    const proveHash = await proveWithdrawMessageHash(l1Client, l1Bridge, withdrawMessageHash);

    // Complete the withdrawal on L1
    printStep("STEP 3.b: COMPLETING WITHDRAWAL ON L1");
    const completeWithdrawReceipt = await completeWithdraw(
        l1Client,
        l1Bridge,
        userAAccount,
        withdrawParams.token,
        withdrawParams.amount,
        Number(withdrawParams.nonce),
        withdrawMessageHash
    );

    // Stop monitoring and sequencer
    printStep("COMPLETED. YOU CAN EXIT NOW.");
    console.log("Stopping L1Monitor...");
    l1Monitor.stopMonitoring();
    console.log("Stopping Sequencer...");
    sequencer.stop();
    
    // Exit the process after a short delay to allow for cleanup
    printSuccess("Cross-layer atomic swap completed successfully!");
    printWarning("Exiting in 1.5 seconds...");
    await new Promise(resolve => setTimeout(resolve, 1500));
    process.exit(0);
}

main().catch((error) => {
    printError("Error in main function: " + error);
    process.exit(1);
});
