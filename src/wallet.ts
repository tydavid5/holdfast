// Holdfast - wallet layer.
// Talks to Nimiq Pay through the official @nimiq/mini-app-sdk and to the
// EVM side through the injected window.ethereum provider. If no provider is
// present (plain browser), the app runs in clearly labelled demo mode and
// never crashes.

import {
  getHostNetwork,
  init,
  type NimiqProvider,
} from "@nimiq/mini-app-sdk";
import type { Currency } from "./store";

export type WalletMode = "live" | "demo";
export type Network = "mainnet" | "testnet";

export interface WalletInfo {
  mode: WalletMode;
  address: string | null;
  evmAddress: string | null;
  network: Network | null;
  nimBalance: number | null;
  usdtBalance: number | null;
  error: string | null;
}

export const DEMO_NIM_ADDRESS = "NQ09 0000 0000 0000 0000 0000 0000 0000 0000";
export const DEMO_EVM_ADDRESS = "0x0000000000000000000000000000000000000001";
export const DEMO_BALANCE = 1000;

// USDT on Polygon mainnet, 6 decimals. Verified against several public
// contract listings on 2026-11-07.
export const USDT_POLYGON_MAINNET = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
// Polygon Amoy has no official Tether USDT. This is a public mock token with
// a permissionless mint, used only on testnet and labelled as a mock in the UI.
export const USDT_AMOY_MOCK = "0x164F5A056166d8F2ce09FdAc6d040209a8C94d01";
export const USDT_DECIMALS = 6;

const POLYGON_MAINNET_CHAIN = 137;
const POLYGON_AMOY_CHAIN = 80002;

const ERC20_TRANSFER = "0xa9059cbb";
const ERC20_BALANCE_OF = "0x70a08231";
const ERC20_DECIMALS = "0x313ce567";
const ERC20_MINT = "0x40c10f19";

let nimiqProvider: NimiqProvider | null = null;

function isErrorResponse(value: unknown): value is { error: { message: string } } {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "object"
  );
}

function hexPad32(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return clean.padStart(64, "0");
}

function toHex(value: bigint): string {
  return "0x" + value.toString(16);
}

