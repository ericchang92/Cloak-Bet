# Cloak-Bet

A two-player, privacy-first card duel built on Zama FHEVM. Players create or join a game, receive encrypted cards, and
reveal only what they choose to play. The smart contract compares encrypted values and returns an encrypted boolean
result so the outcome is verifiable without exposing full hands.

## Overview

Cloak-Bet solves a common on-chain game dilemma: how to make gameplay verifiable while keeping each player's hand secret.
By using fully homomorphic encryption (FHE), cards are dealt and stored encrypted, enabling private decision-making and
on-chain resolution without a centralized dealer or off-chain trust.

## Key Features

- Two-player game flow: create, join, start, play.
- Standard 52-card deck (4 suits, 13 ranks).
- Each player receives 6 encrypted cards, dealt with Zama randomness.
- Players decrypt only their own cards to choose a move.
- On-chain comparison returns an encrypted boolean result.
- No server-side custody of hands or outcomes.

## Advantages

- **Privacy by design**: hands remain encrypted on-chain until the owner decrypts them locally.
- **Trust minimization**: no centralized dealer or backend required for fairness.
- **Verifiable outcomes**: encrypted comparison produces a deterministic, auditable result.
- **User-controlled reveal**: players choose when and what to decrypt.
- **Composable architecture**: contract logic is independent of UI, enabling future front ends.

## Problem It Solves

Traditional blockchain games leak private state or rely on off-chain relayers. Cloak-Bet keeps gameplay private while
remaining transparent and verifiable. It demonstrates how FHE enables competitive, fair, and censorship-resistant card
games without revealing the full game state to the public chain.

## How It Works

1. A player creates a game.
2. A second player joins an open game.
3. Once the game is full, either player starts it.
4. The contract shuffles and deals 6 encrypted cards to each player using Zama randomness.
5. Each player locally decrypts their own hand, selects one card, and submits the encrypted play.
6. The contract compares the encrypted values and returns an encrypted boolean result.

## Tech Stack

- **Smart contracts**: Solidity + Hardhat
- **FHE layer**: Zama FHEVM
- **Front end**: React + Vite (no Tailwind)
- **Wallet**: RainbowKit
- **RPC + reads**: viem
- **Writes**: ethers
- **Package manager**: npm

## Repository Structure

```
contracts/        # Smart contracts
deploy/           # Deployment scripts
deployments/      # Network artifacts and ABIs
tasks/            # Hardhat tasks
test/             # Contract tests
frontend/         # React + Vite front end
```

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Install

```bash
npm install
```

### Compile and Test

```bash
npm run compile
npm run test
```

### Deploy Locally (Contract-Only)

```bash
npx hardhat node
npx hardhat deploy --network localhost
```

### Deploy to Sepolia

```bash
npx hardhat deploy --network sepolia
```

### Front End Notes

- The front end reads on-chain data with viem and submits transactions with ethers.
- The front end is configured to use Sepolia and does not connect to a localhost chain.
- ABI files must be copied from `deployments/sepolia` into the front end as the source of truth.

## Usage Flow

1. Connect a wallet.
2. Create a new game or join an open game.
3. Start the game once two players are present.
4. Decrypt your hand locally and pick a card to play.
5. Submit your play and view the encrypted result.

## Security and Privacy Considerations

- Only the card owner can decrypt their hand.
- The contract never stores plaintext card values.
- The comparison result is encrypted to avoid revealing full game state.

## Future Roadmap

- Multi-round matches with score tracking.
- Matchmaking and lobby discovery UX.
- Spectator mode with opt-in reveals.
- Tournament brackets and seasonal ladders.
- Gas optimization and batch actions.
- Formal audits and invariant testing.
- Mobile-first UI and accessibility upgrades.
- Cross-chain deployments and L2 support.

## License

BSD-3-Clause-Clear
