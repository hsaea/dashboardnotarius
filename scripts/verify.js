// Незалежна перевірка агрегатів напряму з Kommo API (крос-чек дашборда).
// Запуск: node scripts/verify.js
import { fetchWonLeads } from '../src/kommo.js';
import { sinceEpoch, monthKey, SINCE_MONTH, TZ, DEFAULT_SIGN_RATE, DEFAULT_ACT_RATE } from '../src/config.js';

const rates = { sign_rate: DEFAULT_SIGN_RATE, act_rate: DEFAULT_ACT_RATE };
console.log(`Період з ${SINCE_MONTH}, пояс ${TZ}, ставки: підпис ${rates.sign_rate} / акт ${rates.act_rate} грн\n`);

const leads = await fetchWonLeads(sinceEpoch());
console.log(`Отримано угод: ${leads.length}`);

const agg = {};
let noWho = 0;
for (const l of leads) {
  if (!l.who) { noWho++; continue; }
  const k = `${l.who} | ${monthKey(l.closed_at)}`;
  const a = (agg[k] = agg[k] || { acts: 0, signs: 0, deals: 0, budget: 0 });
  a.acts += l.acts; a.signs += l.signs; a.deals += 1; a.budget += l.price;
}
console.log(`Без відповідального: ${noWho}\n`);
console.log('Помічник | місяць => акти / підписи / угод / бюджет / ЗП');
for (const k of Object.keys(agg).sort()) {
  const a = agg[k];
  const zp = a.signs * rates.sign_rate + a.acts * rates.act_rate;
  console.log(`${k} => ${a.acts} / ${a.signs} / ${a.deals} / ${a.budget} / ${zp} грн`);
}