function evmProvider(): { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } | null {
  const eth = (window as unknown as { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
  return eth ?? null;
}

export function usdtContractFor(network: Network | null): string | null {
  if (network === "mainnet") return USDT_POLYGON_MAINNET;
  if (network === "testnet") return USDT_AMOY_MOCK;
  return null;
}

export function usdtLabelFor(network: Network | null): string {
  if (network === "mainnet") return "USDT on Polygon";
  if (network === "testnet") return "Test USDT (mock token on Amoy)";
  return "USDT";
}

// Explorer URL for a transaction reference, so the ledger can link straight
// to the on-chain proof. Nimiq uses nimiq.watch (test.nimiq.watch on
// testnet) with the hash after a #, Polygon uses Polygonscan / Amoy Polygonscan.
export function explorerUrlFor(
  currency: Currency,
  network: Network | null,
  ref: string,
): string {
  if (currency === "NIM") {
    return network === "testnet"
      ? `https://test.nimiq.watch/#${ref}`
      : `https://nimiq.watch/#${ref}`;
  }
  return network === "testnet"
    ? `https://amoy.polygonscan.com/tx/${ref}`
    : `https://polygonscan.com/tx/${ref}`;
}

export async function connectWallet(): Promise<WalletInfo> {
  const demo: WalletInfo = {
    mode: "demo",
    address: DEMO_NIM_ADDRESS,
    evmAddress: DEMO_EVM_ADDRESS,
    network: "testnet",
    nimBalance: DEMO_BALANCE,
    usdtBalance: DEMO_BALANCE,
    error: null,
  };

  try {
    // init() waits for the Nimiq provider. A short timeout keeps a plain
    // browser from hanging before it falls back to demo mode.
    const provider = await init({ timeout: 4000 });
    nimiqProvider = provider;
    const network = getHostNetwork() ?? "mainnet";
    let accounts: string[] = [];
    try {
      const listed = await provider.listAccounts();
      if (Array.isArray(listed)) accounts = listed;
    } catch {
      accounts = [];
    }
    const address = accounts.length > 0 ? accounts[0] : null;

    let nimBalance: number | null = null;
    if (address) {
      try {
        const luna = await provider.getBalance(address);
        if (typeof luna === "number") nimBalance = luna / 100000;
      } catch {
        nimBalance = null;
      }
    }

    const evm = evmProvider();
    let evmAddress: string | null = null;
    let usdtBalance: number | null = null;
    if (evm) {
      try {
        const accs = (await evm.request({ method: "eth_requestAccounts" })) as string[];
        if (Array.isArray(accs) && accs.length > 0) {
          evmAddress = accs[0];
          const contract = usdtContractFor(network);
          if (contract) {
            const data = "0x" + ERC20_BALANCE_OF + hexPad32(evmAddress);
            const raw = (await evm.request({
              method: "eth_call",
              params: [{ to: contract, data }, "latest"],
            })) as string;
            usdtBalance = Number(BigInt(raw)) / 10 ** USDT_DECIMALS;
          }
        }
      } catch {
        evmAddress = null;
        usdtBalance = null;
      }
    }

    return {
      mode: "live",
      address,
      evmAddress,
      network,
      nimBalance,
      usdtBalance,
      error: address ? null : "Connected to Nimiq Pay, but no account was shared.",
    };
  } catch {
    return demo;
  }
}

export function getNimiqProvider(): NimiqProvider | null {
  return nimiqProvider;
}

export async function refreshBalances(
  currency: Currency,
  address: string | null,
  evmAddress: string | null,
  network: Network | null,
): Promise<{ nimBalance: number | null; usdtBalance: number | null }> {
  let nimBalance: number | null = null;
  let usdtBalance: number | null = null;
  if (currency === "NIM" && nimiqProvider && address) {
    try {
      const luna = await nimiqProvider.getBalance(address);
      if (typeof luna === "number") nimBalance = luna / 100000;
    } catch {
      nimBalance = null;
    }
  }
  if (currency === "USDT" && evmAddress) {
    const evm = evmProvider();
    const contract = usdtContractFor(network);
    if (evm && contract) {
      try {
        const data = "0x" + ERC20_BALANCE_OF + hexPad32(evmAddress);
        const raw = (await evm.request({
          method: "eth_call",
          params: [{ to: contract, data }, "latest"],
        })) as string;
        usdtBalance = Number(BigInt(raw)) / 10 ** USDT_DECIMALS;
      } catch {
        usdtBalance = null;
      }
    }
  }
  return { nimBalance, usdtBalance };
}

export interface TxOutcome {
  ok: boolean;
  ref: string | null;
  error: string | null;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "The wallet request failed.";
}

// Send NIM from the connected wallet. The recipient is the jar address.
// Nimiq Pay shows a native confirmation dialog; the user approves it there.
export async function sendNim(recipient: string, amountNim: number): Promise<TxOutcome> {
  if (!nimiqProvider) {
    return { ok: false, ref: null, error: "No Nimiq provider. Open this app inside Nimiq Pay." };
  }
  const value = Math.round(amountNim * 100000);
  if (value <= 0) {
    return { ok: false, ref: null, error: "Amount must be above zero." };
  }
  try {
    const result = await nimiqProvider.sendBasicTransaction({ recipient, value });
    if (isErrorResponse(result)) {
      return { ok: false, ref: null, error: result.error.message };
    }
    if (typeof result === "string" && result.length > 0) {
      return { ok: true, ref: result, error: null };
    }
    return { ok: true, ref: null, error: null };
  } catch (err) {
    return { ok: false, ref: null, error: errorMessage(err) };
  }
}

// Send USDT (ERC-20) from the connected EVM wallet through window.ethereum.
// The user approves the transaction in the native wallet dialog.
export async function sendUsdt(
  to: string,
  amountUsdt: number,
  network: Network | null,
): Promise<TxOutcome> {
  const evm = evmProvider();
  if (!evm) {
    return { ok: false, ref: null, error: "No Ethereum provider. Open this app inside Nimiq Pay." };
  }
  const contract = usdtContractFor(network);
  if (!contract) {
    return { ok: false, ref: null, error: "No USDT contract for this network." };
  }
  try {
    const accounts = (await evm.request({ method: "eth_requestAccounts" })) as string[];
    const from = accounts[0];
    if (!from) {
      return { ok: false, ref: null, error: "No EVM account was shared." };
    }
    const chainId = Number(
      await evm.request({ method: "eth_chainId" }),
    );
    const expected = network === "mainnet" ? POLYGON_MAINNET_CHAIN : POLYGON_AMOY_CHAIN;
    if (chainId !== expected) {
      return {
        ok: false,
        ref: null,
        error: `Your wallet is on chain ${chainId}. Switch it to ${network === "mainnet" ? "Polygon (137)" : "Polygon Amoy (80002)"} to send USDT.`,
      };
    }
    const units = BigInt(Math.round(amountUsdt * 10 ** USDT_DECIMALS));
    const data = "0x" + ERC20_TRANSFER + hexPad32(to) + hexPad32(toHex(units).slice(2));
    const hash = (await evm.request({
      method: "eth_sendTransaction",
      params: [{ from, to: contract, value: "0x0", data }],
    })) as string;
    return { ok: true, ref: typeof hash === "string" ? hash : null, error: null };
  } catch (err) {
    return { ok: false, ref: null, error: errorMessage(err) };
  }
}

// Mint test USDT from the Amoy mock token to the connected address.
// Testnet only, and only for the mock token. Never used on mainnet.
export async function mintTestUsdt(amountUsdt: number): Promise<TxOutcome> {
  const evm = evmProvider();
  if (!evm) {
    return { ok: false, ref: null, error: "No Ethereum provider. Open this app inside Nimiq Pay." };
  }
  try {
    const accounts = (await evm.request({ method: "eth_requestAccounts" })) as string[];
    const from = accounts[0];
    if (!from) {
      return { ok: false, ref: null, error: "No EVM account was shared." };
    }
    const units = BigInt(Math.round(amountUsdt * 10 ** USDT_DECIMALS));
    const data = "0x" + ERC20_MINT + hexPad32(from) + hexPad32(toHex(units).slice(2));
    const hash = (await evm.request({
      method: "eth_sendTransaction",
      params: [{ from, to: USDT_AMOY_MOCK, value: "0x0", data }],
    })) as string;
    return { ok: true, ref: typeof hash === "string" ? hash : null, error: null };
  } catch (err) {
    return { ok: false, ref: null, error: errorMessage(err) };
  }
}

export async function getUsdtDecimals(network: Network | null): Promise<number | null> {
  const evm = evmProvider();
  const contract = usdtContractFor(network);
  if (!evm || !contract) return null;
  try {
    const raw = (await evm.request({
      method: "eth_call",
      params: [{ to: contract, data: "0x" + ERC20_DECIMALS }, "latest"],
    })) as string;
    return Number(BigInt(raw));
  } catch {
    return null;
  }
}
