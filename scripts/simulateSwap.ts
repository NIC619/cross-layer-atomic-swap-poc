import hre from "hardhat";
import { loadFixture, impersonateAccount, stopImpersonatingAccount, setBalance } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { parseEther, keccak256, encodeAbiParameters, parseAbiParameters, createPublicClient, http, createWalletClient, Log, decodeEventLog } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

// Types for our simulation
interface Deposit {
    user: string;
    amount: bigint;
    nonce: bigint;
    messageHash: `0x${string}`;
}

interface DepositEvent {
    eventName: 'Deposit';
    args: {
        user: string;
        amount: bigint;
        nonce: bigint;
    };
}

class L1Monitor {
    private deposits: Deposit[] = [];
    private l1Bridge: any;
    private publicClient: any;
    private unwatch: (() => void) | null = null;

    constructor(l1Bridge: any, publicClient: any) {
        this.l1Bridge = l1Bridge;
        this.publicClient = publicClient;
    }

    async startMonitoring() {
        console.log("L1Monitor: Starting to monitor L1 deposits...");
        console.log("L1Monitor: Watching address:", this.l1Bridge.address);
        
        // Watch for Deposit events using the public client
        this.unwatch = this.publicClient.watchContractEvent({
            address: this.l1Bridge.address,
            abi: this.l1Bridge.abi,
            eventName: 'Deposit',
            onLogs: async (logs: Log[]) => {
                for (const log of logs) {
                    const decodedLog = decodeEventLog({
                        abi: this.l1Bridge.abi,
                        data: log.data,
                        topics: log.topics,
                    }) as DepositEvent;
                    
                    const deposit: Deposit = {
                        user: decodedLog.args.user,
                        amount: decodedLog.args.amount,
                        nonce: decodedLog.args.nonce,
                        messageHash: keccak256(
                            encodeAbiParameters(
                                parseAbiParameters("address, uint256, uint256"),
                                [decodedLog.args.user as `0x${string}`, decodedLog.args.amount, decodedLog.args.nonce]
                            )
                        ) as `0x${string}`
                    };
                    this.deposits.push(deposit);
                    console.log(`L1Monitor: New deposit detected - User: ${deposit.user}, Amount: ${deposit.amount}, Nonce: ${deposit.nonce}`);
                }
            }
        });
        console.log("L1Monitor: Event watching started");
    }

    stopMonitoring() {
        if (this.unwatch) {
            this.unwatch();
            this.unwatch = null;
        }
    }

    getPendingDeposits(): Deposit[] {
        return this.deposits;
    }

    clearDeposits() {
        this.deposits = [];
    }
}

class Sequencer {
    private l2Bridge: any;
    private l1Bridge: any;
    private l1Monitor: L1Monitor;
    private publicClient: any;
    private isRunning: boolean = false;
    private intervalId: NodeJS.Timeout | null = null;

    constructor(l2Bridge: any, l1Bridge: any, l1Monitor: L1Monitor, publicClient: any) {
        this.l2Bridge = l2Bridge;
        this.l1Bridge = l1Bridge;
        this.l1Monitor = l1Monitor;
        this.publicClient = publicClient;
    }

    async start() {
        this.isRunning = true;
        console.log("Sequencer: Starting to produce L2 blocks...");
        
        // Run the sequencer in the background using setInterval
        this.intervalId = setInterval(async () => {
            if (!this.isRunning) {
                if (this.intervalId) {
                    clearInterval(this.intervalId);
                    this.intervalId = null;
                }
                return;
            }
            await this.produceBlock();
        }, 1000); // Run every 1 second
    }

    stop() {
        this.isRunning = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        console.log("Sequencer: Stopping block production...");
    }

    private async produceBlock() {
        const pendingDeposits = this.l1Monitor.getPendingDeposits();
        if (pendingDeposits.length === 0) {
            console.log("Sequencer: No pending deposits to process");
            return;
        }

        console.log(`Sequencer: Processing ${pendingDeposits.length} deposits in new block`);

        // Process each deposit
        for (const deposit of pendingDeposits) {
            try {
                const hash = await this.l2Bridge.write.completeDeposit([
                    deposit.user,
                    deposit.amount,
                    deposit.nonce
                ], { value: deposit.amount });

                const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
                // Check for DepositCompleted event in the receipt
                const depositCompletedEvent = receipt.logs.find((log: Log) => {
                    try {
                        const decodedLog = decodeEventLog({
                            abi: this.l2Bridge.abi,
                            data: log.data,
                            topics: log.topics,
                        }) as { eventName: string };
                        return decodedLog.eventName === 'DepositCompleted';
                    } catch (error) {
                        return false;
                    }
                });

                if (depositCompletedEvent) {
                    console.log(`Sequencer: DepositCompleted event found for user ${deposit.user}`);
                } else {
                    console.warn(`Sequencer: No DepositCompleted event found for user ${deposit.user}`);
                }
            } catch (error) {
                console.error(`Sequencer: Error processing deposit for user ${deposit.user}:`, error);
            }
        }

        // Clear processed deposits
        this.l1Monitor.clearDeposits();
    }
}

