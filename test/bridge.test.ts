import { expect } from "chai";
import hre from "hardhat";
import { impersonateAccount, stopImpersonatingAccount, setBalance, loadFixture, time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { encodeAbiParameters, parseAbiParameters, getAddress, parseEther, keccak256 } from "viem";

describe("Bridge Contracts", () => {
    let currentTimestamp: number;

    before(async () => {
        // Hardhat testnet somehow set the block timestamp to one year later so can not override it but to read and use it
        currentTimestamp = await time.latest();
    });

    describe("L1Bridge", () => {

        async function deployL1BridgeFixture() {
            // Get signers
            const [owner, userA, userB] = await hre.viem.getWalletClients();
            const publicClient = await hre.viem.getPublicClient();

            // Deploy the contract
            const l1Bridge = await hre.viem.deployContract("L1Bridge");

            return {
                l1Bridge,
                owner,
                userA,
                userB,
                publicClient
            };
        }

        describe("Deposit", () => {
            it("should accept ETH deposit and increment userA nonce", async () => {
                const { l1Bridge, userA, publicClient } = await loadFixture(deployL1BridgeFixture);
                const depositAmount = parseEther("1.0");

                // Deposit using viem
                const hash = await l1Bridge.write.deposit({ account: userA.account.address, value: depositAmount });
                await publicClient.waitForTransactionReceipt({ hash });

                // Check userA nonce
                const nonce = await l1Bridge.read.userNonces([userA.account.address]);
                expect(nonce).to.equal(1n);
            });

            it("should reject zero deposit", async () => {
                const { l1Bridge, userA } = await loadFixture(deployL1BridgeFixture);

                await expect(
                    l1Bridge.write.deposit({ account: userA.account.address, value: 0n })
                ).to.be.rejectedWith("Zero deposit amount");
            });

            it("should increment nonce correctly for multiple deposits", async () => {
                const { l1Bridge, userA, publicClient } = await loadFixture(deployL1BridgeFixture);
                const depositAmount = parseEther("1.0");

                // Make multiple deposits
                for (let i = 0; i < 3; i++) {
                    const hash = await l1Bridge.write.deposit({ account: userA.account.address, value: depositAmount });
                    await publicClient.waitForTransactionReceipt({ hash });
                }

                // Check userA nonce
                const nonce = await l1Bridge.read.userNonces([userA.account.address]);
                expect(nonce).to.equal(3n);
            });
        });

        describe("RequestSwap", () => {
            it("should accept valid swap request, increment userA nonce, and emit correct event", async () => {
                const { l1Bridge, userA, userB, publicClient } = await loadFixture(deployL1BridgeFixture);
                const swapAmount = parseEther("1.0");
                const expiry = BigInt(currentTimestamp + 3600); // 1 hour from now
                const tokenAddress = "0x1234567890123456789012345678901234567890";
                const expectedTokenAmount = parseEther("1000.0");

                // Request swap using viem
                const hash = await l1Bridge.write.requestSwap([
                    expiry,
                    userB.account.address,
                    tokenAddress,
                    expectedTokenAmount
                ], { account: userA.account.address, value: swapAmount });
                await publicClient.waitForTransactionReceipt({ hash });

                // Check userA nonce
                const nonce = await l1Bridge.read.userNonces([userA.account.address]);
                expect(nonce).to.equal(1n);

                // Get the RequestSwap events
                const requestSwapEvents = await l1Bridge.getEvents.RequestSwap();
                expect(requestSwapEvents).to.have.lengthOf(1);
                const event = requestSwapEvents[0];
                expect(event.args.userA?.toLowerCase()).to.equal(userA.account.address.toLowerCase());
                expect(event.args.ETHAmount).to.equal(swapAmount);
                expect(event.args.userB?.toLowerCase()).to.equal(userB.account.address.toLowerCase());
                expect(event.args.token).to.equal(tokenAddress);
                expect(event.args.expectedTokenAmount).to.equal(expectedTokenAmount);
                expect(event.args.nonce).to.equal(0n);
                expect(event.args.expiry).to.equal(expiry);
            });

            it("should reject zero swap amount", async () => {
                const { l1Bridge, userA, userB } = await loadFixture(deployL1BridgeFixture);
                const expiry = BigInt(currentTimestamp + 3600);
                const tokenAddress = "0x1234567890123456789012345678901234567890";
                const expectedTokenAmount = parseEther("1000.0");

                await expect(
                    l1Bridge.write.requestSwap([
                        expiry,
                        userB.account.address,
                        tokenAddress,
                        expectedTokenAmount
                    ], { account: userA.account.address, value: 0n })
                ).to.be.rejectedWith("Zero swap amount");
            });

            it("should reject expired timestamp", async () => {
                const { l1Bridge, userA, userB } = await loadFixture(deployL1BridgeFixture);
                const swapAmount = parseEther("1.0");
                const expiredTime = BigInt(currentTimestamp - 3600); // 1 hour ago
                const tokenAddress = "0x1234567890123456789012345678901234567890";
                const expectedTokenAmount = parseEther("1000.0");

                await expect(
                    l1Bridge.write.requestSwap([
                        expiredTime,
                        userB.account.address,
                        tokenAddress,
                        expectedTokenAmount
                    ], { account: userA.account.address, value: swapAmount })
                ).to.be.rejectedWith("Expiry must be in the future");
            });

            it("should reject zero address for token", async () => {
                const { l1Bridge, userA, userB } = await loadFixture(deployL1BridgeFixture);
                const swapAmount = parseEther("1.0");
                const expiry = BigInt(currentTimestamp + 3600);
                const expectedTokenAmount = parseEther("1000.0");

                await expect(
                    l1Bridge.write.requestSwap([
                        expiry,
                        userB.account.address,
                        "0x0000000000000000000000000000000000000000",
                        expectedTokenAmount
                    ], { account: userA.account.address, value: swapAmount })
                ).to.be.rejectedWith("Invalid token address");
            });

            it("should reject zero expected token amount", async () => {
                const { l1Bridge, userA, userB } = await loadFixture(deployL1BridgeFixture);
                const swapAmount = parseEther("1.0");
                const expiry = BigInt(currentTimestamp + 3600);
                const tokenAddress = "0x1234567890123456789012345678901234567890";

                await expect(
                    l1Bridge.write.requestSwap([
                        expiry,
                        userB.account.address,
                        tokenAddress,
                        0n
                    ], { account: userA.account.address, value: swapAmount })
                ).to.be.rejectedWith("Zero token amount");
            });

            it("should reject self-swap", async () => {
                const { l1Bridge, userA } = await loadFixture(deployL1BridgeFixture);
                const swapAmount = parseEther("1.0");
                const expiry = BigInt(currentTimestamp + 3600);
                const tokenAddress = "0x1234567890123456789012345678901234567890";
                const expectedTokenAmount = parseEther("1000.0");

                await expect(
                    l1Bridge.write.requestSwap([
                        expiry,
                        userA.account.address,
                        tokenAddress,
                        expectedTokenAmount
                    ], { account: userA.account.address, value: swapAmount })
                ).to.be.rejectedWith("Cannot swap with yourself");
            });
        });

        describe("Prove", () => {
            it("should verify proof and register withdraw message hashes", async () => {
                const { l1Bridge, owner, userA, publicClient } = await loadFixture(deployL1BridgeFixture);
                const proof = "0x" as `0x${string}`;
                const withdrawMessageHash = keccak256(
                    encodeAbiParameters(
                        parseAbiParameters("address, uint256, uint256"),
                        [userA.account.address, parseEther("1.0"), 0n]
                    )
                );

                // Prove using viem
                const hash = await l1Bridge.write.prove([proof, [withdrawMessageHash]]);
                await publicClient.waitForTransactionReceipt({ hash });

                // Check verified withdrawal
                const isVerified = await l1Bridge.read.verifiedWithdrawals([withdrawMessageHash]);
                expect(isVerified).to.be.true;
            });

            it("should handle multiple withdraw message hashes", async () => {
                const { l1Bridge, owner, userA, userB, publicClient } = await loadFixture(deployL1BridgeFixture);
                const proof = "0x" as `0x${string}`;
                const withdrawMessageHashes = [
                    keccak256(
                        encodeAbiParameters(
                            parseAbiParameters("address, uint256, uint256"),
                            [userA.account.address, parseEther("1.0"), 0n]
                        )
                    ),
                    keccak256(
                        encodeAbiParameters(
                            parseAbiParameters("address, uint256, uint256"),
                            [userB.account.address, parseEther("2.0"), 0n]
                        )
                    ),
                ];

                // Prove using viem
                const hash = await l1Bridge.write.prove([proof, withdrawMessageHashes]);
                await publicClient.waitForTransactionReceipt({ hash });

                // Check verified withdrawals
                for (const messageHash of withdrawMessageHashes) {
                    const isVerified = await l1Bridge.read.verifiedWithdrawals([messageHash]);
                    expect(isVerified).to.be.true;
                }
            });
        });

        describe("CompleteWithdraw", () => {
            const depositAmount = parseEther("1.0");
            const userL2Nonce = 0n;
            const ETH_ADDRESS = getAddress("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");

            it("should allow userA to withdraw ETH with valid parameters", async () => {
                const { l1Bridge, userA, publicClient } = await loadFixture(deployL1BridgeFixture);

                // Set contract balance directly instead of making a deposit
                await setBalance(l1Bridge.address, depositAmount);

                const withdrawMessageHash = keccak256(
                    encodeAbiParameters(
                        parseAbiParameters("address, address, uint256, uint256"),
                        [userA.account.address, ETH_ADDRESS, depositAmount, userL2Nonce]
                    )
                );

                const proveHash = await l1Bridge.write.prove(["0x" as `0x${string}`, [withdrawMessageHash as `0x${string}`]]);
                await publicClient.waitForTransactionReceipt({ hash: proveHash });

                const initialBalance = await publicClient.getBalance({ address: userA.account.address });

                // Withdraw using viem
                const hash = await l1Bridge.write.completeWithdraw([
                    userA.account.address,
                    ETH_ADDRESS,
                    depositAmount,
                    userL2Nonce,
                    withdrawMessageHash as `0x${string}`
                ]);

                await publicClient.waitForTransactionReceipt({ hash });

                const finalBalance = await publicClient.getBalance({ address: userA.account.address });
                expect(finalBalance - initialBalance).to.equal(depositAmount);
            });

            it("should allow userA to withdraw ERC20 tokens with valid parameters", async () => {
                const { l1Bridge, userA, publicClient } = await loadFixture(deployL1BridgeFixture);
                
                // Deploy a mock ERC20 token
                const mockToken = await hre.viem.deployContract("MockERC20", ["Mock Token", "MTK", 18]);
                const tokenAmount = parseEther("100.0");
                
                // Mint tokens to the bridge contract
                await mockToken.write.mint([l1Bridge.address, tokenAmount]);
                
                const withdrawMessageHash = keccak256(
                    encodeAbiParameters(
                        parseAbiParameters("address, address, uint256, uint256"),
                        [userA.account.address, mockToken.address, tokenAmount, userL2Nonce]
                    )
                );

                const proveHash = await l1Bridge.write.prove(["0x" as `0x${string}`, [withdrawMessageHash as `0x${string}`]]);
                await publicClient.waitForTransactionReceipt({ hash: proveHash });

                const initialBalance = await mockToken.read.balanceOf([userA.account.address]);

                // Withdraw using viem
                const hash = await l1Bridge.write.completeWithdraw([
                    userA.account.address,
                    mockToken.address,
                    tokenAmount,
                    userL2Nonce,
                    withdrawMessageHash as `0x${string}`
                ]);

                await publicClient.waitForTransactionReceipt({ hash });

                const finalBalance = await mockToken.read.balanceOf([userA.account.address]);
                expect(finalBalance - initialBalance).to.equal(tokenAmount);
            });

            it("should reject withdrawal of unverified message hash", async () => {
                const { l1Bridge, userA } = await loadFixture(deployL1BridgeFixture);

                // Set contract balance directly
                await setBalance(l1Bridge.address, depositAmount);

                const unverifiedHash = keccak256(
                    encodeAbiParameters(
                        parseAbiParameters("address, address, uint256, uint256"),
                        [userA.account.address, ETH_ADDRESS, depositAmount, userL2Nonce + 1n]
                    )
                );

                await expect(
                    l1Bridge.write.completeWithdraw([
                        userA.account.address,
                        ETH_ADDRESS,
                        depositAmount,
                        userL2Nonce + 1n,
                        unverifiedHash as `0x${string}`
                    ])
                ).to.be.rejectedWith("Withdrawal not verified");
            });

            it("should prevent double withdrawal", async () => {
                const { l1Bridge, userA, publicClient } = await loadFixture(deployL1BridgeFixture);

                // Set contract balance directly
                await setBalance(l1Bridge.address, depositAmount);

                const withdrawMessageHash = keccak256(
                    encodeAbiParameters(
                        parseAbiParameters("address, address, uint256, uint256"),
                        [userA.account.address, ETH_ADDRESS, depositAmount, userL2Nonce]
                    )
                );

                const proveHash = await l1Bridge.write.prove(["0x" as `0x${string}`, [withdrawMessageHash as `0x${string}`]]);
                await publicClient.waitForTransactionReceipt({ hash: proveHash });

                // First withdrawal
                const hash1 = await l1Bridge.write.completeWithdraw([
                    userA.account.address,
                    ETH_ADDRESS,
                    depositAmount,
                    userL2Nonce,
                    withdrawMessageHash as `0x${string}`
                ]);

                await publicClient.waitForTransactionReceipt({ hash: hash1 });

                // Second withdrawal should fail
                await expect(
                    l1Bridge.write.completeWithdraw([
                        userA.account.address,
                        ETH_ADDRESS,
                        depositAmount,
                        userL2Nonce,
                        withdrawMessageHash as `0x${string}`
                    ])
                ).to.be.rejectedWith("Withdrawal already claimed");
            });

            it("should reject withdrawal with mismatched parameters", async () => {
                const { l1Bridge, userA, publicClient } = await loadFixture(deployL1BridgeFixture);

                // Set contract balance directly
                await setBalance(l1Bridge.address, depositAmount);

                const withdrawMessageHash = keccak256(
                    encodeAbiParameters(
                        parseAbiParameters("address, address, uint256, uint256"),
                        [userA.account.address, ETH_ADDRESS, depositAmount, userL2Nonce]
                    )
                );

                const proveHash = await l1Bridge.write.prove(["0x" as `0x${string}`, [withdrawMessageHash as `0x${string}`]]);
                await publicClient.waitForTransactionReceipt({ hash: proveHash });

                const invalidAmount = depositAmount + 1n;
                await expect(
                    l1Bridge.write.completeWithdraw([
                        userA.account.address,
                        ETH_ADDRESS,
                        invalidAmount,
                        userL2Nonce,
                        withdrawMessageHash as `0x${string}`
                    ])
                ).to.be.rejectedWith("Invalid withdrawal parameters");
            });
        });
    });

    describe("L2Bridge", () => {
        async function deployL2BridgeFixture() {
            // Get signers
            const [owner, userA, userB, userC] = await hre.viem.getWalletClients();
            const publicClient = await hre.viem.getPublicClient();

            // Deploy L1Bridge first
            const l1Bridge = await hre.viem.deployContract("L1Bridge");

            // Deploy L2Bridge with L1Bridge address
            const l2Bridge = await hre.viem.deployContract("L2Bridge", [l1Bridge.address]);

            return {
                l1Bridge,
                l2Bridge,
                owner,
                userA,
                userB,
                userC,
                publicClient
            };
        }

        describe("Constructor", () => {
            it("should set the L1Bridge address correctly", async () => {
                const { l1Bridge, l2Bridge } = await loadFixture(deployL2BridgeFixture);
                const l1BridgeAddress = await l2Bridge.read.L1Bridge();
                // Normalize addresses to lowercase for comparison
                expect(l1BridgeAddress.toLowerCase()).to.equal(l1Bridge.address.toLowerCase());
            });

            it("should reject zero address for L1Bridge", async () => {
                await expect(
                    hre.viem.deployContract("L2Bridge", ["0x0000000000000000000000000000000000000000"])
                ).to.be.rejectedWith("Invalid L1Bridge address");
            });
        });

        describe("CompleteDeposit", () => {
            const depositAmount = parseEther("1.0");
            const userNonce = 0n;

            it("should complete deposit and transfer ETH to userA", async () => {
                const { l1Bridge, l2Bridge, userA, publicClient } = await loadFixture(deployL2BridgeFixture);

                // Set contract balance directly
                await setBalance(l2Bridge.address, depositAmount);

                // Compute the message hash
                const messageHash = keccak256(
                    encodeAbiParameters(
                        parseAbiParameters("address, uint256, uint256"),
                        [userA.account.address, depositAmount, userNonce]
                    )
                );

                const initialBalance = await publicClient.getBalance({ address: userA.account.address });

                await impersonateAccount(l1Bridge.address);
                await setBalance(l1Bridge.address, parseEther("10.0"));

                // Complete deposit
                const hash = await l2Bridge.write.completeDeposit([
                    userA.account.address,
                    depositAmount,
                    userNonce
                ], { account: l1Bridge.address });
                await publicClient.waitForTransactionReceipt({ hash });

                await stopImpersonatingAccount(l1Bridge.address);

                // Check final balance
                const finalBalance = await publicClient.getBalance({ address: userA.account.address });
                expect(finalBalance - initialBalance).to.equal(depositAmount);

                // Check message is marked as processed
                const isProcessed = await l2Bridge.read.processedMessages([messageHash]);
                expect(isProcessed).to.be.true;
            });

            // FIXME: Uncomment this test only if the `msg.sender` check is uncommented in `L2Bridge.completeDeposit`
            // it("should reject deposit from non-L1Bridge address", async () => {
            //     const { l2Bridge, userA } = await loadFixture(deployL2BridgeFixture);

            //     await expect(
            //         l2Bridge.write.completeDeposit([
            //             userA.account.address,
            //             depositAmount,
            //             userNonce
            //         ], { account: userA.account.address })
            //     ).to.be.rejectedWith("Only L1Bridge can complete deposits");
            // });

            it("should reject already processed deposits", async () => {
                const { l1Bridge, l2Bridge, userA, publicClient } = await loadFixture(deployL2BridgeFixture);

                // Set contract balance directly
                await setBalance(l2Bridge.address, depositAmount);

                // Compute the message hash
                const messageHash = keccak256(
                    encodeAbiParameters(
                        parseAbiParameters("address, uint256, uint256"),
                        [userA.account.address, depositAmount, userNonce]
                    )
                );

                await impersonateAccount(l1Bridge.address);
                await setBalance(l1Bridge.address, parseEther("10.0"));

                // First deposit
                const hash1 = await l2Bridge.write.completeDeposit([
                    userA.account.address,
                    depositAmount,
                    userNonce
                ], { account: l1Bridge.address });

                await publicClient.waitForTransactionReceipt({ hash: hash1 });

                await expect(
                    l2Bridge.write.completeDeposit([
                        userA.account.address,
                        depositAmount,
                        userNonce
                    ], { account: l1Bridge.address })
                ).to.be.rejectedWith("Message already processed");

                await stopImpersonatingAccount(l1Bridge.address);
            });
        });

        describe("Withdraw", () => {
            const withdrawAmount = parseEther("1.0");

            it("should accept ETH withdraw and increment userA nonce", async () => {
                const { l2Bridge, userA, publicClient } = await loadFixture(deployL2BridgeFixture);

                // Withdraw using viem
                const hash = await l2Bridge.write.withdraw({ account: userA.account.address, value: withdrawAmount });
                await publicClient.waitForTransactionReceipt({ hash });

                // Check userA nonce
                const nonce = await l2Bridge.read.userNonces([userA.account.address]);
                expect(nonce).to.equal(1n);
            });

            it("should reject zero withdraw", async () => {
                const { l2Bridge, userA } = await loadFixture(deployL2BridgeFixture);

                await expect(
                    l2Bridge.write.withdraw({ account: userA.account.address, value: 0n })
                ).to.be.rejectedWith("Zero withdraw amount");
            });

            it("should increment nonce correctly for multiple withdraws", async () => {
                const { l2Bridge, userA, publicClient } = await loadFixture(deployL2BridgeFixture);

                // Make multiple withdraws
                for (let i = 0; i < 3; i++) {
                    const hash = await l2Bridge.write.withdraw({ account: userA.account.address, value: withdrawAmount });
                    await publicClient.waitForTransactionReceipt({ hash });
                }

                // Check userA nonce
                const nonce = await l2Bridge.read.userNonces([userA.account.address]);
                expect(nonce).to.equal(3n);
            });
        });

        describe("CompleteRequestSwap", () => {
            const swapAmount = parseEther("1.0");
            const expectedTokenAmount = parseEther("1000.0");
            const userNonce = 0n;
            let mockToken: any;
            let tokenAddress: `0x${string}` = "0x0000000000000000000000000000000000000000" as `0x${string}`;

            before(async () => {                
                // Deploy a mock ERC20 token
                mockToken = await hre.viem.deployContract("MockERC20", ["Mock Token", "MTK", 18]);
                tokenAddress = mockToken.address as `0x${string}`;
            });

            interface L2BridgeWithTokenFixture {
                l1Bridge: any;
                l2Bridge: any;
                mockToken: any;
                owner: any;
                userA: any;
                userB: any;
                publicClient: any;
            }

            async function deployL2BridgeWithTokenFixture(): Promise<L2BridgeWithTokenFixture> {
                const fixture = await loadFixture(deployL2BridgeFixture);
                const { l1Bridge, l2Bridge, owner, userA, userB, publicClient } = fixture;

                // Set contract balance directly for ETH swaps
                await setBalance(l2Bridge.address, swapAmount);

                return {
                    l1Bridge,
                    l2Bridge,
                    mockToken,
                    owner,
                    userA,
                    userB,
                    publicClient
                };
            }

            it("should complete swap request and set status to Open", async () => {
                const { l1Bridge, l2Bridge, userA, userB, publicClient } = await loadFixture(deployL2BridgeWithTokenFixture);
                const expiry = BigInt(currentTimestamp + 3600); // 1 hour from now

                // Compute the message hash
                const messageHash = keccak256(
                    encodeAbiParameters(
                        parseAbiParameters("address, uint256, address, address, uint256, uint256, uint64"),
                        [userA.account.address, swapAmount, userB.account.address, tokenAddress, expectedTokenAmount, userNonce, expiry]
                    )
                );

                await impersonateAccount(l1Bridge.address);
                await setBalance(l1Bridge.address, parseEther("10.0"));
                
                // Complete request swap
                const hash = await l2Bridge.write.completeRequestSwap([
                    userA.account.address,
                    swapAmount,
                    userB.account.address,
                    tokenAddress,
                    expectedTokenAmount,
                    userNonce,
                    expiry
                ], { account: l1Bridge.address });
                await publicClient.waitForTransactionReceipt({ hash });

                await stopImpersonatingAccount(l1Bridge.address);

                // Check message is marked as processed
                const isProcessed = await l2Bridge.read.processedMessages([messageHash]);
                expect(isProcessed).to.be.true;

                // Check swap status is Open
                const swapStatus = await l2Bridge.read.swapStatus([messageHash]);
                expect(swapStatus).to.equal(1n); // 1 = Open

                // Check RequestSwapCompleted event
                const events = await l2Bridge.getEvents.RequestSwapCompleted();
                expect(events).to.have.lengthOf(1);
                const event = events[0];
                expect(event.args.userA?.toLowerCase()).to.equal(userA.account.address.toLowerCase());
                expect(event.args.ETHAmount).to.equal(swapAmount);
                expect(event.args.userB?.toLowerCase()).to.equal(userB.account.address.toLowerCase());
                expect(event.args.token.toLowerCase()).to.equal(tokenAddress.toLowerCase());
                expect(event.args.expectedTokenAmount).to.equal(expectedTokenAmount);
                expect(event.args.nonce).to.equal(userNonce);
                expect(event.args.expiry).to.equal(expiry);
                expect(event.args.messageHash).to.equal(messageHash);
            });
            
            it("should reject already processed swap requests", async () => {
                const { l1Bridge, l2Bridge, userA, userB, publicClient } = await loadFixture(deployL2BridgeWithTokenFixture);
                const expiry = BigInt(currentTimestamp + 3600);

                await impersonateAccount(l1Bridge.address);
                await setBalance(l1Bridge.address, parseEther("10.0"));

                // First request
                const hash1 = await l2Bridge.write.completeRequestSwap([
                    userA.account.address,
                    swapAmount,
                    userB.account.address,
                    tokenAddress,
                    expectedTokenAmount,
                    userNonce,
                    expiry
                ], { account: l1Bridge.address });
                await publicClient.waitForTransactionReceipt({ hash: hash1 });

                // Second request should fail
                await expect(
                    l2Bridge.write.completeRequestSwap([
                        userA.account.address,
                        swapAmount,
                        userB.account.address,
                        tokenAddress,
                        expectedTokenAmount,
                        userNonce,
                        expiry
                    ], { account: l1Bridge.address })
                ).to.be.rejectedWith("Message already processed");

                await stopImpersonatingAccount(l1Bridge.address);
            });

            it("should allow swap request with zero address for userB", async () => {
                const { l1Bridge, l2Bridge, userA, publicClient } = await loadFixture(deployL2BridgeWithTokenFixture);
                const expiry = BigInt(currentTimestamp + 3600);
                const zeroAddress = "0x0000000000000000000000000000000000000000" as `0x${string}`;

                // Compute the message hash
                const messageHash = keccak256(
                    encodeAbiParameters(
                        parseAbiParameters("address, uint256, address, address, uint256, uint256, uint64"),
                        [userA.account.address, swapAmount, zeroAddress, tokenAddress, expectedTokenAmount, userNonce, expiry]
                    )
                );

                await impersonateAccount(l1Bridge.address);
                await setBalance(l1Bridge.address, parseEther("10.0"));

                // Complete request swap
                const hash = await l2Bridge.write.completeRequestSwap([
                    userA.account.address,
                    swapAmount,
                    zeroAddress, // userB
                    tokenAddress,
                    expectedTokenAmount,
                    userNonce,
                    expiry
                ], { account: l1Bridge.address });
                await publicClient.waitForTransactionReceipt({ hash });

                await stopImpersonatingAccount(l1Bridge.address);

                // Check message is marked as processed
                const isProcessed = await l2Bridge.read.processedMessages([messageHash]);
                expect(isProcessed).to.be.true;

                // Check swap status is Open
                const swapStatus = await l2Bridge.read.swapStatus([messageHash]);
                expect(swapStatus).to.equal(1n); // 1 = Open
            });
        });
        
        describe("FillSwap", () => {
            const swapAmount = parseEther("1.0");
            const expectedTokenAmount = parseEther("1000.0");
            const userNonce = 0n;
            let mockToken: any;
            let tokenAddress: `0x${string}` = "0x0000000000000000000000000000000000000000" as `0x${string}`;
            let messageHash: string;

            interface L2BridgeWithTokenAndSwapFixture {
                l1Bridge: any;
                l2Bridge: any;
                mockToken: any;
                owner: any;
                userA: any;
                userB: any;
                userC: any;
                publicClient: any;
                expiry: bigint;
            }

            async function deployL2BridgeWithTokenAndSwapFixture(): Promise<L2BridgeWithTokenAndSwapFixture> {
                const fixture = await loadFixture(deployL2BridgeFixture);
                const { l1Bridge, l2Bridge, owner, userA, userB, userC, publicClient } = fixture;
                const expiry = BigInt(currentTimestamp + 3600); // 1 hour from now

                // Set contract balance directly for ETH swaps
                await setBalance(l2Bridge.address, swapAmount);

                // Deploy a mock ERC20 token
                mockToken = await hre.viem.deployContract("MockERC20", ["Mock Token", "MTK", 18]);
                tokenAddress = mockToken.address as `0x${string}`;
                // Mint tokens to userB for the swap
                await mockToken.write.mint([userB.account.address, expectedTokenAmount]);
                // Approve L2Bridge to spend tokens
                await mockToken.write.approve([l2Bridge.address, expectedTokenAmount], { account: userB.account.address });

                // Complete request swap
                await impersonateAccount(l1Bridge.address);
                await setBalance(l1Bridge.address, parseEther("10.0"));

                const hash = await l2Bridge.write.completeRequestSwap([
                    userA.account.address,
                    swapAmount,
                    userB.account.address,
                    tokenAddress,
                    expectedTokenAmount,
                    userNonce,
                    expiry
                ], { account: l1Bridge.address });
                await publicClient.waitForTransactionReceipt({ hash });

                await stopImpersonatingAccount(l1Bridge.address);

                // Compute the message hash
                messageHash = keccak256(
                    encodeAbiParameters(
                        parseAbiParameters("address, uint256, address, address, uint256, uint256, uint64"),
                        [userA.account.address, swapAmount, userB.account.address, tokenAddress, expectedTokenAmount, userNonce, expiry]
                    )
                );

                return {
                    l1Bridge,
                    l2Bridge,
                    mockToken,
                    owner,
                    userA,
                    userB,
                    userC,
                    publicClient,
                    expiry
                };
            }

            it("should fill swap and transfer tokens and ETH", async () => {
                const fixture = await loadFixture(deployL2BridgeWithTokenAndSwapFixture);
                const { l2Bridge, mockToken, userA, userB, publicClient, expiry } = fixture;

                // Get initial balances
                const initialUserTokenBalance = await mockToken.read.balanceOf([userA.account.address]);
                const initialOtherUserTokenBalance = await mockToken.read.balanceOf([userB.account.address]);
                const initialOtherUserEthBalance = await publicClient.getBalance({ address: userB.account.address });
                const initialContractTokenBalance = await mockToken.read.balanceOf([l2Bridge.address]);
                const initialContractEthBalance = await publicClient.getBalance({ address: l2Bridge.address });

                // Fill swap
                const hash = await l2Bridge.write.fillSwap([
                    userA.account.address,
                    swapAmount,
                    userB.account.address,
                    tokenAddress,
                    expectedTokenAmount,
                    userNonce,
                    expiry
                ], { account: userB.account.address });
                await publicClient.waitForTransactionReceipt({ hash });

                // Check final balances
                const finalUserTokenBalance = await mockToken.read.balanceOf([userA.account.address]);
                const finalOtherUserTokenBalance = await mockToken.read.balanceOf([userB.account.address]);
                const finalOtherUserEthBalance = await publicClient.getBalance({ address: userB.account.address });
                const finalContractTokenBalance = await mockToken.read.balanceOf([l2Bridge.address]);
                const finalContractEthBalance = await publicClient.getBalance({ address: l2Bridge.address });
                // OtherUser should have received ETH and sent tokens
                expect(finalOtherUserEthBalance - initialOtherUserEthBalance).to.closeTo(swapAmount, swapAmount / 100n); // User also has to pay transaction fee so exact ETH amount received will be less than expected
                expect(initialOtherUserTokenBalance - finalOtherUserTokenBalance).to.equal(expectedTokenAmount);

                // Contract should have received tokens and sent ETH
                expect(finalContractTokenBalance - initialContractTokenBalance).to.equal(expectedTokenAmount);
                expect(initialContractEthBalance - finalContractEthBalance).to.equal(swapAmount);

                // Check swap status is Filled
                const swapStatus = await l2Bridge.read.swapStatus([messageHash]);
                expect(swapStatus).to.equal(2n); // 2 = Filled

                // Check SwapFilled event
                const events = await l2Bridge.getEvents.SwapFilled();
                expect(events).to.have.lengthOf(1);
                const event = events[0];
                expect(event.args.userA?.toLowerCase()).to.equal(userA.account.address.toLowerCase());
                expect(event.args.ETHAmount).to.equal(swapAmount);
                expect(event.args.userB?.toLowerCase()).to.equal(userB.account.address.toLowerCase());
                expect(event.args.token.toLowerCase()).to.equal(tokenAddress.toLowerCase());
                expect(event.args.expectedTokenAmount).to.equal(expectedTokenAmount);
                expect(event.args.nonce).to.equal(userNonce);
                expect(event.args.expiry).to.equal(expiry);
                expect(event.args.messageHash).to.equal(messageHash);

                // Check Withdraw event for userA
                const withdrawEvents = await l2Bridge.getEvents.Withdraw();
                expect(withdrawEvents).to.have.lengthOf(1);
                const withdrawEvent = withdrawEvents[0];
                expect(withdrawEvent.args.user?.toLowerCase()).to.equal(userA.account.address.toLowerCase());
                expect(withdrawEvent.args.token.toLowerCase()).to.equal(tokenAddress.toLowerCase());
                expect(withdrawEvent.args.amount).to.equal(expectedTokenAmount);
                expect(withdrawEvent.args.nonce).to.equal(0n);
            });

            it("should reject filling an already filled swap", async () => {
                const fixture = await loadFixture(deployL2BridgeWithTokenAndSwapFixture);
                const { l2Bridge, userA, userB, expiry, publicClient } = fixture;

                // Fill swap first time
                const hash1 = await l2Bridge.write.fillSwap([
                    userA.account.address,
                    swapAmount,
                    userB.account.address,
                    tokenAddress,
                    expectedTokenAmount,
                    userNonce,
                    expiry
                ], { account: userB.account.address });
                await publicClient.waitForTransactionReceipt({ hash: hash1 });

                // Second fill should fail
                await expect(
                    l2Bridge.write.fillSwap([
                        userA.account.address,
                        swapAmount,
                        userB.account.address,
                        tokenAddress,
                        expectedTokenAmount,
                        userNonce,
                        expiry
                    ], { account: userB.account.address })
                ).to.be.rejectedWith("Swap already filled or expired");
            });

            it("should reject filling an expired swap", async () => {
                const fixture = await loadFixture(deployL2BridgeWithTokenAndSwapFixture);
                const { l1Bridge, l2Bridge, userA, userB, publicClient } = fixture;

                // Set expiry to the past
                const expiredTime = BigInt(currentTimestamp - 3600); // 1 hour ago

                // Compute the message hash
                const expiredMessageHash = keccak256(
                    encodeAbiParameters(
                        parseAbiParameters("address, uint256, address, address, uint256, uint256, uint64"),
                        [userA.account.address, swapAmount, userB.account.address, tokenAddress, expectedTokenAmount, userNonce, expiredTime]
                    )
                );

                // Set contract balance directly for ETH swaps
                await setBalance(l2Bridge.address, swapAmount);

                // Mint tokens to userB for the swap
                await mockToken.write.mint([userB.account.address, expectedTokenAmount]);

                // Approve L2Bridge to spend tokens
                await mockToken.write.approve([l2Bridge.address, expectedTokenAmount], { account: userB.account.address });

                // Complete request swap
                await impersonateAccount(l1Bridge.address);
                await setBalance(l1Bridge.address, parseEther("10.0"));

                const hash = await l2Bridge.write.completeRequestSwap([
                    userA.account.address,
                    swapAmount,
                    userB.account.address,
                    tokenAddress,
                    expectedTokenAmount,
                    userNonce,
                    expiredTime
                ], { account: l1Bridge.address });
                await publicClient.waitForTransactionReceipt({ hash });

                await stopImpersonatingAccount(l1Bridge.address);

                // Try to fill the expired swap
                await expect(
                    l2Bridge.write.fillSwap([
                        userA.account.address,
                        swapAmount,
                        userB.account.address,
                        tokenAddress,
                        expectedTokenAmount,
                        userNonce,
                        expiredTime
                    ], { account: userB.account.address })
                ).to.be.rejectedWith("Swap has expired");
            });
            
            it("should reject filling a swap from non-userB when userB is specified", async () => {
                const fixture = await loadFixture(deployL2BridgeWithTokenAndSwapFixture);
                const { l2Bridge, userA, userB, userC, expiry } = fixture;

                // Try to fill swap from userC instead of userB
                await expect(
                    l2Bridge.write.fillSwap([
                        userA.account.address,
                        swapAmount,
                        userB.account.address,
                        tokenAddress,
                        expectedTokenAmount,
                        userNonce,
                        expiry
                    ], { account: userC.account.address })
                ).to.be.rejectedWith("Only userB can fill the swap");
            });

            it("should allow anyone to fill a swap when userB is zero address", async () => {
                const fixture = await loadFixture(deployL2BridgeWithTokenAndSwapFixture);
                const { l1Bridge, l2Bridge, userA, userB, userC, publicClient } = fixture;

                const expiry = BigInt(currentTimestamp + 3600);
                const zeroAddress = "0x0000000000000000000000000000000000000000" as `0x${string}`;

                // Compute the message hash with zero address for userB
                const zeroUserBMessageHash = keccak256(
                    encodeAbiParameters(
                        parseAbiParameters("address, uint256, address, address, uint256, uint256, uint64"),
                        [userA.account.address, swapAmount, zeroAddress, tokenAddress, expectedTokenAmount, userNonce, expiry]
                    )
                );

                // Set contract balance directly for ETH swaps
                await setBalance(l2Bridge.address, swapAmount);

                // Mint tokens to userC for the swap
                await mockToken.write.mint([userC.account.address, expectedTokenAmount]);

                // Approve L2Bridge to spend tokens
                await mockToken.write.approve([l2Bridge.address, expectedTokenAmount], { account: userC.account.address });

                // Complete request swap
                await impersonateAccount(l1Bridge.address);
                await setBalance(l1Bridge.address, parseEther("10.0"));

                const hash = await l2Bridge.write.completeRequestSwap([
                    userA.account.address,
                    swapAmount,
                    zeroAddress,
                    tokenAddress,
                    expectedTokenAmount,
                    userNonce,
                    expiry
                ], { account: l1Bridge.address });
                await publicClient.waitForTransactionReceipt({ hash });

                await stopImpersonatingAccount(l1Bridge.address);

                // Fill swap from userB (not userB)
                const fillHash = await l2Bridge.write.fillSwap([
                    userA.account.address,
                    swapAmount,
                    zeroAddress,
                    tokenAddress,
                    expectedTokenAmount,
                    userNonce,
                    expiry
                ], { account: userC.account.address });
                await publicClient.waitForTransactionReceipt({ hash: fillHash });

                // Check swap status is Filled
                const swapStatus = await l2Bridge.read.swapStatus([zeroUserBMessageHash]);
                expect(swapStatus).to.equal(2n); // 2 = Filled
            });
        });

        describe("CancelExpiredSwap", () => {
            const swapAmount = parseEther("1.0");
            const expectedTokenAmount = parseEther("1000.0");
            const userNonce = 0n;
            let mockToken: any;
            let tokenAddress: `0x${string}` = "0x0000000000000000000000000000000000000000" as `0x${string}`;
            let messageHash: string;

            interface L2BridgeWithExpiredSwapFixture {
                l1Bridge: any;
                l2Bridge: any;
                mockToken: any;
                owner: any;
                userA: any;
                userB: any;
                publicClient: any;
                expiry: bigint;
            }

            async function deployL2BridgeWithExpiredSwapFixture(): Promise<L2BridgeWithExpiredSwapFixture> {
                const fixture = await loadFixture(deployL2BridgeFixture);
                const { l1Bridge, l2Bridge, owner, userA, userB, publicClient } = fixture;
                const expiry = BigInt(currentTimestamp - 3600); // 1 hour ago (expired)

                // Set contract balance directly for ETH swaps
                await setBalance(l2Bridge.address, swapAmount);

                // Deploy a mock ERC20 token
                mockToken = await hre.viem.deployContract("MockERC20", ["Mock Token", "MTK", 18]);
                tokenAddress = mockToken.address as `0x${string}`;

                // Complete request swap
                await impersonateAccount(l1Bridge.address);
                await setBalance(l1Bridge.address, parseEther("10.0"));

                const hash = await l2Bridge.write.completeRequestSwap([
                    userA.account.address,
                    swapAmount,
                    userB.account.address,
                    tokenAddress,
                    expectedTokenAmount,
                    userNonce,
                    expiry
                ], { account: l1Bridge.address });
                await publicClient.waitForTransactionReceipt({ hash });

                await stopImpersonatingAccount(l1Bridge.address);

                // Compute the message hash
                messageHash = keccak256(
                    encodeAbiParameters(
                        parseAbiParameters("address, uint256, address, address, uint256, uint256, uint64"),
                        [userA.account.address, swapAmount, userB.account.address, tokenAddress, expectedTokenAmount, userNonce, expiry]
                    )
                );

                return {
                    l1Bridge,
                    l2Bridge,
                    mockToken,
                    owner,
                    userA,
                    userB,
                    publicClient,
                    expiry
                };
            }

            it("should cancel expired swap and initiate ETH withdrawal", async () => {
                const fixture = await loadFixture(deployL2BridgeWithExpiredSwapFixture);
                const { l2Bridge, userA, userB, publicClient, expiry } = fixture;

                // Get initial nonce
                const initialNonce = await l2Bridge.read.userNonces([userA.account.address]);

                // Cancel expired swap
                const hash = await l2Bridge.write.cancelExpiredSwap([
                    userA.account.address,
                    swapAmount,
                    userB.account.address,
                    tokenAddress,
                    expectedTokenAmount,
                    userNonce,
                    expiry
                ], { account: userA.account.address });
                await publicClient.waitForTransactionReceipt({ hash });

                // Check swap status is Expired
                const swapStatus = await l2Bridge.read.swapStatus([messageHash]);
                expect(swapStatus).to.equal(3n); // 3 = Expired

                // Check SwapCancelled event
                const events = await l2Bridge.getEvents.SwapCancelled();
                expect(events).to.have.lengthOf(1);
                const event = events[0];
                expect(event.args.userA?.toLowerCase()).to.equal(userA.account.address.toLowerCase());
                expect(event.args.ETHAmount).to.equal(swapAmount);
                expect(event.args.userB?.toLowerCase()).to.equal(userB.account.address.toLowerCase());
                expect(event.args.token.toLowerCase()).to.equal(tokenAddress.toLowerCase());
                expect(event.args.expectedTokenAmount).to.equal(expectedTokenAmount);
                expect(event.args.nonce).to.equal(userNonce);
                expect(event.args.expiry).to.equal(expiry);
                expect(event.args.messageHash).to.equal(messageHash);

                // Check Withdraw event for userA
                const withdrawEvents = await l2Bridge.getEvents.Withdraw();
                expect(withdrawEvents).to.have.lengthOf(1);
                const withdrawEvent = withdrawEvents[0];
                expect(withdrawEvent.args.user?.toLowerCase()).to.equal(userA.account.address.toLowerCase());
                expect(withdrawEvent.args.token.toLowerCase()).to.equal(getAddress("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE").toLowerCase());
                expect(withdrawEvent.args.amount).to.equal(swapAmount);
                expect(withdrawEvent.args.nonce).to.equal(initialNonce);

                // Check nonce was incremented
                const finalNonce = await l2Bridge.read.userNonces([userA.account.address]);
                expect(finalNonce).to.equal(initialNonce + 1n);
            });

            it("should reject cancelling a non-expired swap", async () => {
                const fixture = await loadFixture(deployL2BridgeWithExpiredSwapFixture);
                const { l1Bridge, l2Bridge, userA, userB, publicClient } = fixture;

                // Try to cancel with future expiry
                const futureExpiry = BigInt(currentTimestamp + 3600); // 1 hour in the future

                // First complete request swap with normal expiry
                await impersonateAccount(l1Bridge.address);
                await setBalance(l1Bridge.address, parseEther("10.0"));

                const hash = await l2Bridge.write.completeRequestSwap([
                    userA.account.address,
                    swapAmount,
                    userB.account.address,
                    tokenAddress,
                    expectedTokenAmount,
                    userNonce,
                    futureExpiry
                ], { account: l1Bridge.address });
                await publicClient.waitForTransactionReceipt({ hash });

                await stopImpersonatingAccount(l1Bridge.address);

                await expect(
                    l2Bridge.write.cancelExpiredSwap([
                        userA.account.address,
                        swapAmount,
                        userB.account.address,
                        tokenAddress,
                        expectedTokenAmount,
                        userNonce,
                        futureExpiry
                    ], { account: userA.account.address })
                ).to.be.rejectedWith("Swap has not expired yet");
            });

            it("should reject cancelling a non-existent swap", async () => {
                const fixture = await loadFixture(deployL2BridgeWithExpiredSwapFixture);
                const { l2Bridge, userA, userB, expiry } = fixture;

                // Try to cancel with different parameters to create a different message hash
                const differentAmount = swapAmount + 1n;

                await expect(
                    l2Bridge.write.cancelExpiredSwap([
                        userA.account.address,
                        differentAmount,
                        userB.account.address,
                        tokenAddress,
                        expectedTokenAmount,
                        userNonce,
                        expiry
                    ], { account: userA.account.address })
                ).to.be.rejectedWith("Swap not found or not open");
            });

            it("should reject cancelling an already filled swap", async () => {
                const fixture = await loadFixture(deployL2BridgeWithExpiredSwapFixture);
                const { l1Bridge, l2Bridge, userA, userB, publicClient } = fixture;

                const futureExpiry = BigInt(currentTimestamp + 3600); // 1 hour in the future

                // First complete request swap with normal expiry
                await impersonateAccount(l1Bridge.address);
                await setBalance(l1Bridge.address, parseEther("10.0"));

                const hash = await l2Bridge.write.completeRequestSwap([
                    userA.account.address,
                    swapAmount,
                    userB.account.address,
                    tokenAddress,
                    expectedTokenAmount,
                    userNonce,
                    futureExpiry
                ], { account: l1Bridge.address });
                await publicClient.waitForTransactionReceipt({ hash });

                await stopImpersonatingAccount(l1Bridge.address);

                // First fill the swap
                await mockToken.write.mint([userB.account.address, expectedTokenAmount]);
                await mockToken.write.approve([l2Bridge.address, expectedTokenAmount], { account: userB.account.address });

                const fillHash = await l2Bridge.write.fillSwap([
                    userA.account.address,
                    swapAmount,
                    userB.account.address,
                    tokenAddress,
                    expectedTokenAmount,
                    userNonce,
                    futureExpiry
                ], { account: userB.account.address });
                await publicClient.waitForTransactionReceipt({ hash: fillHash });

                // Try to cancel the filled swap
                await expect(
                    l2Bridge.write.cancelExpiredSwap([
                        userA.account.address,
                        swapAmount,
                        userB.account.address,
                        tokenAddress,
                        expectedTokenAmount,
                        userNonce,
                        futureExpiry
                    ], { account: userA.account.address })
                ).to.be.rejectedWith("Swap not found or not open");
            });
        });
    });
}); 