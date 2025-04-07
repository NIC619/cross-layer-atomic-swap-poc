import hre from "hardhat";
import { createPublicClient, createWalletClient, http, parseEther, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { L1Monitor } from "./monitor";
import { Sequencer } from "./sequencer";

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

    console.log("Deploying ERC20 Token...");
    const tokenDeployed = await hre.viem.deployContract("MockERC20", ["Mock Token", "MTK", 18], {
        client: { public: l2Client, wallet: sequencerL2WalletClient }
    });
    console.log("ERC20 Token deployed at:", tokenDeployed.address);

    const l1Bridge = await hre.viem.getContractAt("L1Bridge", l1BridgeDeployed.address, {
        client: { public: l2Client, wallet: userAWalletClient }
    });
    const l2Bridge = await hre.viem.getContractAt("L2Bridge", l2BridgeDeployed.address, {
        client: { public: l2Client, wallet: userBWalletClient }
    });
    const token = await hre.viem.getContractAt("MockERC20", tokenDeployed.address, {
        client: { public: l2Client, wallet: userBWalletClient }
    });
    return { l1Bridge, l2Bridge, token };
}

// Function to simulate a deposit
async function simulateDeposit(
    l1Client: any,
    l1Bridge: any,
    userA: any,
    amount: bigint
) {
    console.log("Simulating deposit...");
    console.log("UserA address:", userA.address);
    console.log("Deposit amount:", amount.toString());

    // Check user's balance
    const balance = await l1Client.getBalance({ address: userA.address });
    console.log("UserA balance before deposit:", balance.toString());

    // If balance is less than amount, set it
    if (balance < amount) {
        console.log("Setting user balance...");
        await l1Client.setBalance({
            address: userA.address,
            value: amount,
        });
        console.log("UserA balance set to:", amount.toString());
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
    console.log("UserA balance after deposit:", newBalance.toString());

    return receipt;
}

// Function to simulate a swap request
async function simulateRequestSwap(
    l1Client: any,
    l1Bridge: any,
    userA: any,
    ETHAmount: bigint,
    userB: string,
    token: string,
    expectedTokenAmount: bigint,
    expiry: number
) {
    console.log("Simulating swap request...");
    console.log("UserA address:", userA.address);
    console.log("Swap ETH amount:", ETHAmount.toString());
    console.log("UserB address:", userB);
    console.log("Token address:", token);
    console.log("Expected token amount:", expectedTokenAmount.toString());
    console.log("Swap expiry:", expiry);

    // Check user's balance
    const balance = await l1Client.getBalance({ address: userA.address });
    console.log("UserA balance before swap request:", balance.toString());

    // If balance is less than amount, set it
    if (balance < ETHAmount) {
        console.log("Setting user balance...");
        await l1Client.setBalance({
            address: userA.address,
            value: ETHAmount,
        });
        console.log("UserA balance set to:", ETHAmount.toString());
    }

    // Make the swap request
    console.log("Making swap request...");
    const hash = await l1Bridge.write.requestSwap([
        expiry,
        userB,
        token,
        expectedTokenAmount
    ], { value: ETHAmount });
    console.log("Swap request transaction hash:", hash);

    // Wait for the transaction to be mined
    const receipt = await l1Client.waitForTransactionReceipt({ hash });
    //   console.log("Swap request transaction receipt:", receipt);

    // Check user's balance after swap request
    const newBalance = await l1Client.getBalance({ address: userA.address });
    console.log("UserA balance after swap request:", newBalance.toString());

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
    console.log("Filling swap...");
    console.log("UserA address:", userA);
    console.log("UserB address:", userB.address);
    console.log("Swap ETH amount:", ETHAmount.toString());
    console.log("Token address:", token);
    console.log("Expected token amount:", expectedTokenAmount.toString());
    console.log("Swap nonce:", nonce);
    console.log("Swap expiry:", expiry);

    // Check userB's balance
    const balance = await l2Client.getBalance({ address: userB.address });
    console.log("UserB balance before fill:", balance.toString());

    // Make the fillSwap call
    console.log("Making fillSwap call...");
    const hash = await l2Bridge.write.fillSwap([
        userA,
        ETHAmount,
        userB.address,
        token,
        expectedTokenAmount,
        nonce,
        expiry,
    ]);
    console.log("FillSwap transaction hash:", hash);

    // Wait for the transaction to be mined
    const receipt = await l2Client.waitForTransactionReceipt({ hash });

    // Check userB's balance after fill
    const newBalance = await l2Client.getBalance({ address: userB.address });
    console.log("UserB balance after fill:", newBalance.toString());

    return receipt;
}

// Function to mint tokens to userB
async function mintTokensToUserB(
    l2Client: any,
    token: any,
    userB: any,
    amount: bigint
) {
    console.log("Minting tokens to userB...");
    console.log("UserB address:", userB.address);
    console.log("Token amount:", amount.toString());

    // Mint tokens to userB
    console.log("Minting tokens...");
    const hash = await token.write.mint([userB.address, amount]);
    console.log("Mint transaction hash:", hash);

    // Wait for the transaction to be mined
    const receipt = await l2Client.waitForTransactionReceipt({ hash });

    // Check userB's token balance
    const balance = await token.read.balanceOf([userB.address]);
    console.log("UserB token balance:", balance.toString());

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
        userA: requestSwapEvent.args?.userA || requestSwapEvent.userA,
        ETHAmount: requestSwapEvent.args?.ETHAmount || requestSwapEvent.ETHAmount,
        userB: requestSwapEvent.args?.userB || requestSwapEvent.userB,
        token: requestSwapEvent.args?.token || requestSwapEvent.token,
        expectedTokenAmount: requestSwapEvent.args?.expectedTokenAmount || requestSwapEvent.expectedTokenAmount,
        nonce: requestSwapEvent.args?.nonce || requestSwapEvent.nonce,
        expiry: requestSwapEvent.args?.expiry || requestSwapEvent.expiry,
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
    console.log("Approving token transfer to L2Bridge...");
    console.log("UserB address:", userB.address);
    console.log("L2Bridge address:", l2Bridge.address);
    console.log("Token amount:", amount.toString());

    // Check current allowance
    const currentAllowance = await token.read.allowance([userB.address, l2Bridge.address]);
    console.log("Current allowance:", currentAllowance.toString());

    // If allowance is less than amount, approve
    if (currentAllowance < amount) {
        console.log("Approving token transfer...");
        const hash = await token.write.approve([l2Bridge.address, amount]);
        console.log("Approve transaction hash:", hash);

        // Wait for the transaction to be mined
        const receipt = await l2Client.waitForTransactionReceipt({ hash });

        // Check new allowance
        const newAllowance = await token.read.allowance([userB.address, l2Bridge.address]);
        console.log("New allowance:", newAllowance.toString());

        return receipt;
    } else {
        console.log("Sufficient allowance already exists");
        return null;
    }
}

// Main function
async function main() {
    // Deploy contracts
    const { l1Bridge, l2Bridge, token } = await deployContracts();

    // Create monitors and sequencer
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
    const depositAmount = parseEther("1.0");
    const depositReceipt = await simulateDeposit(
        l1Client,
        l1Bridge,
        userAAccount,
        depositAmount
    );

    // Wait for the deposit to be processed
    console.log("Waiting for deposit to be processed...");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Mint tokens to userB
    const tokenAmount = parseEther("1000"); // Mint 1000 tokens to userB
    const mintReceipt = await mintTokensToUserB(
        l2Client,
        token,
        userBAccount,
        tokenAmount
    );

    // Simulate a swap request
    const swapETHAmount = parseEther("0.5");
    const userBAddress = userBAccount.address; // Use userB's address for the swap
    const tokenAddress = token.address; // Use the deployed token address
    const expectedTokenAmount = parseEther("100"); // Example token amount
    const expiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const swapReceipt = await simulateRequestSwap(
        l1Client,
        l1Bridge,
        userAAccount,
        swapETHAmount,
        userBAddress,
        tokenAddress,
        expectedTokenAmount,
        expiry
    );

    // Wait for the swap request to be processed by the sequencer
    console.log("Waiting for swap request to be processed by sequencer...");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Parse the RequestSwap event from the transaction receipt
    const swapParams = await parseRequestSwapEvent(l1Client, l1Bridge, swapReceipt);
    console.log("Swap parameters from event:", swapParams);

    // Approve token transfer to L2Bridge
    const approveReceipt = await approveTokenTransfer(
        l2Client,
        token,
        userBAccount,
        l2Bridge,
        swapParams.expectedTokenAmount
    );

    // Fill the swap with userB using parameters from the event
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

    // Stop monitoring and sequencer
    console.log("Stopping L1Monitor...");
    l1Monitor.stopMonitoring();
    console.log("Stopping Sequencer...");
    sequencer.stop();
}

main().catch((error) => {
    console.error("Error in main function:", error);
    process.exit(1);
});
