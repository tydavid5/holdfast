// Holdfast - rules engine (policy engine).
// Ported from the earlier wallet project's policy logic (policy.js / memory.js).
// Pure logic: no chain, no funds, no network calls.
// A withdrawal is ALLOWED, BLOCKED (with the exact rule that stopped it),
// or NEEDS_CONFIRMATION (above the confirm threshold, below the caps).

export type Decision = "ALLOWED" | "BLOCKED" | "NEEDS_CONFIRMATION";

export interface Policy {
  perWithdrawalCap: number;
  dailyCap: number;
  confirmAbove: number;
  allowlist: string[];
}

export interface CheckInput {
  amount: number;
  toAddress: string;
  spentToday: number;
  confirmed: boolean;
}

export interface CheckResult {
  decision: Decision;
  reason: string;
  rule: "perWithdrawalCap" | "dailyCap" | "allowlist" | "confirmThreshold" | null;
}

export const DEFAULT_POLICY: Policy = {
  perWithdrawalCap: 20,
  dailyCap: 50,
  // The confirm threshold must sit below the per-withdrawal cap, or it
  // could never trigger: anything above the cap is blocked outright.
  confirmAbove: 10,
  allowlist: [],
};

export function normalizeAddress(addr: string): string {
  return addr.trim().toLowerCase();
}

export function checkWithdrawal(policy: Policy, input: CheckInput): CheckResult {
  const amount = input.amount;
  const to = normalizeAddress(input.toAddress);
  const allowlist = policy.allowlist.map(normalizeAddress);

  if (!(amount > 0) || !Number.isFinite(amount)) {
    return {
      decision: "BLOCKED",
      reason: "Enter an amount above zero.",
      rule: null,
    };
  }

  if (amount > policy.perWithdrawalCap) {
    return {
      decision: "BLOCKED",
      reason: `Amount ${amount} is over the per-withdrawal cap of ${policy.perWithdrawalCap}.`,
      rule: "perWithdrawalCap",
    };
  }

  if (input.spentToday + amount > policy.dailyCap) {
    return {
      decision: "BLOCKED",
      reason: `This would take today's withdrawals to ${input.spentToday + amount}, over the daily cap of ${policy.dailyCap}.`,
      rule: "dailyCap",
    };
  }

  // An empty allowlist means only the user's own connected wallet.
  if (allowlist.length > 0 && !allowlist.includes(to)) {
    return {
      decision: "BLOCKED",
      reason: `Address ${input.toAddress} is not on your allowlist, and new addresses need your approval first.`,
      rule: "allowlist",
    };
  }

  if (amount > policy.confirmAbove && !input.confirmed) {
    return {
      decision: "NEEDS_CONFIRMATION",
      reason: `Amount ${amount} is above your ${policy.confirmAbove} confirmation threshold. Confirm to proceed.`,
      rule: "confirmThreshold",
    };
  }

  return { decision: "ALLOWED", reason: "Passes all jar rules.", rule: null };
}

export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
