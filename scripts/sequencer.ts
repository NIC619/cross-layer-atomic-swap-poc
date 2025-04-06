import hre from "hardhat";
import { PublicClient, WalletClient, Log, decodeEventLog } from "viem";
import { L1Monitor, Deposit, Swap } from "./monitor";

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
        this.l2Client = l2Client;
        this.l2BridgeAddress = l2BridgeAddress;
        this.l2Bridge = null;
        this.l1Monitor = l1Monitor;
    }

    async initialize() {
        this.l2Bridge = await hre.viem.getContractAt("L2Bridge", this.l2BridgeAddress, {
            client: { public: this.l2Client, wallet: this.walletClient }
        }) as any;
    }

    async start() {
        if (!this.l2Bridge) {
            await this.initialize();
        }
        console.log("Sequencer: Starting block production...");
        // Run block production every second
        this.intervalId = setInterval(() => this.produceBlock(), 1000);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        console.log("Sequencer: Stopped block production");
    }

    private async produceBlock() {
        // Process deposits
        const pendingDeposits = this.l1Monitor.getPendingDeposits();

        if (pendingDeposits.length > 0) {
            console.log(`Sequencer: Processing ${pendingDeposits.length} deposits in new block`);

            // Process each deposit
            for (const deposit of pendingDeposits) {
                try {
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

        // Process swaps
        const pendingSwaps = this.l1Monitor.getPendingSwaps();

        if (pendingSwaps.length > 0) {
            console.log(`Sequencer: Processing ${pendingSwaps.length} swaps in new block`);

            // Process each swap
            for (const swap of pendingSwaps) {
                try {
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
                        console.log(`Sequencer: RequestSwapCompleted event found for userA ${swap.userA}`);
                    } else {
                        console.warn(`Sequencer: No RequestSwapCompleted event found for userA ${swap.userA}`);
                    }
                } catch (error) {
                    console.error(`Sequencer: Error processing swap for userA ${swap.userA}:`, error);
                }
            }

            // Clear processed swaps
            this.l1Monitor.clearSwaps();
        }

        if (pendingDeposits.length === 0 && pendingSwaps.length === 0) {
            console.log("Sequencer: No pending deposits or swaps to process");
        }
    }
} 