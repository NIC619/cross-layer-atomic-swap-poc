import hre from "hardhat";
import { PublicClient, WalletClient, Log, decodeEventLog, keccak256, encodeAbiParameters, parseAbiParameters } from "viem";
import { L1Monitor, Deposit, Swap } from "./monitor";
import { printDim } from "./utils";

interface DepositCompletedEvent {
    eventName: 'DepositCompleted';
    args: {
        user: string;
        amount: bigint;
        nonce: bigint;
        messageHash: string;
    };
}

interface RequestSwapCompletedEvent {
    eventName: 'RequestSwapCompleted';
    args: {
        userA: string;
        ETHAmount: bigint;
        userB: string;
        token: string;
        expectedTokenAmount: bigint;
        nonce: bigint;
        expiry: number;
        messageHash: string;
    };
}

interface SwapFilledEvent {
    eventName: 'SwapFilled';
    args: {
        userA: string;
        ETHAmount: bigint;
        userB: string;
        token: string;
        expectedTokenAmount: bigint;
        nonce: bigint;
        expiry: number;
        messageHash: string;
    };
}

interface SwapCancelledEvent {
    eventName: 'SwapCancelled';
    args: {
        userA: string;
        ETHAmount: bigint;
        userB: string;
        token: string;
        expectedTokenAmount: bigint;
        nonce: bigint;
        expiry: number;
        messageHash: string;
    };
}

export class Sequencer {
    /** L2Bridge contract instance */
    private l2Bridge: any;
    private l2Client: PublicClient;
    private l2BridgeAddress: `0x${string}`;
    private l1Monitor: L1Monitor;
    private intervalId: NodeJS.Timeout | null = null;

    constructor(
        l2Client: PublicClient,
        l2BridgeAddress: `0x${string}`,
        private walletClient: WalletClient,
        l1Monitor: L1Monitor
    ) {
        if (!walletClient.account) {
            throw new Error("Wallet client must have an account");
        }
        this.l2Client = l2Client;
        this.l2BridgeAddress = l2BridgeAddress;
        this.l2Bridge = null;
        this.l1Monitor = l1Monitor;
    }

    async initialize() {
        this.l2Bridge = await hre.viem.getContractAt("L2Bridge", this.l2BridgeAddress, {
            client: { 
                public: this.l2Client, 
                wallet: {
                    ...this.walletClient,
                    account: this.walletClient.account
                }
            }
        }) as any;
    }

