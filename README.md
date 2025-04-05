# Cross-Layer Atomic Swap POC

This project demonstrates a proof of concept for cross-layer atomic swaps between L1 and L2 networks. It includes contracts for bridging assets between layers, tests for the contracts, and a simulation script to demonstrate the full flow.

## Project Setup

1. Clone the repository:
```shell
git clone <repository-url>
cd cross-layer-atomic-swap-poc
```

2. Install dependencies:
```shell
npm install
```

3. Compile the contracts:
```shell
npx hardhat compile
```

## Running Tests

To run the tests:
```shell
npx hardhat test
```

To run tests with gas reporting:
```shell
REPORT_GAS=true npx hardhat test
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

1. In a separate terminal, run the simulation script:
```shell
npx hardhat run scripts/simulateSwap.ts
```

The simulation will:
- Deploy L1Bridge and L2Bridge contracts to their respective networks
- Start monitoring for deposits on L1
- Start the sequencer to process deposits on L2
- Make a deposit from a user account
- Process the deposit through the sequencer
- Verify the deposit was completed on L2

## Project Structure

- `contracts/`: Contains the L1Bridge and L2Bridge contracts
- `scripts/`: Contains simulation scripts
- `test/`: Contains tests for the contracts
