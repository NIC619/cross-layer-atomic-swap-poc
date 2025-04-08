import hre from "hardhat";
import { PublicClient, Log, decodeEventLog, encodeAbiParameters, parseAbiParameters, keccak256 } from "viem";
import { printDim } from "./utils";

interface DepositEvent {
    eventName: 'Deposit';
    args: {
        user: string;
        amount: bigint;
        nonce: bigint;
    };
}

interface RequestSwapEvent {
    eventName: 'RequestSwap';
    args: {
        userA: string;
        ETHAmount: bigint;
        userB: string;
        token: string;
        expectedTokenAmount: bigint;
        nonce: bigint;
        expiry: number;
    };
}

export interface Deposit {
  user: `0x${string}`;
  amount: bigint;
  nonce: bigint;
  messageHash: `0x${string}`;
}

export interface Swap {
  userA: `0x${string}`;
  ETHAmount: bigint;
  userB: `0x${string}`;
  token: `0x${string}`;
  expectedTokenAmount: bigint;
  nonce: bigint;
  expiry: number;
  messageHash: `0x${string}`;
}

export class L1Monitor {
  /** L1Bridge contract instance */
  private l1Bridge: any;
  private l1Client: PublicClient;
  private l1BridgeAddress: `0x${string}`;
  private deposits: Deposit[] = [];
  private swaps: Swap[] = [];
  private unfilledSwaps: Swap[] = []; // Track unfilled swaps
  private isMonitoring: boolean = false;

  constructor(l1Client: PublicClient, l1BridgeAddress: `0x${string}`) {
    this.l1Client = l1Client;
    this.l1BridgeAddress = l1BridgeAddress;
    this.l1Bridge = null; // Initialize as null
  }

  async initialize() {
    this.l1Bridge = await hre.viem.getContractAt("L1Bridge", this.l1BridgeAddress, {
      client: { public: this.l1Client }
    }) as any;
  }

  async startMonitoring() {
    if (this.isMonitoring) return;
    if (!this.l1Bridge) {
      await this.initialize();
    }
    this.isMonitoring = true;

    printDim("L1Monitor: Starting to watch for deposits and swaps...");
    printDim("L1Monitor: Watching address: " + this.l1Bridge.address);

    // Watch for Deposit events
    this.l1Client.watchContractEvent({
      address: this.l1Bridge.address,
      abi: this.l1Bridge.abi,
      eventName: "Deposit",
      onLogs: async (logs: Log[]) => {
        for (const log of logs) {
          const decodedLog = decodeEventLog({
            abi: this.l1Bridge.abi,
            data: log.data,
            topics: log.topics,
          }) as DepositEvent;

          const deposit: Deposit = {
            user: decodedLog.args.user as `0x${string}`,
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
          printDim(`L1Monitor: Detected deposit from ${deposit.user} for ${deposit.amount} wei with nonce ${deposit.nonce}`);
        }
      },
    });

    // Watch for RequestSwap events
    this.l1Client.watchContractEvent({
      address: this.l1Bridge.address,
      abi: this.l1Bridge.abi,
      eventName: "RequestSwap",
      onLogs: async (logs: Log[]) => {
        for (const log of logs) {
          const decodedLog = decodeEventLog({
            abi: this.l1Bridge.abi,
            data: log.data,
            topics: log.topics,
          }) as RequestSwapEvent;

          const swap: Swap = {
            userA: decodedLog.args.userA as `0x${string}`,
            ETHAmount: decodedLog.args.ETHAmount,
            userB: decodedLog.args.userB as `0x${string}`,
            token: decodedLog.args.token as `0x${string}`,
            expectedTokenAmount: decodedLog.args.expectedTokenAmount,
            nonce: decodedLog.args.nonce,
            expiry: decodedLog.args.expiry,
            messageHash: keccak256(
                encodeAbiParameters(
                    parseAbiParameters("address, uint256, address, address, uint256, uint256, uint256"),
                    [
                        decodedLog.args.userA as `0x${string}`,
                        decodedLog.args.ETHAmount,
                        decodedLog.args.userB as `0x${string}`,
                        decodedLog.args.token as `0x${string}`,
                        decodedLog.args.expectedTokenAmount,
                        decodedLog.args.nonce,
                        decodedLog.args.expiry
                    ]
                )
            ) as `0x${string}`
          };
          this.swaps.push(swap);
          this.unfilledSwaps.push(swap);
          printDim(`L1Monitor: Detected swap request from ${swap.userA} to ${swap.userB} for ${swap.ETHAmount} wei and ${swap.expectedTokenAmount} tokens with nonce ${swap.nonce}`);
        }
      },
    });
  }

  stopMonitoring() {
    this.isMonitoring = false;
    printDim("L1Monitor: Stopped monitoring");
  }

  getPendingDeposits(): Deposit[] {
    return [...this.deposits];
  }

  getPendingSwaps(): Swap[] {
    return [...this.swaps];
  }

  getUnfilledSwaps(): Swap[] {
    return [...this.unfilledSwaps];
  }

  // Remove a swap from the unfilled swaps list (when it's filled)
  removeUnfilledSwap(messageHash: `0x${string}`) {
    this.unfilledSwaps = this.unfilledSwaps.filter(swap => swap.messageHash !== messageHash);
  }

  // Get expired swaps that need to be cancelled
  getExpiredSwaps(): Swap[] {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    return this.unfilledSwaps.filter(swap => swap.expiry < currentTimestamp);
  }

  clearDeposits() {
    this.deposits = [];
  }

  clearSwaps() {
    this.swaps = [];
  }
} 