    async start() {
        if (!this.l2Bridge) {
            await this.initialize();
        }
        printDim("Sequencer: Starting block production...");
        // Run block production every second
        this.intervalId = setInterval(() => this.produceBlock(), 1000);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            printDim("Sequencer: Stopped block production");
        }
    }

    private async produceBlock() {
        // Process deposits
        const pendingDeposits = this.l1Monitor.getPendingDeposits();

        if (pendingDeposits.length > 0) {
            printDim(`Sequencer: Processing ${pendingDeposits.length} deposits in new block`);

            // Process each deposit
            for (const deposit of pendingDeposits) {
                try {
                    // Compute the message hash
                    const messageHash = keccak256(
                        encodeAbiParameters(
                            parseAbiParameters("address, uint256, uint256"),
                            [deposit.user, deposit.amount, deposit.nonce]
                        )
                    );

                    // Get domain for EIP-712 signature
                    const domain = {
                        name: "L2Bridge",
                        version: "1.0.0",
                        chainId: await this.l2Client.getChainId(),
                        verifyingContract: this.l2BridgeAddress
                    };

                    // Define types for EIP-712 signature
                    const types = {
                        Preconfirm: [
                            { name: "messageHash", type: "bytes32" }
                        ]
                    };

                    // Sign the message hash
                    const signature = await this.walletClient.signTypedData({
                        account: this.walletClient.account,
                        domain,
                        types,
                        primaryType: "Preconfirm",
                        message: {
                            messageHash
                        }
                    });

                    // Preconfirm the message
                    const preconfirmHash = await this.l2Bridge.write.preconfirm([[messageHash], [signature]], {
                        account: this.walletClient.account
                    });
                    await this.l2Client.waitForTransactionReceipt({ hash: preconfirmHash });

                    // Complete the deposit
                    const hash = await this.l2Bridge.write.completeDeposit([
                        deposit.user,
                        deposit.amount,
                        deposit.nonce,
                    ], { value: deposit.amount });

                    const receipt = await this.l2Client.waitForTransactionReceipt({ hash });
                    // Check for DepositCompleted event in the receipt
                    const depositCompletedEvent = receipt.logs.find((log: Log) => {
                        try {
                            const decodedLog = decodeEventLog({
                                abi: this.l2Bridge.abi,
                                data: log.data,
                                topics: log.topics,
                            }) as unknown as DepositCompletedEvent;
                            return decodedLog.eventName === "DepositCompleted";
                        } catch (error) {
                            return false;
                        }
                    });

                    if (depositCompletedEvent) {
                        printDim(`Sequencer: Deposit processed for user ${deposit.user}`);
                    } else {
                        printDim(`Sequencer: Deposit processing failed for user ${deposit.user}`);
                    }
                } catch (error) {
                    printDim(`Sequencer: Error processing deposit for user ${deposit.user}:`, error);
                }
            }

            // Clear processed deposits
            this.l1Monitor.clearDeposits();
        }

        // Process swaps
        const pendingSwaps = this.l1Monitor.getPendingSwaps();

        if (pendingSwaps.length > 0) {
            printDim(`Sequencer: Processing ${pendingSwaps.length} swaps in new block`);

            // Process each swap
            for (const swap of pendingSwaps) {
                try {
                    // Compute the message hash
                    const messageHash = keccak256(
                        encodeAbiParameters(
                            parseAbiParameters("address, uint256, address, address, uint256, uint256, uint64"),
                            [
                                swap.userA,
                                swap.ETHAmount,
                                swap.userB,
                                swap.token,
                                swap.expectedTokenAmount,
                                swap.nonce,
                                BigInt(swap.expiry)
                            ]
                        )
                    );

                    // Get domain for EIP-712 signature
                    const domain = {
                        name: "L2Bridge",
                        version: "1.0.0",
                        chainId: await this.l2Client.getChainId(),
                        verifyingContract: this.l2BridgeAddress
                    };

                    // Define types for EIP-712 signature
                    const types = {
                        Preconfirm: [
                            { name: "messageHash", type: "bytes32" }
                        ]
                    };

                    // Sign the message hash
                    const signature = await this.walletClient.signTypedData({
                        account: this.walletClient.account,
                        domain,
                        types,
                        primaryType: "Preconfirm",
                        message: {
                            messageHash
                        }
                    });

                    // Preconfirm the message
                    const preconfirmHash = await this.l2Bridge.write.preconfirm([[messageHash], [signature]], {
                        account: this.walletClient.account
                    });
                    await this.l2Client.waitForTransactionReceipt({ hash: preconfirmHash });

                    // Complete the swap request
                    const hash = await this.l2Bridge.write.completeRequestSwap([
                        swap.userA,
                        swap.ETHAmount,
                        swap.userB,
                        swap.token,
                        swap.expectedTokenAmount,
                        swap.nonce,
                        swap.expiry,
                    ], { value: swap.ETHAmount });

                    const receipt = await this.l2Client.waitForTransactionReceipt({ hash });
                    // Check for RequestSwapCompleted event in the receipt
                    const requestSwapCompletedEvent = receipt.logs.find((log: Log) => {
                        try {
                            const decodedLog = decodeEventLog({
                                abi: this.l2Bridge.abi,
                                data: log.data,
                                topics: log.topics,
                            }) as unknown as RequestSwapCompletedEvent;
                            return decodedLog.eventName === "RequestSwapCompleted";
                        } catch (error) {
                            return false;
                        }
                    });

                    if (requestSwapCompletedEvent) {
                        printDim(`Sequencer: Swap request processed for userA ${swap.userA}`);
                    } else {
                        printDim(`Sequencer: Swap request processing failed for userA ${swap.userA}`);
                    }
                } catch (error) {
                    printDim(`Sequencer: Error processing swap for userA ${swap.userA}:`, error);
                }
            }

            // Clear processed swaps
            this.l1Monitor.clearSwaps();
        }

        // Check for expired swaps and cancel them
        const expiredSwaps = this.l1Monitor.getExpiredSwaps();
        if (expiredSwaps.length > 0) {
            printDim(`Sequencer: Found ${expiredSwaps.length} expired swaps to cancel`);

            for (const swap of expiredSwaps) {
                try {
                    printDim(`Sequencer: Cancelling expired swap for userA ${swap.userA}`);
                    const hash = await this.l2Bridge.write.cancelExpiredSwap([
                        swap.userA,
                        swap.ETHAmount,
                        swap.userB,
                        swap.token,
                        swap.expectedTokenAmount,
                        swap.nonce,
                        swap.expiry
                    ]);

                    const receipt = await this.l2Client.waitForTransactionReceipt({ hash });
                    // Check for SwapCancelled event in the receipt
                    const swapCancelledEvent = receipt.logs.find((log: Log) => {
                        try {
                            const decodedLog = decodeEventLog({
                                abi: this.l2Bridge.abi,
                                data: log.data,
                                topics: log.topics,
                            }) as unknown as SwapCancelledEvent;
                            return decodedLog.eventName === "SwapCancelled";
                        } catch (error) {
                            return false;
                        }
                    });

                    if (swapCancelledEvent) {
                        printDim(`Sequencer: Swap cancelled for userA ${swap.userA}`);
                        // Remove the swap from unfilled swaps list
                        this.l1Monitor.removeUnfilledSwap(swap.messageHash);
                    } else {
                        printDim(`Sequencer: Swap cancellation failed for userA ${swap.userA}`);
                    }
                } catch (error) {
                    printDim(`Sequencer: Error cancelling expired swap for userA ${swap.userA}:`, error);
                }
            }
        }

        // Watch for SwapFilled events to update unfilled swaps list
        this.l2Client.watchContractEvent({
            address: this.l2Bridge.address,
            abi: this.l2Bridge.abi,
            eventName: "SwapFilled",
            onLogs: async (logs: Log[]) => {
                for (const log of logs) {
                    try {
                        const decodedLog = decodeEventLog({
                            abi: this.l2Bridge.abi,
                            data: log.data,
                            topics: log.topics,
                        }) as SwapFilledEvent;
                        
                        if (decodedLog.eventName === "SwapFilled") {
                            const messageHash = decodedLog.args.messageHash as `0x${string}`;
                            // Remove the filled swap from unfilled swaps list
                            this.l1Monitor.removeUnfilledSwap(messageHash);
                            printDim(`Sequencer: Swap filled, removed swap from unfilled list`);
                        }
                    } catch (error) {
                        printDim("Sequencer: Error processing SwapFilled event:", error);
                    }
                }
            },
        });

        if (pendingDeposits.length === 0 && pendingSwaps.length === 0 && expiredSwaps.length === 0) {
            printDim("Sequencer: No pending deposits, swaps, or expired swaps to process");
        }
    }
} 