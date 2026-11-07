import { useEffect, useMemo, useState } from "react";
import {
  checkWithdrawal,
  DEFAULT_POLICY,
  type Policy,
} from "./policy";
import {
  loadState,
  makeLedgerEntry,
  saveState,
  shortAddress,
  spentToday,
  type AppState,
  type Currency,
  type Jar,
} from "./store";
import {
  connectWallet,
  DEMO_EVM_ADDRESS,
  DEMO_NIM_ADDRESS,
  mintTestUsdt,
  refreshBalances,
  sendNim,
  sendUsdt,
  usdtLabelFor,
  type WalletInfo,
} from "./wallet";

const PROBLEM_LINE =
  "People set money rules for themselves, then break them in the moment, because no app actually holds them to it.";

function formatAmount(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseAmount(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export default function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [connecting, setConnecting] = useState(true);

  const [jarName, setJarName] = useState("");
  const [jarGoal, setJarGoal] = useState("500");
  const [jarCurrency, setJarCurrency] = useState<Currency>("NIM");

  const [ruleCap, setRuleCap] = useState(String(DEFAULT_POLICY.perWithdrawalCap));
  const [ruleDaily, setRuleDaily] = useState(String(DEFAULT_POLICY.dailyCap));
  const [ruleConfirm, setRuleConfirm] = useState(String(DEFAULT_POLICY.confirmAbove));
  const [allowInput, setAllowInput] = useState("");

  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawTo, setWithdrawTo] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState<{ amount: number; to: string } | null>(null);

  const [status, setStatus] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [minting, setMinting] = useState(false);

  const jar: Jar | null = state.jar;
  const policy: Policy = state.policy;

  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const info = await connectWallet();
      if (cancelled) return;
      setWallet(info);
      setConnecting(false);
      // If a jar was created in demo mode and the app is now inside Nimiq Pay,
      // point the jar at the real connected wallet.
      setState((prev) => {
        if (!prev.jar || info.mode !== "live") return prev;
        const liveAddr =
          prev.jar.currency === "NIM" ? info.address : info.evmAddress;
        if (!liveAddr) return prev;
        if (prev.jar.jarAddress === DEMO_NIM_ADDRESS || prev.jar.jarAddress === DEMO_EVM_ADDRESS) {
          const entry = makeLedgerEntry(
            "info",
            `Jar address updated to your connected wallet (${shortAddress(liveAddr)}).`,
          );
          return {
            ...prev,
            jar: { ...prev.jar, jarAddress: liveAddr },
            ledger: [entry, ...prev.ledger],
          };
        }
        return prev;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const spent = useMemo(
    () => (jar ? spentToday(state.ledger, jar.currency) : 0),
    [state.ledger, jar],
  );

  const walletBalance =
    jar?.currency === "NIM" ? wallet?.nimBalance ?? null : wallet?.usdtBalance ?? null;

  const isLive = wallet?.mode === "live";
  const isMainnet = isLive && wallet?.network === "mainnet";
  const mainnetLocked = isMainnet && !state.liveMainnetAllowed;
  const jarAddressFor = (currency: Currency): string => {
    if (!wallet) return currency === "NIM" ? DEMO_NIM_ADDRESS : DEMO_EVM_ADDRESS;
    if (wallet.mode === "live") {
      return currency === "NIM"
        ? wallet.address ?? DEMO_NIM_ADDRESS
        : wallet.evmAddress ?? DEMO_EVM_ADDRESS;
    }
    return currency === "NIM" ? DEMO_NIM_ADDRESS : DEMO_EVM_ADDRESS;
  };

  function updateState(patch: Partial<AppState>) {
    setState((prev) => ({ ...prev, ...patch }));
  }

  function addLedger(entry: ReturnType<typeof makeLedgerEntry>) {
    setState((prev) => ({ ...prev, ledger: [entry, ...prev.ledger] }));
  }

  function createJar() {
    const name = jarName.trim();
    const goal = parseAmount(jarGoal);
    if (!name) {
      setStatus({ kind: "error", text: "Give your jar a name first." });
      return;
    }
    if (goal === null) {
      setStatus({ kind: "error", text: "Enter a goal amount above zero." });
      return;
    }
    const address = jarAddressFor(jarCurrency);
    const newJar: Jar = {
      name,
      goalAmount: goal,
      currency: jarCurrency,
      balance: 0,
      jarAddress: address,
      createdAt: new Date().toISOString(),
    };
    const entry = makeLedgerEntry(
      "info",
      `Jar "${name}" created with a goal of ${formatAmount(goal)} ${jarCurrency}.`,
      { currency: jarCurrency },
    );
    setState((prev) => ({ ...prev, jar: newJar, ledger: [entry, ...prev.ledger] }));
    setStatus({ kind: "ok", text: `Jar "${name}" is ready. Deposit to start saving.` });
  }

  function saveRules() {
    const cap = parseAmount(ruleCap);
    const daily = parseAmount(ruleDaily);
    const confirm = parseAmount(ruleConfirm);
    if (cap === null || daily === null || confirm === null) {
      setStatus({ kind: "error", text: "All three rule amounts must be above zero." });
      return;
    }
    if (confirm > cap) {
      setStatus({
        kind: "error",
        text: "The confirm threshold must be at or below the per-withdrawal cap, or it would never trigger.",
      });
      return;
    }
    const next: Policy = {
      perWithdrawalCap: cap,
      dailyCap: daily,
      confirmAbove: confirm,
      allowlist: policy.allowlist,
    };
    const entry = makeLedgerEntry(
      "rule-change",
      `Rules updated: per-withdrawal cap ${formatAmount(cap)}, daily cap ${formatAmount(daily)}, confirm above ${formatAmount(confirm)}.`,
    );
    setState((prev) => ({ ...prev, policy: next, ledger: [entry, ...prev.ledger] }));
    setStatus({ kind: "ok", text: "Rules saved. They apply to the next withdrawal." });
  }

  function addAllowlist() {
    const addr = allowInput.trim();
    if (!addr) return;
    if (policy.allowlist.some((a) => a.toLowerCase() === addr.toLowerCase())) {
      setStatus({ kind: "info", text: "That address is already on your allowlist." });
      return;
    }
    const next: Policy = { ...policy, allowlist: [...policy.allowlist, addr] };
    const entry = makeLedgerEntry(
      "rule-change",
      `Added ${shortAddress(addr)} to the allowlist.`,
    );
    setState((prev) => ({ ...prev, policy: next, ledger: [entry, ...prev.ledger] }));
    setAllowInput("");
    setStatus({ kind: "ok", text: "Address added to the allowlist." });
  }

  function removeAllowlist(addr: string) {
    const next: Policy = {
      ...policy,
      allowlist: policy.allowlist.filter((a) => a !== addr),
    };
    const entry = makeLedgerEntry(
      "rule-change",
      `Removed ${shortAddress(addr)} from the allowlist.`,
    );
    setState((prev) => ({ ...prev, policy: next, ledger: [entry, ...prev.ledger] }));
  }

  async function deposit() {
    if (!jar || !wallet) return;
    const amount = parseAmount(depositAmount);
    if (amount === null) {
      setStatus({ kind: "error", text: "Enter a deposit amount above zero." });
      return;
    }
    if (mainnetLocked) {
      setStatus({
        kind: "error",
        text: "Mainnet transactions are off. Turn on the mainnet switch to proceed.",
      });
      return;
    }
    if (isLive && walletBalance !== null && jar.balance + amount > walletBalance) {
      setStatus({
        kind: "error",
        text: `Your wallet holds ${formatAmount(walletBalance)} ${jar.currency}, so you cannot jar ${formatAmount(jar.balance + amount)}.`,
      });
      addLedger(
        makeLedgerEntry("blocked", `Deposit of ${formatAmount(amount)} ${jar.currency} blocked: wallet balance too low.`, {
          amount,
          currency: jar.currency,
          decision: "BLOCKED",
        }),
      );
      return;
    }
    setBusy(true);
    try {
      if (isLive) {
        const outcome =
          jar.currency === "NIM"
            ? await sendNim(jar.jarAddress, amount)
            : await sendUsdt(jar.jarAddress, amount, wallet.network);
        if (!outcome.ok) {
          setStatus({ kind: "error", text: `Deposit failed: ${outcome.error ?? "unknown error"}.` });
          addLedger(
            makeLedgerEntry("info", `Deposit of ${formatAmount(amount)} ${jar.currency} failed: ${outcome.error ?? "unknown error"}.`, {
              amount,
              currency: jar.currency,
            }),
          );
          return;
        }
        setState((prev) =>
          prev.jar
            ? { ...prev, jar: { ...prev.jar, balance: prev.jar.balance + amount } }
            : prev,
        );
        addLedger(
          makeLedgerEntry("deposit", `Deposited ${formatAmount(amount)} ${jar.currency} into "${jar.name}".`, {
            amount,
            currency: jar.currency,
            txRef: outcome.ref ?? undefined,
          }),
        );
        setStatus({
          kind: "ok",
          text: `Deposited ${formatAmount(amount)} ${jar.currency}.` + (outcome.ref ? ` Transaction reference: ${outcome.ref.slice(0, 24)}...` : ""),
        });
      } else {
        await new Promise((r) => setTimeout(r, 400));
        setState((prev) =>
          prev.jar
            ? { ...prev, jar: { ...prev.jar, balance: prev.jar.balance + amount } }
            : prev,
        );
        addLedger(
          makeLedgerEntry("deposit", `Deposited ${formatAmount(amount)} ${jar.currency} into "${jar.name}" (demo, simulated).`, {
            amount,
            currency: jar.currency,
          }),
        );
        setStatus({ kind: "ok", text: `Deposited ${formatAmount(amount)} ${jar.currency} (demo, simulated).` });
      }
      setDepositAmount("");
    } finally {
      setBusy(false);
    }
  }

  async function executeWithdrawal(amount: number, to: string) {
    if (!jar || !wallet) return;
    setBusy(true);
    try {
      if (isLive) {
        const outcome =
          jar.currency === "NIM"
            ? await sendNim(to, amount)
            : await sendUsdt(to, amount, wallet.network);
        if (!outcome.ok) {
          setStatus({ kind: "error", text: `Withdrawal failed: ${outcome.error ?? "unknown error"}. No funds moved.` });
          addLedger(
            makeLedgerEntry("info", `Withdrawal of ${formatAmount(amount)} ${jar.currency} to ${shortAddress(to)} failed: ${outcome.error ?? "unknown error"}.`, {
              amount,
              currency: jar.currency,
              to,
            }),
          );
          return;
        }
        setState((prev) =>
          prev.jar
            ? { ...prev, jar: { ...prev.jar, balance: prev.jar.balance - amount } }
            : prev,
        );
        addLedger(
          makeLedgerEntry("withdrawal", `Withdrew ${formatAmount(amount)} ${jar.currency} to ${shortAddress(to)}.`, {
            amount,
            currency: jar.currency,
            to,
            decision: "ALLOWED",
            txRef: outcome.ref ?? undefined,
          }),
        );
        setStatus({
          kind: "ok",
          text: `Withdrew ${formatAmount(amount)} ${jar.currency} to ${shortAddress(to)}.` + (outcome.ref ? ` Transaction reference: ${outcome.ref.slice(0, 24)}...` : ""),
        });
      } else {
        await new Promise((r) => setTimeout(r, 400));
        setState((prev) =>
          prev.jar
            ? { ...prev, jar: { ...prev.jar, balance: prev.jar.balance - amount } }
            : prev,
        );
        addLedger(
          makeLedgerEntry("withdrawal", `Withdrew ${formatAmount(amount)} ${jar.currency} to ${shortAddress(to)} (demo, simulated).`, {
            amount,
            currency: jar.currency,
            to,
            decision: "ALLOWED",
          }),
        );
        setStatus({ kind: "ok", text: `Withdrew ${formatAmount(amount)} ${jar.currency} (demo, simulated).` });
      }
      setWithdrawAmount("");
      setWithdrawTo("");
      setPendingConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  function requestWithdrawal(confirmed: boolean) {
    if (!jar || !wallet) return;
    const amount = parseAmount(withdrawAmount);
    const to = withdrawTo.trim();
    if (amount === null) {
      setStatus({ kind: "error", text: "Enter a withdrawal amount above zero." });
      return;
    }
    if (!to) {
      setStatus({ kind: "error", text: "Enter a destination address." });
      return;
    }
    if (mainnetLocked) {
      setStatus({
        kind: "error",
        text: "Mainnet transactions are off. Turn on the mainnet switch to proceed.",
      });
      return;
    }
    if (amount > jar.balance) {
      const reason = `The jar holds ${formatAmount(jar.balance)} ${jar.currency}, which is less than ${formatAmount(amount)}.`;
      setStatus({ kind: "error", text: reason });
      addLedger(
        makeLedgerEntry("blocked", `Withdrawal of ${formatAmount(amount)} ${jar.currency} blocked: ${reason}`, {
          amount,
          currency: jar.currency,
          to,
          decision: "BLOCKED",
        }),
      );
      return;
    }
    const result = checkWithdrawal(policy, {
      amount,
      toAddress: to,
      spentToday: spent,
      confirmed,
    });
    if (result.decision === "BLOCKED") {
      setStatus({ kind: "error", text: result.reason });
      addLedger(
        makeLedgerEntry("blocked", `Withdrawal of ${formatAmount(amount)} ${jar.currency} to ${shortAddress(to)} blocked: ${result.reason}`, {
          amount,
          currency: jar.currency,
          to,
          decision: "BLOCKED",
        }),
      );
      return;
    }
    if (result.decision === "NEEDS_CONFIRMATION") {
      setPendingConfirm({ amount, to });
      setStatus({ kind: "info", text: result.reason });
      return;
    }
    void executeWithdrawal(amount, to);
  }

  function confirmPendingWithdrawal() {
    if (!pendingConfirm) return;
    addLedger(
      makeLedgerEntry("confirmation", `You confirmed a withdrawal of ${formatAmount(pendingConfirm.amount)} ${jar?.currency ?? ""} to ${shortAddress(pendingConfirm.to)} above the confirm threshold.`, {
        amount: pendingConfirm.amount,
        currency: jar?.currency,
        to: pendingConfirm.to,
        decision: "CONFIRMED",
      }),
    );
    void executeWithdrawal(pendingConfirm.amount, pendingConfirm.to);
  }

  async function mintTestTokens() {
    if (!wallet || wallet.mode !== "live" || wallet.network !== "testnet") return;
    setMinting(true);
    try {
      const outcome = await mintTestUsdt(100);
      if (outcome.ok) {
        setStatus({ kind: "ok", text: "Minted 100 test USDT (mock token on Amoy). It may take a moment to show in your balance." });
        const balances = await refreshBalances("USDT", wallet.address, wallet.evmAddress, wallet.network);
        setWallet((prev) => (prev ? { ...prev, usdtBalance: balances.usdtBalance } : prev));
      } else {
        setStatus({ kind: "error", text: `Mint failed: ${outcome.error ?? "unknown error"}.` });
      }
    } finally {
      setMinting(false);
    }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const deepLink = `nimiqpay://miniapp?url=${origin.replace(/^https?:\/\//, "")}`;
  const httpsLink = `https://nimpay.app/miniapps/open/${origin.replace(/^https?:\/\//, "")}`;
  const goalProgress = jar && jar.goalAmount > 0 ? Math.min(100, (jar.balance / jar.goalAmount) * 100) : 0;

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            H
          </div>
          <div>
            <h1>Holdfast</h1>
            <p className="tagline">a savings jar that holds you to your own money rules</p>
          </div>
        </div>
        <span className={isLive ? "badge badge-live" : "badge badge-demo"}>
          {connecting ? "Connecting..." : isLive ? `Live in Nimiq Pay (${wallet?.network ?? ""})` : "Demo mode"}
        </span>
      </header>

      <p className="problem">{PROBLEM_LINE}</p>

      <section className="card note">
        <h2>How this works, honestly</h2>
        <p>
          Your jar keeps funds in your own wallet. Depositing sends a real transaction to your own jar
          address, which is the on-chain record of the deposit. Withdrawing sends real funds out, and only
          after the rules pass.
        </p>
        <p>
          The rules are enforced by this app before any transaction is requested, not by a smart contract.
          In demo mode every balance is simulated and nothing moves on chain. No transaction hash is shown
          unless a real transaction returns one.
        </p>
      </section>

      {status && <div className={`status status-${status.kind}`} role="status">{status.text}</div>}

      <section className="card">
        <h2>Wallet</h2>
        {connecting ? (
          <p>Connecting to Nimiq Pay...</p>
        ) : wallet ? (
          <dl className="kv">
            <div>
              <dt>Mode</dt>
              <dd>{isLive ? "Live, inside Nimiq Pay" : "Demo mode, plain browser"}</dd>
            </div>
            <div>
              <dt>NIM address</dt>
              <dd>{wallet.address ? shortAddress(wallet.address) : "Not shared"}</dd>
            </div>
            <div>
              <dt>EVM address</dt>
              <dd>{wallet.evmAddress ? shortAddress(wallet.evmAddress) : "Not shared"}</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>{wallet.network ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>NIM balance</dt>
              <dd>{wallet.nimBalance === null ? "Unknown" : `${formatAmount(wallet.nimBalance)} NIM`}</dd>
            </div>
            <div>
              <dt>USDT balance</dt>
              <dd>
                {wallet.usdtBalance === null
                  ? "Unknown"
                  : `${formatAmount(wallet.usdtBalance)} ${usdtLabelFor(wallet.network)}`}
              </dd>
            </div>
          </dl>
        ) : (
          <p>Wallet not available.</p>
        )}
        {wallet?.error && <p className="warn">{wallet.error}</p>}
        {isMainnet && (
          <label className="toggle">
            <input
              type="checkbox"
              checked={state.liveMainnetAllowed}
              onChange={(e) => updateState({ liveMainnetAllowed: e.target.checked })}
            />
            Allow mainnet transactions. Off by default. Turn this on only when you mean to move real funds.
          </label>
        )}
        {isLive && wallet?.network === "testnet" && jar?.currency === "USDT" && (
          <button className="btn btn-secondary" onClick={mintTestTokens} disabled={minting}>
            {minting ? "Minting..." : "Get 100 test USDT (mock token on Amoy)"}
          </button>
        )}
        {!isLive && (
          <p className="hint">
            Open this app inside Nimiq Pay to use your real wallet. Deep link:{" "}
            <a href={deepLink}>{deepLink}</a>
            {" "}or{" "}
            <a href={httpsLink}>{httpsLink}</a>
          </p>
        )}
      </section>

      {!jar ? (
        <section className="card">
          <h2>Create your jar</h2>
          <label className="field">
            <span>Jar name</span>
            <input
              value={jarName}
              onChange={(e) => setJarName(e.target.value)}
              placeholder="New phone"
              maxLength={60}
            />
          </label>
          <label className="field">
            <span>Goal amount</span>
            <input
              value={jarGoal}
              onChange={(e) => setJarGoal(e.target.value)}
              inputMode="decimal"
              placeholder="500"
            />
          </label>
          <label className="field">
            <span>Currency</span>
            <select value={jarCurrency} onChange={(e) => setJarCurrency(e.target.value as Currency)}>
              <option value="NIM">NIM</option>
              <option value="USDT">USDT</option>
            </select>
          </label>
          <p className="hint">
            One jar for now. The jar address will be your connected wallet{isLive ? "" : " (demo address in demo mode)"}.
            Deposits are real transactions to that address in live mode.
          </p>
          <button className="btn btn-primary" onClick={createJar}>Create jar</button>
        </section>
      ) : (
        <>
          <section className="card jar-card">
            <h2>{jar.name}</h2>
            <p className="big-balance">
              {formatAmount(jar.balance)} {jar.currency}
            </p>
            <p className="hint">
              Goal: {formatAmount(jar.goalAmount)} {jar.currency} ({Math.round(goalProgress)}% there)
            </p>
            <div className="progress" aria-label="Goal progress">
              <div className="progress-fill" style={{ width: `${goalProgress}%` }} />
            </div>
            <dl className="kv">
              <div>
                <dt>Jar address</dt>
                <dd>{shortAddress(jar.jarAddress)}</dd>
              </div>
              <div>
                <dt>Withdrawn today</dt>
                <dd>{formatAmount(spent)} {jar.currency} of {formatAmount(policy.dailyCap)} daily cap</dd>
              </div>
            </dl>
          </section>

          <section className="card">
            <h2>Your rules, in plain words</h2>
            <p className="hint">These rules are checked before every withdrawal. Change them any time, every change is written to the ledger.</p>
            <label className="field">
              <span>Never let me take out more than (per withdrawal)</span>
              <input value={ruleCap} onChange={(e) => setRuleCap(e.target.value)} inputMode="decimal" />
            </label>
            <label className="field">
              <span>Never let me take out more than this per day (daily cap)</span>
              <input value={ruleDaily} onChange={(e) => setRuleDaily(e.target.value)} inputMode="decimal" />
            </label>
            <label className="field">
              <span>Ask me first above this amount (confirm threshold)</span>
              <input value={ruleConfirm} onChange={(e) => setRuleConfirm(e.target.value)} inputMode="decimal" />
            </label>
            <button className="btn btn-primary" onClick={saveRules}>Save rules</button>
            <div className="allowlist">
              <h3>Allowlist</h3>
              <p className="hint">
                {policy.allowlist.length === 0
                  ? "Empty, so only your own connected wallet can receive withdrawals."
                  : "Only these addresses can receive withdrawals. Anything else is blocked."}
              </p>
              <ul className="allowlist-items">
                {policy.allowlist.map((addr) => (
                  <li key={addr}>
                    <span>{shortAddress(addr)}</span>
                    <button className="btn btn-small" onClick={() => removeAllowlist(addr)}>Remove</button>
                  </li>
                ))}
              </ul>
              <div className="row">
                <input
                  value={allowInput}
                  onChange={(e) => setAllowInput(e.target.value)}
                  placeholder="Add a destination address"
                />
                <button className="btn btn-secondary" onClick={addAllowlist}>Add</button>
              </div>
            </div>
          </section>

          <section className="card">
            <h2>Deposit</h2>
            <p className="hint">
              {isLive
                ? `Sends a real ${jar.currency} transaction to your jar address. Nimiq Pay asks you to confirm it.`
                : "Demo mode: simulated, nothing moves on chain."}
            </p>
            <div className="row">
              <input
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                inputMode="decimal"
                placeholder={`Amount in ${jar.currency}`}
              />
              <button className="btn btn-primary" onClick={deposit} disabled={busy || mainnetLocked}>
                {busy ? "Working..." : "Deposit"}
              </button>
            </div>
            {mainnetLocked && <p className="warn">Mainnet transactions are off. Turn on the mainnet switch in the Wallet section to proceed.</p>}
          </section>

          <section className="card">
            <h2>Withdraw</h2>
            <p className="hint">The rules are checked first, before any transaction is built. A blocked withdrawal never reaches your wallet.</p>
            <label className="field">
              <span>Amount in {jar.currency}</span>
              <input
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                inputMode="decimal"
                placeholder={`Amount in ${jar.currency}`}
              />
            </label>
            <label className="field">
              <span>Destination address</span>
              <input
                value={withdrawTo}
                onChange={(e) => setWithdrawTo(e.target.value)}
                placeholder={jar.currency === "NIM" ? "NQ..." : "0x..."}
              />
            </label>
            <button
              className="btn btn-primary"
              onClick={() => requestWithdrawal(false)}
              disabled={busy || mainnetLocked}
            >
              {busy ? "Working..." : "Withdraw"}
            </button>
            {mainnetLocked && <p className="warn">Mainnet transactions are off. Turn on the mainnet switch in the Wallet section to proceed.</p>}
            {pendingConfirm && (
              <div className="confirm-box">
                <p>
                  This withdrawal of {formatAmount(pendingConfirm.amount)} {jar.currency} is above your
                  confirm threshold of {formatAmount(policy.confirmAbove)}. Are you sure?
                </p>
                <div className="row">
                  <button className="btn btn-primary" onClick={confirmPendingWithdrawal} disabled={busy}>
                    Yes, withdraw it
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setPendingConfirm(null);
                      setStatus({ kind: "info", text: "Withdrawal cancelled." });
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="card">
            <h2>Ledger</h2>
            <p className="hint">Every deposit, withdrawal attempt, rule change and decision, saved on this device.</p>
            {state.ledger.length === 0 ? (
              <p className="hint">Nothing yet. Make a deposit or change a rule and it will show here.</p>
            ) : (
              <ul className="ledger">
                {state.ledger.map((entry) => (
                  <li key={entry.id} className={`ledger-${entry.kind}`}>
                    <div className="ledger-top">
                      <span className="ledger-kind">{entry.kind}</span>
                      <span className="ledger-time">{formatTime(entry.at)}</span>
                    </div>
                    <p>{entry.reason}</p>
                    {entry.txRef && (
                      <p className="ledger-tx">Transaction reference: {entry.txRef.slice(0, 32)}{entry.txRef.length > 32 ? "..." : ""}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <footer className="footer">
        <p>
          Holdfast is a Save Mini App for the Nimiq Mini Apps Competition, Cycle III. Your rules and ledger
          stay on this device. No video is stored, no data leaves the device except the transactions you
          approve in Nimiq Pay, and there is no telemetry. Rules are enforced by the app before a
          transaction is requested, not by a smart contract.
        </p>
      </footer>
    </div>
  );
}
