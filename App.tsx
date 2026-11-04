import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppState } from './lib/types';
import { BLANK_STATE, EXAMPLE_STATE, uid } from './lib/types';
import { loadSaved, save, eraseSaved, exportJson, importJson, blank } from './lib/store';
import { monthsToDebtFree, debtFreeDate, money } from './lib/payoff';
import { PREMIUM_PRICES, FREE_TRIAL, purchase, restorePurchases, getEntitlement } from './lib/storekit';
import { requestReminder, storageGet, storageSet, isNative } from './lib/native';
import './App.css';

type SectionKey = 'income' | 'essentials' | 'savings' | 'debts' | 'split' | 'premium' | 'data' | 'help' | 'feedback';

const SECTION_TITLES: Record<SectionKey, string> = {
  income: 'Money in',
  essentials: 'Essential expenses',
  savings: 'Savings',
  debts: 'Debts',
  split: 'Your money split · 75 · 15 · 10',
  premium: 'Premium',
  data: 'Your data',
  help: 'Help',
  feedback: 'Feedback',
};

export default function App() {
  // Fresh installs start BLANK. The example draft is opt-in only (demo/preview use).
  // Saved entries load asynchronously: Capacitor Preferences on iOS, localStorage on the web.
  const [draft, setDraft] = useState<AppState>(() => blank());
  // WHOLE-APP PAYWALL LOCK (Clare, Nov 3, 2026): Premium IS the whole app.
  // No free basic tier, no free use after one month. Every user gets a free
  // first month, then must pay $0.99/month or $11.99/year to keep using
  // AllinView. On the native iOS app only, the app checks the StoreKit
  // entitlement on launch: an active entitlement — including a subscription
  // still in its free trial, which StoreKit reports as a current entitlement —
  // unlocks the app; anything else shows ONLY the lock screen below, never
  // the budget/debt/savings app. A failed StoreKit check never unlocks the
  // app on iOS; it stays locked with a retry button. On the web build there
  // is no StoreKit, so the gate is 'web' and the app renders exactly as
  // before (Premium section notice only) — the web build is never locked out.
  type GateState = 'checking' | 'locked' | 'unlocked' | 'web';
  const [gate, setGate] = useState<GateState>(isNative ? 'checking' : 'web');
  const [gateBusy, setGateBusy] = useState(false);
  useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    void getEntitlement().then((e) => {
      if (!cancelled) setGate(e.active ? 'unlocked' : 'locked');
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const recheckGate = async () => {
    setGateBusy(true);
    try {
      const e = await getEntitlement();
      setGate(e.active ? 'unlocked' : 'locked');
      if (!e.active) setNotice('No active membership found. Start your free month below, or tap “Restore purchases” if you already subscribed.');
    } finally {
      setGateBusy(false);
    }
  };
  const handleGatePurchase = async (plan: 'monthly' | 'yearly') => {
    setGateBusy(true);
    try {
      const r = await purchase(plan);
      if (r.ok && r.entitlement?.active) {
        setGate('unlocked');
        setNotice(r.reason);
      } else {
        setNotice(r.reason);
      }
    } finally {
      setGateBusy(false);
    }
  };
  const handleGateRestore = async () => {
    setGateBusy(true);
    try {
      const r = await restorePurchases();
      if (r.ok && r.entitlement?.active) {
        setGate('unlocked');
        setNotice(r.reason);
      } else {
        setNotice(r.reason);
      }
    } finally {
      setGateBusy(false);
    }
  };

  const [saved, setSaved] = useState<AppState | null>(null);
  useEffect(() => {
    // Saved entries load only once the app is unlocked (or on the web build),
    // so no user data is loaded behind the lock screen on iOS.
    if (isNative && gate !== 'unlocked') return;
    let cancelled = false;
    void loadSaved().then((s) => {
      if (!cancelled && s) {
        setDraft(s);
        setSaved(s);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [gate]);
  const [collapsed, setCollapsed] = useState<Partial<Record<SectionKey, boolean>>>({
    debts: false,
    split: true,
    premium: true,
    data: true,
    help: true,
    feedback: true,
  });
  const [debtDetailsCollapsed, setDebtDetailsCollapsed] = useState(true);
  const [undoStack, setUndoStack] = useState<AppState[]>([]);
  const [notice, setNotice] = useState('');
  const [previewExample, setPreviewExample] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pushUndo = (prev: AppState) => setUndoStack((s) => [...s.slice(-19), prev]);
  const update = (fn: (d: AppState) => AppState) => {
    setDraft((d) => {
      pushUndo(d);
      return fn(structuredClone(d));
    });
  };

  const totalIncome = draft.income.reduce((s, e) => s + e.amount, 0);
  const totalEssentials = draft.essentials.reduce((s, e) => s + e.amount, 0);
  const balance = totalIncome - totalEssentials;
  const efMonthly =
    draft.emergencyFundTarget > draft.emergencyFundSaved && draft.emergencyFundTarget > 0
      ? (draft.emergencyFundTarget - draft.emergencyFundSaved) / 12
      : 0;
  const goalMonthly = draft.savingsGoals.reduce(
    (s, g) => s + (g.target > g.saved ? (g.target - g.saved) / 12 : 0),
    0,
  );
  const savingsPerMonth = efMonthly + goalMonthly;
  const monthlyDebtPayment = draft.debts
    .filter((d) => !d.paid)
    .reduce((s, d) => s + d.monthlyPayment, 0);
  const disposable = balance - monthlyDebtPayment - savingsPerMonth;
  const totalDebt = draft.debts.filter((d) => !d.paid).reduce((s, d) => s + d.balance, 0);
  const months = monthsToDebtFree(draft.debts);
  const efPct =
    draft.emergencyFundTarget > 0
      ? Math.min(100, Math.round((draft.emergencyFundSaved / draft.emergencyFundTarget) * 100))
      : 0;
  const totalSaved = draft.emergencyFundSaved + draft.savingsGoals.reduce((s, g) => s + g.saved, 0);
  const sortedDebts = useMemo(
    () => [...draft.debts].sort((a, b) => a.balance - b.balance),
    [draft.debts],
  );
  const allDebtsPaid = draft.debts.length > 0 && draft.debts.every((d) => d.paid);

  const toggle = (k: SectionKey) => setCollapsed((c) => ({ ...c, [k]: !c[k] }));

  const handleSave = async () => {
    const next = await save(draft);
    setSaved(next);
    setNotice(`Saved. Your entries are stored on this device only.`);
  };

  const handleExport = () => {
    const blob = new Blob([exportJson(draft)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'allinview-export.json';
    a.click();
    URL.revokeObjectURL(a.href);
    setNotice('Export downloaded. Nothing was sent anywhere.');
  };

  const handleImportFile = async (file: File) => {
    try {
      const next = importJson(await file.text());
      pushUndo(draft);
      setDraft(next);
      setNotice('Import loaded into your draft. Tap “Save my entries” to keep it.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not read that file.');
    }
  };

  const rolloverMonth = () => {
    update((d) => {
      // Recurring entries roll forward: unpaid recurring items stay, paid flags reset.
      // One-off paid items stay paid (they do not reappear next month).
      d.income.forEach((e) => {
        if (e.recurring) e.paid = false;
      });
      d.essentials.forEach((e) => {
        if (e.recurring) e.paid = false;
      });
      d.savingsGoals.forEach((g) => {
        g.saved += g.target > g.saved ? (g.target - g.saved) / 12 : 0;
      });
      return d;
    });
    setNotice('Month rolled over: recurring items reset, savings advanced one month.');
  };

  const bulkMarkPaid = (section: 'income' | 'essentials') => {
    update((d) => {
      d[section].forEach((e) => {
        e.paid = true;
      });
      return d;
    });
  };

  const undo = () => {
    setUndoStack((s) => {
      const prev = s[s.length - 1];
      if (prev) setDraft(prev);
      return s.slice(0, -1);
    });
  };

  const loadExample = () => {
    pushUndo(draft);
    setDraft(structuredClone(EXAMPLE_STATE));
    setPreviewExample(true);
    setNotice('Example numbers only — tap “Save my entries” only if you want to keep them.');
  };

  const requestReminderPermission = async () => {
    // Native build: Capacitor LocalNotifications. Web build: browser permission, in-app reminders.
    setNotice(await requestReminder('AllinView', 'Check your money plan today.'));
  };

  const section = (key: SectionKey, body: React.ReactNode) => (
    <section className="card" key={key}>
      <button className="section-head" onClick={() => toggle(key)} aria-expanded={!collapsed[key]}>
        <span>{SECTION_TITLES[key]}</span>
        <span>{collapsed[key] ? '▸' : '▾'}</span>
      </button>
      {!collapsed[key] && <div className="section-body">{body}</div>}
    </section>
  );

  const entryRows = (
    list: AppState['income'],
    onChange: (id: string, patch: Partial<AppState['income'][number]>) => void,
  ) =>
    list.map((e) => (
      <div className="row" key={e.id}>
        <input
          aria-label="Label"
          value={e.label}
          onChange={(ev) => onChange(e.id, { label: ev.target.value })}
          placeholder="Label"
        />
        <input
          aria-label="Amount"
          type="number"
          value={e.amount || ''}
          onChange={(ev) => onChange(e.id, { amount: Number(ev.target.value) })}
          placeholder="0"
        />
        <label className="check">
          <input
            type="checkbox"
            checked={!!e.paid}
            onChange={(ev) => onChange(e.id, { paid: ev.target.checked })}
          />{' '}
          Paid
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={!!e.recurring}
            onChange={(ev) => onChange(e.id, { recurring: ev.target.checked })}
          />{' '}
          Every month
        </label>
      </div>
    ));

  const addEntry = (sectionName: 'income' | 'essentials') =>
    update((d) => {
      d[sectionName].push({ id: uid(), label: '', amount: 0 });
      return d;
    });

  // Lock screen: rendered INSTEAD of the app, never behind or beside it.
  // On the web build gate is 'web' and this branch never runs.
  if (isNative && gate === 'checking') {
    return (
      <main className="app">
        <header>
          <h1>AllinView</h1>
          <p className="tagline">See what&apos;s left to spend.</p>
        </header>
        <p role="status">Checking your membership…</p>
      </main>
    );
  }
  if (isNative && gate === 'locked') {
    return (
      <main className="app">
        <header>
          <h1>AllinView</h1>
          <p className="tagline">See what&apos;s left to spend.</p>
        </header>
        <section className="card" aria-label="AllinView membership">
          <h2>AllinView membership</h2>
          <p>
            AllinView is a membership app. Your first month is free for everyone.
            After that, membership is {PREMIUM_PRICES.monthly}, or {PREMIUM_PRICES.yearly},
            to keep using AllinView. Nothing is free after the first month.
          </p>
          <p>Tap a plan to start your free month. You can cancel anytime in your App Store account settings.</p>
          <div className="actions">
            <button disabled={gateBusy} onClick={() => void handleGatePurchase('monthly')}>Monthly — $0.99, first month free</button>
            <button disabled={gateBusy} onClick={() => void handleGatePurchase('yearly')}>Yearly — $11.99, first month free</button>
            <button disabled={gateBusy} onClick={() => void handleGateRestore()}>Restore purchases</button>
            <button disabled={gateBusy} onClick={() => void recheckGate()}>Check again</button>
          </div>
          <p className="hint">Membership is billed through the App Store. Subscriptions renew automatically unless cancelled in your App Store account settings. If you already subscribed on another device, tap “Restore purchases”.</p>
          {notice && <p className="notice" role="status">{notice}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="app">
      <header>
        <h1>AllinView</h1>
        <p className="tagline">See what&apos;s left to spend.</p>
        {saved?.savedAt && <p className="saved-note">Last saved on this device: {new Date(saved.savedAt).toLocaleString()}</p>}
      </header>

      {/* AGREED SUMMARY SCREEN */}
      <section className="summary" aria-label="Summary">
        <details>
          <summary>What paying off your debts gets you</summary>
          <p>When a debt is gone, its monthly payment is yours again — for savings, or for breathing room.</p>
        </details>
        <div className="grid3">
          <div><span>Total income / month</span><strong>{money(totalIncome)}</strong></div>
          <div className="red"><span>Essential expenses / month</span><strong>−{money(totalEssentials)}</strong></div>
          <div><span>Balance after essentials</span><strong>{money(balance)}</strong></div>
          <div className="red"><span>Monthly debt payment</span><strong>−{money(monthlyDebtPayment)}</strong></div>
          <div className="green"><span>Savings per month</span><strong>{money(savingsPerMonth)}</strong></div>
          <div className="green oval"><span>Disposable income</span><strong>{money(disposable)}</strong></div>
          <div className="red"><span>Total debt</span><strong>{money(totalDebt)}</strong></div>
          <div><span>Your debt-free date</span><strong>{debtFreeDate(months)}</strong></div>
        </div>
        <div className="ef">
          <span>Emergency fund progress — {efPct}%</span>
          <strong>{money(draft.emergencyFundSaved)} of {money(draft.emergencyFundTarget)} saved</strong>
          <span>{money(efMonthly)}/mo</span>
          <progress value={efPct} max={100} />
        </div>
        <div className="total-saved">
          <span>Total savings available</span>
          <strong>{money(totalSaved)}</strong>
          <small>Emergency fund + your goals</small>
        </div>
        {allDebtsPaid && (
          <div className="celebration" role="status">
            🎉 Debt free! Every debt in your list is marked paid.
          </div>
        )}
        <button className="save-btn" onClick={handleSave}>Save my entries</button>
        <p className="manual-note">Manual save only — nothing is saved until you tap this button.</p>
      </section>

      {notice && <p className="notice" role="status">{notice}</p>}

      {section('income', (
        <>
          {entryRows(draft.income, (id, patch) =>
            update((d) => {
              const e = d.income.find((x) => x.id === id);
              if (e) Object.assign(e, patch);
              return d;
            }),
          )}
          <div className="actions">
            <button onClick={() => addEntry('income')}>Add income</button>
            <button onClick={() => bulkMarkPaid('income')}>Mark all paid</button>
          </div>
        </>
      ))}

      {section('essentials', (
        <>
          {entryRows(draft.essentials, (id, patch) =>
            update((d) => {
              const e = d.essentials.find((x) => x.id === id);
              if (e) Object.assign(e, patch);
              return d;
            }),
          )}
          <div className="actions">
            <button onClick={() => addEntry('essentials')}>Add expense</button>
            <button onClick={() => bulkMarkPaid('essentials')}>Mark all paid</button>
          </div>
        </>
      ))}

      {section('savings', (
        <>
          <div className="row">
            <input aria-label="Emergency fund target" type="number" value={draft.emergencyFundTarget || ''}
              onChange={(ev) => update((d) => { d.emergencyFundTarget = Number(ev.target.value); return d; })} placeholder="Emergency fund target" />
            <input aria-label="Emergency fund saved" type="number" value={draft.emergencyFundSaved || ''}
              onChange={(ev) => update((d) => { d.emergencyFundSaved = Number(ev.target.value); return d; })} placeholder="Emergency fund saved" />
          </div>
          {draft.savingsGoals.map((g) => {
            const pct = g.target > 0 ? Math.min(100, Math.round((g.saved / g.target) * 100)) : 0;
            return (
              <div className="goal" key={g.id}>
                <div className="row">
                  <input aria-label="Goal name" value={g.label}
                    onChange={(ev) => update((d) => { const x = d.savingsGoals.find((y) => y.id === g.id); if (x) x.label = ev.target.value; return d; })} placeholder="Goal" />
                  <input aria-label="Goal target" type="number" value={g.target || ''}
                    onChange={(ev) => update((d) => { const x = d.savingsGoals.find((y) => y.id === g.id); if (x) x.target = Number(ev.target.value); return d; })} placeholder="Target" />
                  <input aria-label="Goal saved" type="number" value={g.saved || ''}
                    onChange={(ev) => update((d) => { const x = d.savingsGoals.find((y) => y.id === g.id); if (x) x.saved = Number(ev.target.value); return d; })} placeholder="Saved" />
                </div>
                <progress value={pct} max={100} /> <span>{pct}% funded</span>
              </div>
            );
          })}
          <button onClick={() => update((d) => { d.savingsGoals.push({ id: uid(), label: '', target: 0, saved: 0 }); return d; })}>Add savings goal</button>
        </>
      ))}

      {section('debts', (
        <>
          <p className="hint">Debts are paid smallest-first. The simulation uses monthly debt payments only.</p>
          <button className="linklike" onClick={() => setDebtDetailsCollapsed(!debtDetailsCollapsed)}>
            {debtDetailsCollapsed ? 'Show debt-free date + payoff order ▸' : 'Hide debt-free date + payoff order ▾'}
          </button>
          {!debtDetailsCollapsed && (
            <div className="debt-details">
              <p>Debt-free date: <strong>{debtFreeDate(months)}</strong> ({Number.isFinite(months) ? `${months} months` : 'not reachable at current payments'})</p>
              <ol>
                {sortedDebts.map((d) => <li key={d.id}>{d.label || 'Debt'} — {money(d.balance)}</li>)}
              </ol>
            </div>
          )}
          {draft.debts.map((d) => (
            <div className="row debt-row" key={d.id}>
              <input aria-label="Debt name" value={d.label}
                onChange={(ev) => update((x) => { const y = x.debts.find((z) => z.id === d.id); if (y) y.label = ev.target.value; return x; })} placeholder="Debt" />
              <input aria-label="Balance" type="number" value={d.balance || ''}
                onChange={(ev) => update((x) => { const y = x.debts.find((z) => z.id === d.id); if (y) y.balance = Number(ev.target.value); return x; })} placeholder="Balance" />
              <input aria-label="APR percent" type="number" value={d.aprPercent || ''}
                onChange={(ev) => update((x) => { const y = x.debts.find((z) => z.id === d.id); if (y) y.aprPercent = Number(ev.target.value); return x; })} placeholder="APR %" />
              <input aria-label="Monthly payment" type="number" value={d.monthlyPayment || ''}
                onChange={(ev) => update((x) => { const y = x.debts.find((z) => z.id === d.id); if (y) y.monthlyPayment = Number(ev.target.value); return x; })} placeholder="Payment / mo" />
              <label className="check">
                <input type="checkbox" checked={!!d.paid}
                  onChange={(ev) => update((x) => { const y = x.debts.find((z) => z.id === d.id); if (y) y.paid = ev.target.checked; return x; })} /> Paid off
              </label>
            </div>
          ))}
          <div className="actions">
            <button onClick={() => update((d) => { d.debts.push({ id: uid(), label: '', balance: 0, aprPercent: 0, monthlyPayment: 0 }); return d; })}>Add debt</button>
            <button onClick={() => update((d) => { d.debts.forEach((x) => { x.paid = true; }); return d; })}>Mark all debts paid</button>
          </div>
        </>
      ))}

      {section('split', (
        <p>
          Of your total income ({money(totalIncome)}): main {money(totalIncome * 0.75)} (75%), investments {money(totalIncome * 0.15)} (15%), savings {money(totalIncome * 0.1)} (10%).
          Information only — this does not move any money.
        </p>
      ))}

      {section('premium', (
        <>
          <p>First month free on both plans. Then {PREMIUM_PRICES.monthly}, or {PREMIUM_PRICES.yearly}. Cancel anytime.</p>
          <p className="hint">{FREE_TRIAL}</p>
          <div className="actions">
            <button onClick={async () => { const r = await purchase('monthly'); setNotice(r.reason); }}>Monthly — $0.99</button>
            <button onClick={async () => { const r = await purchase('yearly'); setNotice(r.reason); }}>Yearly — $11.99</button>
            <button onClick={async () => { const r = await restorePurchases(); setNotice(r.reason); }}>Restore purchases</button>
          </div>
          <p className="hint">Premium is billed through the App Store. Subscriptions renew automatically unless cancelled in your App Store account settings.</p>
        </>
      ))}

      {section('data', (
        <>
          <p>Your entries live on this device only. Nothing is sent to a server by this app.</p>
          <div className="actions">
            <button onClick={handleExport}>Export (download file)</button>
            <button onClick={() => fileRef.current?.click()}>Import (choose file)</button>
            <button onClick={rolloverMonth}>Roll over to next month</button>
            <button onClick={undo} disabled={undoStack.length === 0}>Undo last change</button>
            <button onClick={async () => { await eraseSaved(); setSaved(null); setDraft(blank()); setNotice('Saved entries erased from this device.'); }}>Erase saved entries</button>
            <button onClick={requestReminderPermission}>Allow reminders</button>
            <button onClick={loadExample}>Load example numbers</button>
          </div>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden
            onChange={(ev) => { const f = ev.target.files?.[0]; if (f) void handleImportFile(f); ev.target.value = ''; }} />
          {previewExample && <p className="hint">Example numbers shown. They are not saved unless you tap “Save my entries”.</p>}
          <p className="hint">Reminders: on iOS, “Allow reminders” schedules a native local notification on this device. On the web, reminders stay in-app.</p>
        </>
      ))}

      {section('help', (
        <ul>
          <li>Tap “Save my entries” to keep your numbers. Closing the app without saving keeps your last saved copy.</li>
          <li>Debts are listed smallest-first. Mark a debt “Paid off” when it is gone.</li>
          <li>“Every month” items roll forward when you tap “Roll over to next month”.</li>
          <li>Export downloads a file you can keep or move to another device. Import reads that file back.</li>
          <li>Privacy policy: <a href="https://muse.ai/s/allinview-privacy-policy-xtxk6rtqxjskixb/IJk8Ew4-JV4BE9K7JGCJoQPgB6fzKlFbAVQIqMFaoeI">AllinView Privacy Policy</a>. Terms of use: <a href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/">Apple Standard EULA</a>.</li>
        </ul>
      ))}

      {section('feedback', (
        <FeedbackForm onSent={() => setNotice('Feedback saved on this device only. It is not sent anywhere in this rebuild step.')} />
      ))}
    </main>
  );
}

function FeedbackForm({ onSent }: { onSent: () => void }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [c, setC] = useState('');
  const [name, setName] = useState('');
  return (
    <form onSubmit={async (ev) => {
      ev.preventDefault();
      // Stored on-device only in this step (Capacitor Preferences on iOS, localStorage on web);
      // a real backend endpoint is a later decision.
      const existing = JSON.parse((await storageGet('allinview:feedback')) ?? '[]') as unknown[];
      await storageSet('allinview:feedback', JSON.stringify([...existing, { a, b, c, name, at: new Date().toISOString() }]));
      setA(''); setB(''); setC(''); setName('');
      onSent();
    }}>
      <label>What works well?<textarea value={a} onChange={(e) => setA(e.target.value)} /></label>
      <label>What is confusing?<textarea value={b} onChange={(e) => setB(e.target.value)} /></label>
      <label>What would you change?<textarea value={c} onChange={(e) => setC(e.target.value)} /></label>
      <label>Your name (optional)<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <button type="submit">Send feedback</button>
      <p className="hint">In this rebuild step, feedback is saved on this device only and is not emailed or uploaded.</p>
    </form>
  );
}
