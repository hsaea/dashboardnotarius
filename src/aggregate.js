import { monthKey, fmtDateTime, ACTIVE_ASSISTANTS } from './config.js';

export function salaryFor(signs, acts, rates) {
  return signs * rates.sign_rate + acts * rates.act_rate;
}

// Список місяців (YYYY-MM), що присутні в даних, за спаданням
export function monthsFromLeads(leads) {
  const set = new Set();
  for (const l of leads) if (l.closed_at) set.add(monthKey(l.closed_at));
  return [...set].sort().reverse();
}

// Підсумки по помічниках за місяць.
// Якщо assistant задано — лише він. onlyMonth — фільтр місяця.
export function summarize(leads, rates, { month = null, assistant = null } = {}) {
  const rows = new Map(); // assistant -> {acts,signs,cnt,budget}
  for (const l of leads) {
    if (!l.who) continue;
    if (month && monthKey(l.closed_at) !== month) continue;
    if (assistant && l.who !== assistant) continue;
    const r = rows.get(l.who) || { assistant: l.who, acts: 0, signs: 0, deals: 0, budget: 0 };
    r.acts += l.acts;
    r.signs += l.signs;
    r.deals += 1;
    r.budget += l.price;
    rows.set(l.who, r);
  }
  const list = [...rows.values()].map((r) => ({
    ...r,
    salary: salaryFor(r.signs, r.acts, rates),
  }));
  // Стабільний порядок: активні помічники спочатку за списком, далі інші
  list.sort((a, b) => {
    const ia = ACTIVE_ASSISTANTS.indexOf(a.assistant);
    const ib = ACTIVE_ASSISTANTS.indexOf(b.assistant);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.assistant.localeCompare(b.assistant);
  });
  return list;
}

// Журнал угод (лог) — рівно ті колонки, що просив користувач
export function ledger(leads, rates, { month = null, assistant = null } = {}) {
  return leads
    .filter((l) => l.who)
    .filter((l) => !month || monthKey(l.closed_at) === month)
    .filter((l) => !assistant || l.who === assistant)
    .sort((a, b) => (b.closed_at || 0) - (a.closed_at || 0))
    .map((l) => ({
      name: l.name,                 // Назва
      budget: l.price,              // Бюджет
      who: l.who,                   // Хто готує довіреність?
      acts: l.acts,                 // К-ть актів
      signs: l.signs,               // К-ть підписів
      doc_type: l.doc_type || '',   // Тип документа
      time: fmtDateTime(l.closed_at), // time
      time_ts: l.closed_at,
      id: l.id,                     // id угоди
      url: l.url,                   // Посилання на угоду
      salary: salaryFor(l.signs, l.acts, rates), // нарахована сума по угоді
    }));
}

export function totals(summaryRows) {
  return summaryRows.reduce(
    (t, r) => {
      const bonus = r.bonus || 0;
      const total = r.total != null ? r.total : r.salary + bonus;
      return {
        acts: t.acts + r.acts,
        signs: t.signs + r.signs,
        deals: t.deals + r.deals,
        budget: t.budget + r.budget,
        salary: t.salary + r.salary,
        bonus: t.bonus + bonus,
        total: t.total + total,
      };
    },
    { acts: 0, signs: 0, deals: 0, budget: 0, salary: 0, bonus: 0, total: 0 }
  );
}
