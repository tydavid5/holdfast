# Holdfast

People set money rules for themselves, then break them in the moment, because no app actually holds them to it.

Holdfast is a savings jar that holds you to your own money rules. It is a Save Mini App for the Nimiq Mini Apps Competition, Cycle III.

## What it does

You create a jar for a goal, fund it in USDT or NIM, and set rules in plain words:

- Never let me take out more than a set amount per withdrawal.
- Never let me take out more than a set amount per day.
- Ask me first above a set amount.
- Only send withdrawals to addresses on my allowlist.

The jar remembers every deposit and withdrawal, and it enforces the rules on every withdrawal attempt. Over the per-withdrawal cap is blocked with a plain-words reason. Over the daily cap is blocked. Above the confirm threshold asks for confirmation first. A destination outside the allowlist is blocked. Every attempt, allowed, blocked or confirmed, is written to a ledger you can see. Real transactions in the ledger link straight to their explorer page, nimiq.watch for NIM and Polygonscan for USDT, so the on-chain proof is one tap away.

You can start over any time: wiping the jar clears the jar, its rules and its ledger from the device, so the whole flow can be run again from scratch. Your funds stay in your own wallet, nothing moves on chain.

## How it works, honestly

Your jar keeps funds in your own wallet. Depositing sends a real transaction to your own jar address, which is the on-chain record of the deposit. Withdrawing sends real funds out, and only after the rules pass.

The rules are enforced by this app before any transaction is requested, not by a smart contract. There is no contract holding your money and no lock on chain. If you spend the same funds outside this app, the jar cannot stop you. What the jar does is make every withdrawal through this app pass your own rules first.

No transaction hash is shown unless a real transaction returns one. In demo mode every balance is simulated and nothing moves on chain.

## How to run

```bash
npm install
npm run dev
```

Open http://localhost:5173. To build for production:

```bash
npm run build
npm run preview
```

Node 22 or newer is required. The app is a Vite, React and TypeScript single page, mobile first, built to run inside the Nimiq Pay app.

## Demo mode

Open the app in a plain browser and it runs in clearly labelled demo mode, with a demo wallet and simulated balances. You can create a jar, set rules, deposit, and try a withdrawal that gets blocked, all without a wallet or any funds. Nothing leaves your device.

## The live Nimiq Pay path

Inside Nimiq Pay, the app connects through the official `@nimiq/mini-app-sdk` (pinned to exactly 0.2.5). It calls `init()` to wait for the provider, then `listAccounts()` to find your wallet. NIM goes through the Nimiq provider (`sendBasicTransaction`, balances in luna). USDT on Polygon goes through the injected `window.ethereum` provider as an ERC-20 transfer. Every sensitive action goes through Nimiq Pay's native confirmation dialog, and keys never leave the wallet.

- NIM works on mainnet and testnet.
- USDT on Polygon mainnet uses the verified contract `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`.
- Polygon Amoy has no official Tether USDT, so testnet USDT uses a public mock token (`0x164F5A056166d8F2ce09FdAc6d040209a8C94d01`) labelled as a mock in the app, with a button to mint 100 test tokens to your address.

The app defaults to testnet in live mode. It never requests a mainnet transaction unless you turn on the "Allow mainnet transactions" switch in the Wallet section. The switch is off by default.

Open the hosted app inside Nimiq Pay with a deep link:

```text
nimiqpay://miniapp?url=your-app.com
https://nimpay.app/miniapps/open/your-app.com
```

## Consent and data handling

- No video is stored. The app does not use a camera at all.
- No data leaves your device except the transactions you approve in Nimiq Pay.
- Your jar, rules and ledger are saved in your browser's local storage only. Nothing is sent to a server. There is no telemetry.
- The app asks Nimiq Pay for your wallet address so it can show your balance and send transactions you approve. It never sees your private keys.
- Amounts are for personal saving only. Holdfast does not give financial advice, and it does not diagnose or treat anything.

## Competition

Built for the Nimiq Mini Apps Competition, Cycle III, Save category. Public repo: https://github.com/tydavid5/holdfast

License: MIT.
