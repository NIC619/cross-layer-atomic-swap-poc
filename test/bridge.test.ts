import { expect } from "chai";
import hre from "hardhat";
import { setBalance, loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { encodeAbiParameters, parseAbiParameters, getAddress, parseEther, keccak256 } from "viem";

describe("Bridge Contracts", () => {
    describe("L1Bridge", () => {
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

        describe("Withdraw", () => {
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

            it("should reject withdrawal with zero address", async () => {
                const { l1Bridge, publicClient } = await loadFixture(deployL1BridgeFixture);
                const withdrawMessageHash = keccak256(
                    encodeAbiParameters(
                        parseAbiParameters("address, uint256, uint256"),
                        ["0x0000000000000000000000000000000000000000", depositAmount, userL2Nonce]
                    )
                );

                await expect(
                    l1Bridge.write.completeWithdraw([
                        "0x0000000000000000000000000000000000000000",
                        depositAmount,
                        userL2Nonce,
                        withdrawMessageHash
                    ])
                ).to.be.rejectedWith("Invalid user address");
            });

            it("should reject withdrawal with zero amount", async () => {
                const { l1Bridge, user, publicClient } = await loadFixture(deployL1BridgeFixture);
                const withdrawMessageHash = keccak256(
                    encodeAbiParameters(
                        parseAbiParameters("address, uint256, uint256"),
                        [user.account.address, 0n, userL2Nonce]
                    )
                );

                await expect(
                    l1Bridge.write.completeWithdraw([
                        user.account.address,
                        0n,
                        userL2Nonce,
                        withdrawMessageHash
                    ])
                ).to.be.rejectedWith("Amount must be greater than 0");
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

    // Placeholder for future L2Bridge tests
    describe("L2Bridge", () => {
        // Tests will be added here
    });
}); 