import { getLeads } from './cache.js';
import { getSettings, getSnapshot, setSnapshot } from './store.js';
import { summarize, ledger } from './aggregate.js';
import { monthKey, TZ } from './config.js';

// Поточний місяць "YYYY-MM" за Києвом
export function currentMonthKey(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).format(d);
}

// Збирає знімок місяця (підсумки + журнал по помічниках)
function buildSnapshot(leads, rates, month, auto) {
  const summary = summarize(leads, rates, { month });
  const led = ledger(leads, rates, { month });
  const byWho = {};
  for (const r of led) (byWho[r.who] = byWho[r.who] || []).push(r);
  return { frozen_at: new Date().toISOString(), auto: !!auto, rates, summary, ledger: byWho };
}

// Автоархівування: усі завершені місяці (раніші за поточний), які ще не в архіві,
// фіксуються знімком. Викликається на старті та періодично (щогодини) —
// тож 1-го числа попередній місяць архівується автоматично, а поточний іде з 0.
export async function archivePastMonths() {
  const leads = await getLeads();
  const rates = getSettings();
  const cur = currentMonthKey();
  const months = new Set(leads.filter((l) => l.closed_at).map((l) => monthKey(l.closed_at)));
  const archived = [];
  for (const m of months) {
    if (m >= cur) continue;        // поточний/майбутній місяць не чіпаємо
    if (getSnapshot(m)) continue;  // уже в архіві
    setSnapshot(m, buildSnapshot(leads, rates, m, true));
    archived.push(m);
  }
  return archived.sort();
}

// Планувальник: перевіряє щогодини. Перехід через 1-ше число автоматично
// заархівує завершений місяць.
export function scheduleMonthlyArchive() {
  const run = () => archivePastMonths()
    .then((a) => { if (a.length) console.log('Авто-архів місяців:', a.join(', ')); })
    .catch((e) => console.error('Помилка автоархіву:', e.message));
  setInterval(run, 60 * 60 * 1000); // щогодини
  return run;
}
