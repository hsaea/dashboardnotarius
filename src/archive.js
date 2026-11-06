import { TZ } from './config.js';
import { listMonths, listClosedMonths, closeMonth, getSettings } from './db.js';

// Поточний місяць "YYYY-MM" за Києвом
export function currentMonthKey(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).format(d);
}

// Автоархівування: усі завершені місяці (раніші за поточний), які ще не закриті,
// фіксуються — зберігаються діючі ставки, а присутні угоди позначаються locked.
// Кожного 1-го числа попередній місяць закривається автоматично.
export async function archivePastMonths() {
  const cur = currentMonthKey();
  const months = await listMonths();
  const closed = new Set(await listClosedMonths());
  const rates = await getSettings();
  const nowSec = Math.floor(Date.now() / 1000);
  const done = [];
  for (const m of months) {
    if (m >= cur || closed.has(m)) continue;
    await closeMonth(m, rates, nowSec);
    done.push(m);
  }
  return done.sort();
}

export function scheduleMonthlyArchive() {
  const run = () => archivePastMonths()
    .then((a) => { if (a.length) console.log('Авто-архів місяців:', a.join(', ')); })
    .catch((e) => console.error('Помилка автоархіву:', e.message));
  setInterval(run, 60 * 60 * 1000);
  return run;
}
