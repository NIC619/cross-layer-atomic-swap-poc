import { expect } from "chai";
import hre from "hardhat";
import { impersonateAccount, stopImpersonatingAccount, setBalance, loadFixture, time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { encodeAbiParameters, parseAbiParameters, getAddress, parseEther, keccak256 } from "viem";

describe("Bridge Contracts", () => {
    describe("L1Bridge", () => {
        let currentTimestamp: number;

        before(async () => {
            // Hardhat testnet somehow set the block timestamp to one year later so can not override it but to read and use it
            currentTimestamp = await time.latest();
        });

        async function deployL1BridgeFixture() {
            // Get signers
            const [owner, user, otherUser] = await hre.viem.getWalletClients();
            const publicClient = await hre.viem.getPublicClient();

            // Deploy the contract
            const l1Bridge = await hre.viem.deployContract("L1Bridge");

            return {
                l1Bridge,
                owner,
                user,
                otherUser,
                publicClient
            };
        }

        describe("Deposit", () => {
            it("should accept ETH deposit and increment user nonce", async () => {
                const { l1Bridge, user, publicClient } = await loadFixture(deployL1BridgeFixture);
                const depositAmount = parseEther("1.0");

                // Deposit using viem
                const hash = await l1Bridge.write.deposit({ account: user.account.address, value: depositAmount });
                await publicClient.waitForTransactionReceipt({ hash });

                // Check user nonce
                const nonce = await l1Bridge.read.userNonces([user.account.address]);
                expect(nonce).to.equal(1n);
            });

            it("should reject zero deposit", async () => {
                const { l1Bridge, user } = await loadFixture(deployL1BridgeFixture);

                await expect(
                    l1Bridge.write.deposit({ account: user.account.address, value: 0n })
                ).to.be.rejectedWith("Zero deposit amount");
            });

            it("should increment nonce correctly for multiple deposits", async () => {
                const { l1Bridge, user, publicClient } = await loadFixture(deployL1BridgeFixture);
                const depositAmount = parseEther("1.0");

                // Make multiple deposits
                for (let i = 0; i < 3; i++) {
                    const hash = await l1Bridge.write.deposit({ account: user.account.address, value: depositAmount });
                    await publicClient.waitForTransactionReceipt({ hash });
                }

                // Check user nonce
                const nonce = await l1Bridge.read.userNonces([user.account.address]);
                expect(nonce).to.equal(3n);
            });
        });

        describe("RequestSwap", () => {
            it("should accept valid swap request, increment user nonce, and emit correct event", async () => {
                const { l1Bridge, user, otherUser, publicClient } = await loadFixture(deployL1BridgeFixture);
                const swapAmount = parseEther("1.0");
                const expiry = BigInt(currentTimestamp + 3600); // 1 hour from now
                const tokenAddress = "0x1234567890123456789012345678901234567890";
                const expectedTokenAmount = parseEther("1000.0");

                // Request swap using viem
                const hash = await l1Bridge.write.requestSwap([
                    expiry,
                    otherUser.account.address,
                    tokenAddress,
                    expectedTokenAmount
                ], { account: user.account.address, value: swapAmount });
                await publicClient.waitForTransactionReceipt({ hash });

                // Check user nonce
                const nonce = await l1Bridge.read.userNonces([user.account.address]);
                expect(nonce).to.equal(1n);

                // Get the RequestSwap events
                const requestSwapEvents = await l1Bridge.getEvents.RequestSwap();
                expect(requestSwapEvents).to.have.lengthOf(1);
                const event = requestSwapEvents[0];
                expect(event.args.userA?.toLowerCase()).to.equal(user.account.address.toLowerCase());
                expect(event.args.ETHAmount).to.equal(swapAmount);
                expect(event.args.userB?.toLowerCase()).to.equal(otherUser.account.address.toLowerCase());
                expect(event.args.token).to.equal(tokenAddress);
                expect(event.args.expectedTokenAmount).to.equal(expectedTokenAmount);
                expect(event.args.nonce).to.equal(0n);
                expect(event.args.expiry).to.equal(expiry);
            });

            it("should reject zero swap amount", async () => {
                const { l1Bridge, user, otherUser } = await loadFixture(deployL1BridgeFixture);
                const expiry = BigInt(currentTimestamp + 3600);
                const tokenAddress = "0x1234567890123456789012345678901234567890";
                const expectedTokenAmount = parseEther("1000.0");

                await expect(
                    l1Bridge.write.requestSwap([
                        expiry,
                        otherUser.account.address,
                        tokenAddress,
                        expectedTokenAmount
                    ], { account: user.account.address, value: 0n })
                ).to.be.rejectedWith("Zero swap amount");
            });

            it("should reject expired timestamp", async () => {
                const { l1Bridge, user, otherUser } = await loadFixture(deployL1BridgeFixture);
                const swapAmount = parseEther("1.0");
                const expiredTime = BigInt(currentTimestamp - 3600); // 1 hour ago
                const tokenAddress = "0x1234567890123456789012345678901234567890";
                const expectedTokenAmount = parseEther("1000.0");

                await expect(
                    l1Bridge.write.requestSwap([
                        expiredTime,
                        otherUser.account.address,
                        tokenAddress,
                        expectedTokenAmount
                    ], { account: user.account.address, value: swapAmount })
                ).to.be.rejectedWith("Expiry must be in the future");
            });

            it("should reject zero address for token", async () => {
                const { l1Bridge, user, otherUser } = await loadFixture(deployL1BridgeFixture);
                const swapAmount = parseEther("1.0");
                const expiry = BigInt(currentTimestamp + 3600);
                const expectedTokenAmount = parseEther("1000.0");

                await expect(
                    l1Bridge.write.requestSwap([
                        expiry,
                        otherUser.account.address,
                        "0x0000000000000000000000000000000000000000",
                        expectedTokenAmount
                    ], { account: user.account.address, value: swapAmount })
                ).to.be.rejectedWith("Invalid token address");
            });

            it("should reject zero expected token amount", async () => {
                const { l1Bridge, user, otherUser } = await loadFixture(deployL1BridgeFixture);
                const swapAmount = parseEther("1.0");
                const expiry = BigInt(currentTimestamp + 3600);
                const tokenAddress = "0x1234567890123456789012345678901234567890";

                await expect(
                    l1Bridge.write.requestSwap([
                        expiry,
                        otherUser.account.address,
                        tokenAddress,
                        0n
                    ], { account: user.account.address, value: swapAmount })
                ).to.be.rejectedWith("Zero token amount");
            });

            it("should reject self-swap", async () => {
                const { l1Bridge, user } = await loadFixture(deployL1BridgeFixture);
                const swapAmount = parseEther("1.0");
                const expiry = BigInt(currentTimestamp + 3600);
                const tokenAddress = "0x1234567890123456789012345678901234567890";
                const expectedTokenAmount = parseEther("1000.0");

                await expect(
                    l1Bridge.write.requestSwap([
                        expiry,
                        user.account.address,
                        tokenAddress,
                        expectedTokenAmount
                    ], { account: user.account.address, value: swapAmount })
                ).to.be.rejectedWith("Cannot swap with yourself");
            });
        });

        describe("Prove", () => {
            it("should verify proof and register withdraw message hashes", async () => {
                const { l1Bridge, owner, user, publicClient } = await loadFixture(deployL1BridgeFixture);
                const proof = "0x" as `0x${string}`;
                const withdrawMessageHash = keccak256(
                    encodeAbiParameters(
                        parseAbiParameters("address, uint256, uint256"),
                        [user.account.address, parseEther("1.0"), 0n]
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
                const { l1Bridge, owner, user, otherUser, publicClient } = await loadFixture(deployL1BridgeFixture);
                const proof = "0x" as `0x${string}`;
                const withdrawMessageHashes = [
                    keccak256(
                        encodeAbiParameters(
                            parseAbiParameters("address, uint256, uint256"),
                            [user.account.address, parseEther("1.0"), 0n]
                        )
                    ),
                    keccak256(
                        encodeAbiParameters(
                            parseAbiParameters("address, uint256, uint256"),
                            [otherUser.account.address, parseEther("2.0"), 0n]
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

            it("should allow user to withdraw with valid parameters", async () => {
                const { l1Bridge, user, publicClient } = await loadFixture(deployL1BridgeFixture);

                // Set contract balance directly instead of making a deposit
                await setBalance(l1Bridge.address, depositAmount);

                const withdrawMessageHash = keccak256(
                    encodeAbiParameters(
                        parseAbiParameters("address, uint256, uint256"),
                        [user.account.address, depositAmount, userL2Nonce]
                    )
                );

                const proveHash = await l1Bridge.write.prove(["0x" as `0x${string}`, [withdrawMessageHash]]);
                await publicClient.waitForTransactionReceipt({ hash: proveHash });

                const initialBalance = await publicClient.getBalance({ address: user.account.address });

                // Withdraw using viem
                const hash = await l1Bridge.write.completeWithdraw([
                    user.account.address,
                    depositAmount,
                    userL2Nonce,
                    withdrawMessageHash
                ]);

                await publicClient.waitForTransactionReceipt({ hash });

                const finalBalance = await publicClient.getBalance({ address: user.account.address });
                expect(finalBalance - initialBalance).to.equal(depositAmount);
            });

            it("should reject withdrawal of unverified message hash", async () => {
                const { l1Bridge, user } = await loadFixture(deployL1BridgeFixture);

                // Set contract balance directly
                await setBalance(l1Bridge.address, depositAmount);

                const unverifiedHash = keccak256(
                    encodeAbiParameters(
                        parseAbiParameters("address, uint256, uint256"),
                        [user.account.address, depositAmount, userL2Nonce + 1n]
                    )
                );

                await expect(
                    l1Bridge.write.completeWithdraw([
                        user.account.address,
                        depositAmount,
                        userL2Nonce + 1n,
                        unverifiedHash
                    ])
                ).to.be.rejectedWith("Withdrawal not verified");
            });

            it("should prevent double withdrawal", async () => {
                const { l1Bridge, user, publicClient } = await loadFixture(deployL1BridgeFixture);

                // Set contract balance directly
                await setBalance(l1Bridge.address, depositAmount);

                const withdrawMessageHash = keccak256(
                    encodeAbiParameters(
                        parseAbiParameters("address, uint256, uint256"),
                        [user.account.address, depositAmount, userL2Nonce]
                    )
                );

                const proveHash = await l1Bridge.write.prove(["0x" as `0x${string}`, [withdrawMessageHash]]);
                await publicClient.waitForTransactionReceipt({ hash: proveHash });

                // First withdrawal
                const hash1 = await l1Bridge.write.completeWithdraw([
                    user.account.address,
                    depositAmount,
                    userL2Nonce,
                    withdrawMessageHash
                ]);

                await publicClient.waitForTransactionReceipt({ hash: hash1 });

                // Second withdrawal should fail
                await expect(
                    l1Bridge.write.completeWithdraw([
                        user.account.address,
                        depositAmount,
                        userL2Nonce,
                        withdrawMessageHash
                    ])
                ).to.be.rejectedWith("Withdrawal already claimed");
            });

            it("should reject withdrawal with mismatched parameters", async () => {
                const { l1Bridge, user, publicClient } = await loadFixture(deployL1BridgeFixture);

                // Set contract balance directly
                await setBalance(l1Bridge.address, depositAmount);

                const withdrawMessageHash = keccak256(
                    encodeAbiParameters(
                        parseAbiParameters("address, uint256, uint256"),
                        [user.account.address, depositAmount, userL2Nonce]
                    )
                );

                const proveHash = await l1Bridge.write.prove(["0x" as `0x${string}`, [withdrawMessageHash]]);
                await publicClient.waitForTransactionReceipt({ hash: proveHash });

                const invalidAmount = depositAmount + 1n;
                await expect(
                    l1Bridge.write.completeWithdraw([
                        user.account.address,
                        invalidAmount,
                        userL2Nonce,
                        withdrawMessageHash
                    ])
                ).to.be.rejectedWith("Invalid withdrawal parameters");
            });
        });
    });

    describe("L2Bridge", () => {
        async function deployL2BridgeFixture() {
            // Get signers
            const [owner, user, otherUser] = await hre.viem.getWalletClients();
            const publicClient = await hre.viem.getPublicClient();

            // Deploy L1Bridge first
            const l1Bridge = await hre.viem.deployContract("L1Bridge");

            // Deploy L2Bridge with L1Bridge address
            const l2Bridge = await hre.viem.deployContract("L2Bridge", [l1Bridge.address]);

            return {
                l1Bridge,
                l2Bridge,
                owner,
                user,
                otherUser,
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

            it("should complete deposit and transfer ETH to user", async () => {
                const { l1Bridge, l2Bridge, user, publicClient } = await loadFixture(deployL2BridgeFixture);

                // Set contract balance directly
                await setBalance(l2Bridge.address, depositAmount);

                // Compute the message hash
                const messageHash = keccak256(
                    encodeAbiParameters(
                        parseAbiParameters("address, uint256, uint256"),
                        [user.account.address, depositAmount, userNonce]
                    )
                );

                const initialBalance = await publicClient.getBalance({ address: user.account.address });

                await impersonateAccount(l1Bridge.address);
                await setBalance(l1Bridge.address, parseEther("10.0"));

                // Complete deposit
                const hash = await l2Bridge.write.completeDeposit([
                    user.account.address,
                    depositAmount,
                    userNonce
                ], { account: l1Bridge.address });
                await publicClient.waitForTransactionReceipt({ hash });

                await stopImpersonatingAccount(l1Bridge.address);

                // Check final balance
                const finalBalance = await publicClient.getBalance({ address: user.account.address });
                expect(finalBalance - initialBalance).to.equal(depositAmount);

                // Check message is marked as processed
                const isProcessed = await l2Bridge.read.processedMessages([messageHash]);
                expect(isProcessed).to.be.true;
            });

            // FIXME: Uncomment this test only if the `msg.sender` check is uncommented in `L2Bridge.completeDeposit`
            // it("should reject deposit from non-L1Bridge address", async () => {
            //     const { l2Bridge, user } = await loadFixture(deployL2BridgeFixture);

            //     await expect(
            //         l2Bridge.write.completeDeposit([
            //             user.account.address,
            //             depositAmount,
            //             userNonce
            //         ], { account: user.account.address })
            //     ).to.be.rejectedWith("Only L1Bridge can complete deposits");
            // });

            it("should reject already processed deposits", async () => {
                const { l1Bridge, l2Bridge, user, publicClient } = await loadFixture(deployL2BridgeFixture);

                // Set contract balance directly
                await setBalance(l2Bridge.address, depositAmount);

                // Compute the message hash
                const messageHash = keccak256(
                    encodeAbiParameters(
                        parseAbiParameters("address, uint256, uint256"),
                        [user.account.address, depositAmount, userNonce]
                    )
                );

                await impersonateAccount(l1Bridge.address);
                await setBalance(l1Bridge.address, parseEther("10.0"));

                // First deposit
                const hash1 = await l2Bridge.write.completeDeposit([
                    user.account.address,
                    depositAmount,
                    userNonce
                ], { account: l1Bridge.address });

                await publicClient.waitForTransactionReceipt({ hash: hash1 });

                await expect(
                    l2Bridge.write.completeDeposit([
                        user.account.address,
                        depositAmount,
                        userNonce
                    ], { account: l1Bridge.address })
                ).to.be.rejectedWith("Message already processed");

                await stopImpersonatingAccount(l1Bridge.address);
            });
        });

        describe("Withdraw", () => {
            const withdrawAmount = parseEther("1.0");

            it("should accept ETH withdraw and increment user nonce", async () => {
                const { l2Bridge, user, publicClient } = await loadFixture(deployL2BridgeFixture);

                // Withdraw using viem
                const hash = await l2Bridge.write.withdraw({ account: user.account.address, value: withdrawAmount });
                await publicClient.waitForTransactionReceipt({ hash });

                // Check user nonce
                const nonce = await l2Bridge.read.userNonces([user.account.address]);
                expect(nonce).to.equal(1n);
            });

            it("should reject zero withdraw", async () => {
                const { l2Bridge, user } = await loadFixture(deployL2BridgeFixture);

                await expect(
                    l2Bridge.write.withdraw({ account: user.account.address, value: 0n })
                ).to.be.rejectedWith("Zero withdraw amount");
            });

            it("should increment nonce correctly for multiple withdraws", async () => {
                const { l2Bridge, user, publicClient } = await loadFixture(deployL2BridgeFixture);

                // Make multiple withdraws
                for (let i = 0; i < 3; i++) {
                    const hash = await l2Bridge.write.withdraw({ account: user.account.address, value: withdrawAmount });
                    await publicClient.waitForTransactionReceipt({ hash });
                }

                // Check user nonce
                const nonce = await l2Bridge.read.userNonces([user.account.address]);
                expect(nonce).to.equal(3n);
            });
        });
    });
}); 