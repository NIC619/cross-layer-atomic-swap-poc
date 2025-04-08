# Cross-Layer Atomic Swap POC

## Design Explanation and Implementation Notes

### No preconfirmation of deposit or swap request on L1

Since users send L1 transactions to interact with the contracts directly, there's no preconfirmation of the deposit or swap request on L1. This can also prevent the sequencer from gatekeeping the users' interaction with the contracts on L1.

### Use ETH-carrying transaction to simulate system transaction of deposit and swap request completion

System transaction derived from the deposit swap request messages will create ETH, representing the ETH locked on `L1Bridge` contract. I use an ETH-carrying transaction to simulate such system transaction.

### Atomic swap is essentially a deposit, an (optional) exchange and a withdraw to userA

UserA's ETH is deposited from L1, then waiting to be filled. If filled or expired, token or ETH will be withdrawn to userA, ensuring atomicity.

### Sequencership is passed on to the next sequencer

No owner or governance role is introduced to manage the sequencer role to keep it simple.

### Unclear trust assumptions on the sequencer

The sequencer on one hand is in charge of preconfirmation for the messages to be successfully processed on L2. On the other hand, I made it so that users' interaction with the contracts on L1 is not preconfirmed to prevent the sequencer from gatekeeping. With the introduction of the preconfirmation feature, the system seems inevitable to trust the sequencer.

### Merklize the message hashes to be proven

Merklizing the message hashes can save the prover from uploading every message hash. The merklization can be done by L2 node.

### Anyone can cancel an expired swap request

Though sequencer will do the duty but anyone can cancel an expired swap request in case sequencer is down.

### Anyone can be a prover

Anyone can generate a proof for a withdrawal message and submit it to the `L1Bridge` contract.

### Sequencer in the simulation script

There's a `L1Monitor` instance which monitors for deposits and swap requests events from `L1Bridge` contract and `Sequencer` instance will periodically fetch the events, preconfirm them and send system transactions to process them. `Sequencer` instance also keeps track of the unfilled swaps and cancel the expired ones.

---

## Security Considerations

### Sequencer censorship

The sequencer can stop a deposit or swap request from being processed by not preconfirming the message.

### Timestamp manipulation

The sequencer is in charge of block production and can manipulate the timestamp to an extent, to delay the expiration of a swap request or to make a swap request expired earlier.

### Counterparty of the swap has the option to fill the swap or not

The counterparty of the swap has the option to fill the swap or not, depending on the exchange rate at that moment.
