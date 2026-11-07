// Holdfast - local state store.
// Everything lives on the device in localStorage. No data leaves the device
// except the transactions the user approves in Nimiq Pay.

import { DEFAULT_POLICY, dayKey, type Policy } from "./policy";

export type Currency = "USDT" | "NIM";

export interface Jar {
  name: string;
  goalAmount: number;
  currency: Currency;
  balance: number;
  jarAddress: string;
  createdAt: string;
}

export type LedgerKind =
  | "deposit"
  | "withdrawal"
  | "blocked"
  | "rule-change"
  | "confirmation"
  | "info";

export interface LedgerEntry {
  id: string;
  at: string;
  kind: LedgerKind;
  amount?: number;
  currency?: Currency;
  to?: string;
  reason: string;
  decision?: string;
  txRef?: string;
}

export interface AppState {
  deviceId: string;
  jar: Jar | null;
  policy: Policy;
  ledger: LedgerEntry[];
  liveMainnetAllowed: boolean;
}

const STORAGE_KEY = "holdfast-state-v1";

function makeDeviceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function loadState(): AppState {
  const fallback: AppState = {
    deviceId: makeDeviceId(),
    jar: null,
    policy: { ...DEFAULT_POLICY, allowlist: [...DEFAULT_POLICY.allowlist] },
    ledger: [],
    liveMainnetAllowed: false,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return {
      deviceId: typeof parsed.deviceId === "string" ? parsed.deviceId : fallback.deviceId,
      jar: parsed.jar ?? null,
      policy: { ...DEFAULT_POLICY, ...(parsed.policy ?? {}) },
      ledger: Array.isArray(parsed.ledger) ? parsed.ledger : [],
      liveMainnetAllowed: parsed.liveMainnetAllowed === true,
    };
  } catch {
    return fallback;
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable: the app keeps working in memory.
  }
}

export function makeLedgerEntry(
  kind: LedgerKind,
  reason: string,
  extra?: Partial<LedgerEntry>,
): LedgerEntry {
  return {
    id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    at: new Date().toISOString(),
    kind,
    reason,
    ...extra,
  };
}

export function spentToday(ledger: LedgerEntry[], currency: Currency): number {
  const today = dayKey(new Date());
  return ledger
    .filter(
      (e) =>
        e.kind === "withdrawal" &&
        e.currency === currency &&
        typeof e.amount === "number" &&
        e.at.slice(0, 10) === today,
    )
    .reduce((sum, e) => sum + (e.amount ?? 0), 0);
}

export function shortAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}
