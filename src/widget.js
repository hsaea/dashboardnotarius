import { getUserByWidgetToken, getMonthlyClose, getSettings, getDealsForMonth, getBonuses } from './db.js';
import { summarize } from './aggregate.js';
import { currentMonthKey } from './archive.js';
import { ensureFresh } from './sync.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => Number(n || 0).toLocaleString('uk-UA');

function page(body) {
  return `<!DOCTYPE html><html lang="uk"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>Expert-Docs — мої підсумки</title>
<style>
  :root{--bg:#0f1420;--panel:#171e2e;--panel2:#1e2740;--line:#2a3450;--text:#e8edf7;--muted:#8a97b4;--accent:#4f8cff;--green:#2ecc8f}
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text);padding:14px;font-size:14px}
  .w{max-width:420px;margin:0 auto;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px}
  h1{margin:0 0 2px;font-size:18px}
  .sub{color:var(--muted);font-size:13px;margin-bottom:14px}
  table{width:100%;border-collapse:collapse}
  td{padding:9px 6px;border-bottom:1px solid var(--line)}
  td.v{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
  .total td{border-top:2px solid var(--line);border-bottom:none;font-size:16px;font-weight:800}
  .total .v{color:var(--green)}
  .btn{display:block;text-align:center;margin-top:16px;background:var(--accent);color:#fff;text-decoration:none;padding:11px;border-radius:9px;font-weight:600}
  .muted{color:var(--muted)}
</style></head><body><div class="w">${body}</div></body></html>`;
}

export async function widgetPage(req, res) {
  try {
    const user = await getUserByWidgetToken(req.params.token);
    if (!user || user.role !== 'assistant') {
      return res.status(404).type('html').send(page('<h1>Віджет не знайдено</h1><div class="muted">Посилання недійсне або токен змінено.</div>'));
    }
    await ensureFresh();
    const month = currentMonthKey();
    const close = await getMonthlyClose(month);
    const rates = close ? { sign_rate: close.sign_rate, act_rate: close.act_rate } : await getSettings();
    const deals = await getDealsForMonth(month, { frozen: !!close, assistant: user.assistant_name });
    const row = summarize(deals, rates, { month, assistant: user.assistant_name })[0] || { acts: 0, signs: 0, deals: 0, salary: 0 };
    const bonus = (await getBonuses(month))[user.assistant_name] || 0;
    const total = (row.salary || 0) + bonus;

    const body = `
      <h1>${esc(user.assistant_name)}</h1>
      <div class="sub">Підсумки за ${esc(month)} (ставки: підпис ${rates.sign_rate} / акт ${rates.act_rate} грн)</div>
      <table>
        <tr><td>К-ть актів</td><td class="v">${fmt(row.acts)}</td></tr>
        <tr><td>К-ть підписів</td><td class="v">${fmt(row.signs)}</td></tr>
        <tr><td>Угод</td><td class="v">${fmt(row.deals)}</td></tr>
        <tr><td>ЗП (база)</td><td class="v">${fmt(row.salary)} грн</td></tr>
        <tr><td>Премія</td><td class="v">${fmt(bonus)} грн</td></tr>
        <tr class="total"><td>Разом до виплати</td><td class="v">${fmt(total)} грн</td></tr>
      </table>
      <a class="btn" href="/" target="_blank" rel="noopener">Вхід в кабінет →</a>`;
    res.type('html').send(page(body));
  } catch (e) {
    res.status(500).type('html').send(page('<h1>Помилка</h1><div class="muted">' + esc(e.message) + '</div>'));
  }
}
