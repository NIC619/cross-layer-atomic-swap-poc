# Cross-Layer Atomic Swap POC

This project demonstrates a proof of concept for cross-layer atomic swaps between L1 and L2 networks. It includes contracts for bridging assets between layers, tests for the contracts, and a simulation script to demonstrate the full flow.

## Table of Contents
- [Cross-Layer Atomic Swap POC](#cross-layer-atomic-swap-poc)
  - [Table of Contents](#table-of-contents)
  - [Project Setup](#project-setup)
  - [Running the Simulation](#running-the-simulation)
  - [Project Structure](#project-structure)
  - [Architecture](#architecture)
  - [Design Explanation and Implementation Notes](#design-explanation-and-implementation-notes)
  - [Security Considerations](#security-considerations)

## Project Setup

```shell
# Clone the repository
cd cross-layer-atomic-swap-poc
npm install
npx hardhat compile
npx hardhat test
```

## Running the Simulation

The simulation script demonstrates the full flow of deposits from L1 to L2.

1. Start two local testnets (L1 and L2):
```shell
# L1
npx hardhat node --port 8545
# L2
npx hardhat node --port 8546
```

2. In a separate terminal, run the simulation script:
```shell
npx hardhat run scripts/simulateSwap.ts
```

The simulation will:
- Deploy L1Bridge, L2Bridge and token contracts to their respective networks
- Start monitoring for deposits and swap requests on L1
- Start the sequencer to process deposits and swap requests on L2
- Make a deposit from userA's account on L1
- Preconfirm and process the deposit through the sequencer
- Make a swap request from userA's account on L1
- Preconfirm and process the swap request through the sequencer
- Fill the swap from userB's account on L2
- Process the token withdraw so userA receives the tokens on L1

## Project Structure

- `contracts/`: Contains the L1Bridge and L2Bridge contracts
- `scripts/`: Contains simulation scripts
- `test/`: Contains tests for the contracts

---

## Architecture

[Architecture](./architecture.md)

## Design Explanation and Implementation Notes

[Design Explanation and Implementation Notes](./design_and_security.md#design-explanation-and-implementation-notes)

## Security Considerations

[Security Considerations](./design_and_security.md#security-considerations)