async function deployContracts(
    l1Client: any,
    l2Client: any,
    l1Wallet: any,
    l2Wallet: any
): Promise<{ l1Bridge: any; l2Bridge: any }> {
    // Deploy L1Bridge to L1 network
    console.log("Deploying L1Bridge to L1 network...");
    const l1Bridge = await hre.viem.deployContract("L1Bridge", [], {
        client: { public: l1Client, wallet: l1Wallet }
    });

    // Verify L1Bridge deployment
    const l1BridgeCode = await l1Client.getCode({ address: l1Bridge.address });
    if (l1BridgeCode !== undefined) {
        console.log("L1Bridge deployed at:", l1Bridge.address);
    } else {
        console.log("L1Bridge deployment failed");
        process.exit(1);
    }

    // Deploy L2Bridge to L2 network
    console.log("\nDeploying L2Bridge to L2 network...");
    const l2Bridge = await hre.viem.deployContract("L2Bridge", [l1Bridge.address], {
        client: { public: l2Client, wallet: l2Wallet }
    });

    // Verify L2Bridge deployment
    const l2BridgeCode = await l2Client.getCode({ address: l2Bridge.address });
    if (l2BridgeCode !== undefined) {
        console.log("L2Bridge deployed at:", l2Bridge.address);
    } else {
        console.log("L2Bridge deployment failed");
        process.exit(1);
    }

    return { l1Bridge, l2Bridge };
}

async function simulateDeposit(
    l1Client: any,
    l1Bridge: any,
    user: any,
    depositAmount: bigint
) {
    // Create a new wallet client for the user account
    const userWallet = createWalletClient({
        account: user,
        chain: foundry,
        transport: http("http://localhost:8545")
    });

    // Check user's balance
    const userBalance = await l1Client.getBalance({ address: user.address });
    // Set user's balance if needed
    if (userBalance < depositAmount) {
        console.log("Setting user balance...");
        await setBalance(user.address, parseEther("10.0"));
        const newBalance = await l1Client.getBalance({ address: user.address });
        console.log("User balance after setting:", newBalance);
    }

    // Make a deposit using the user's wallet client
    try {
        const depositHash = await userWallet.writeContract({
            address: l1Bridge.address,
            abi: l1Bridge.abi,
            functionName: 'deposit',
            args: [],
            value: depositAmount,
            account: user
        });

        const receipt = await l1Client.waitForTransactionReceipt({ hash: depositHash });
        console.log(`Made deposit of ${depositAmount} from ${user.address}`);
    } catch (error) {
        console.error("Error making deposit:", error);
    }
}

async function main() {
    // Create clients for L1 and L2 networks
    const l1Client = createPublicClient({
        chain: foundry,
        transport: http("http://localhost:8545")
    });

    const l2Client = createPublicClient({
        chain: foundry,
        transport: http("http://localhost:8546")
    });

    // Create accounts for deployment
    const l1Deployer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"); // Account #0 on local testnet
    const l2Deployer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"); // Account #1 on local testnet
    const user = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"); // Account #2 on local testnet

    // Create wallet clients
    const l1Wallet = createWalletClient({
        account: l1Deployer,
        chain: foundry,
        transport: http("http://localhost:8545")
    });

    const l2Wallet = createWalletClient({
        account: l2Deployer,
        chain: foundry,
        transport: http("http://localhost:8546")
    });

    // Deploy contracts
    const { l1Bridge, l2Bridge } = await deployContracts(l1Client, l2Client, l1Wallet, l2Wallet);

    // Initialize monitor and sequencer
    const l1Monitor = new L1Monitor(l1Bridge, l1Client);
    const sequencer = new Sequencer(l2Bridge, l1Bridge, l1Monitor, l2Client);

    // Start monitoring and sequencer
    console.log("\nStarting monitoring and sequencer...");
    await l1Monitor.startMonitoring();
    await sequencer.start(); // This will now run in the background

    // Simulate some deposits
    console.log("\nPreparing to make deposit...");
    const depositAmount = parseEther("1.0");
    await simulateDeposit(l1Client, l1Bridge, user, depositAmount);

    // Wait for processing
    console.log("\nWaiting for processing...");
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Stop the simulation
    console.log("\nStopping simulation...");
    l1Monitor.stopMonitoring();
    sequencer.stop();
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
