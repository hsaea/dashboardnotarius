import express from 'express';
import { syncFromKommo, ensureFresh, syncStatus } from './sync.js';
import {
  getSettings, setSettings, getBonuses, setBonus,
  getDealsForMonth, listMonths, listClosedMonths, getMonthlyClose,
  getDocTypeBreakdown, listWidgets, regenWidgetToken,
} from './db.js';
import { summarize, ledger, totals } from './aggregate.js';
import { login, requireAuth, requireCeo, scopeAssistant } from './auth.js';
import { ACTIVE_ASSISTANTS } from './config.js';
import { currentMonthKey } from './archive.js';

export const router = express.Router();

// --- Захист від перебору паролів ---
const attempts = new Map();
const MAX_FAILS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const throttle = (ip) => {
  const a = attempts.get(ip);
  return !(a && Date.now() - a.ts < WINDOW_MS && a.count >= MAX_FAILS);
};
const noteFail = (ip) => {
  const a = attempts.get(ip);
  if (a && Date.now() - a.ts < WINDOW_MS) a.count += 1;
  else attempts.set(ip, { count: 1, ts: Date.now() });
};

// --- Авторизація ---
router.post('/login', async (req, res, next) => {
  try {
    const ip = req.ip || 'unknown';
    if (!throttle(ip)) return res.status(429).json({ error: 'too_many_attempts' });
    const { login: loginName, password } = req.body || {};
    const user = await login(req, String(loginName || ''), String(password || ''));
    if (!user) { noteFail(ip); return res.status(401).json({ error: 'bad_credentials' }); }
    attempts.delete(ip);
    res.json({ user });
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', requireAuth, (req, res) => {
  const u = req.session.user;
  res.json({ user: u, assistants: u.role === 'ceo' ? ACTIVE_ASSISTANTS : [] });
});

// --- Місяці (архів) ---
router.get('/months', requireAuth, async (req, res, next) => {
  try {
    const [months, closed] = await Promise.all([listMonths(), listClosedMonths()]);
    const all = [...new Set([currentMonthKey(), ...months, ...closed])].sort().reverse();
    res.json({ months: all, frozen: closed, current: currentMonthKey() });
  } catch (e) { next(e); }
});

// Готує ставки/заморозку для місяця
async function resolveMonth(month) {
  const close = await getMonthlyClose(month);
  const frozen = !!close;
  const rates = frozen
    ? { sign_rate: close.sign_rate, act_rate: close.act_rate }
    : await getSettings();
  return { frozen, rates, frozen_at: close ? close.closed_at : null };
}

const withBonus = (rows, bonuses) => rows.map((r) => {
  const bonus = bonuses[r.assistant] || 0;
  return { ...r, bonus, total: r.salary + bonus };
});

// --- Підсумки ---
router.get('/summary', requireAuth, async (req, res, next) => {
  try {
    await ensureFresh();
    const month = req.query.month || currentMonthKey();
    const assistant = scopeAssistant(req, req.query.assistant || null);
    const { frozen, rates, frozen_at } = await resolveMonth(month);
    const deals = await getDealsForMonth(month, { frozen, assistant });
    const bonuses = await getBonuses(month);
    const rows = withBonus(summarize(deals, rates, { month, assistant }), bonuses);
    res.json({ month, assistant, frozen, frozen_at, rates, rows, totals: totals(rows) });
  } catch (e) { next(e); }
});

// --- Журнал угод (лог) — лише CEO ---
router.get('/ledger', requireAuth, requireCeo, async (req, res, next) => {
  try {
    await ensureFresh();
    const month = req.query.month || currentMonthKey();
    const assistant = scopeAssistant(req, req.query.assistant || null);
    const { frozen, rates } = await resolveMonth(month);
    const deals = await getDealsForMonth(month, { frozen, assistant });
    const rows = ledger(deals, rates, { month, assistant });
    res.json({ month, assistant, frozen, rows });
  } catch (e) { next(e); }
});

// --- Аналітика: динаміка по місяцях ---
router.get('/trends', requireAuth, async (req, res, next) => {
  try {
    await ensureFresh();
    const assistant = scopeAssistant(req, req.query.assistant || null);
    const months = await listMonths();
    const all = [...new Set([currentMonthKey(), ...months])].sort(); // за зростанням
    const series = [];
    for (const m of all) {
      const { frozen, rates } = await resolveMonth(m);
      const deals = await getDealsForMonth(m, { frozen, assistant });
      const t = totals(summarize(deals, rates, { month: m, assistant }));
      series.push({ month: m, acts: t.acts, signs: t.signs, deals: t.deals, salary: t.salary });
    }
    res.json({ assistant, series });
  } catch (e) { next(e); }
});

// --- Аналітика: розбивка по типах документів ---
router.get('/doctypes', requireAuth, async (req, res, next) => {
  try {
    await ensureFresh();
    const month = req.query.month || currentMonthKey();
    const assistant = scopeAssistant(req, req.query.assistant || null);
    const { frozen } = await resolveMonth(month);
    const rows = await getDocTypeBreakdown(month, { frozen, assistant });
    res.json({ month, assistant, rows });
  } catch (e) { next(e); }
});

// --- Експорт у CSV (Excel) ---
function toCsv(headers, rows) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
}

router.get('/export', requireAuth, async (req, res, next) => {
  try {
    await ensureFresh();
    const month = req.query.month || currentMonthKey();
    const assistant = scopeAssistant(req, req.query.assistant || null);
    const type = req.query.type === 'summary' ? 'summary' : 'ledger';
    // Журнал (логи) експортує лише CEO
    if (type === 'ledger' && req.session.user.role !== 'ceo') {
      return res.status(403).json({ error: 'forbidden' });
    }
    const { frozen, rates } = await resolveMonth(month);
    const deals = await getDealsForMonth(month, { frozen, assistant });

    let headers, lines;
    if (type === 'summary') {
      const bonuses = await getBonuses(month);
      const rows = withBonus(summarize(deals, rates, { month, assistant }), bonuses);
      headers = ['Помічник', 'Акти', 'Підписи', 'Угод', 'Бюджет', 'ЗП', 'Премія', 'Разом'];
      lines = rows.map((r) => [r.assistant, r.acts, r.signs, r.deals, r.budget, r.salary, r.bonus, r.total]);
    } else {
      const rows = ledger(deals, rates, { month, assistant });
      headers = ['Назва', 'Бюджет', 'Хто готує довіреність', 'К-ть актів', 'К-ть підписів',
        'Тип документа', 'Час', 'ID угоди', 'Посилання', 'ЗП'];
      lines = rows.map((r) => [r.name, r.budget, r.who, r.acts, r.signs, r.doc_type, r.time, r.id, r.url, r.salary]);
    }

    const csv = '﻿' + toCsv(headers, lines); // BOM для коректної кирилиці в Excel
    const fname = `${type}-${month}${assistant ? '-' + assistant : ''}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="export.csv"; filename*=UTF-8''${encodeURIComponent(fname)}`);
    res.send(csv);
  } catch (e) { next(e); }
});

// --- Ставки ---
router.get('/settings', requireAuth, async (req, res, next) => {
  try { res.json({ settings: await getSettings() }); } catch (e) { next(e); }
});
router.put('/settings', requireAuth, requireCeo, async (req, res, next) => {
  try {
    const s = await setSettings({ sign_rate: Number(req.body?.sign_rate), act_rate: Number(req.body?.act_rate) });
    res.json({ settings: s });
  } catch (e) { next(e); }
});

// --- Премія помічника за місяць (лише CEO) ---
router.put('/bonus', requireAuth, requireCeo, async (req, res, next) => {
  try {
    const { month, assistant } = req.body || {};
    const amount = Number(req.body?.amount);
    if (!month || !assistant) return res.status(400).json({ error: 'bad_request' });
    const bonuses = await setBonus(month, assistant, Number.isFinite(amount) ? amount : 0);
    res.json({ month, bonuses });
  } catch (e) { next(e); }
});

// --- Посилання-віджети менеджерів (лише CEO) ---
router.get('/widgets', requireAuth, requireCeo, async (req, res, next) => {
  try { res.json({ widgets: await listWidgets() }); } catch (e) { next(e); }
});
router.post('/widgets/:login/regen', requireAuth, requireCeo, async (req, res, next) => {
  try {
    const token = await regenWidgetToken(req.params.login);
    res.json({ login: req.params.login, token });
  } catch (e) { next(e); }
});

// --- Оновити з Kommo вручну ---
router.post('/refresh', requireAuth, async (req, res, next) => {
  try { const r = await syncFromKommo(); res.json({ ok: true, ...r, cache: await syncStatus() }); }
  catch (e) { next(e); }
});

router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const c = await syncStatus();
    if (req.session.user.role !== 'ceo') return res.json({ cache: { syncedAt: c.syncedAt, error: c.error } });
    res.json({ cache: c });
  } catch (e) { next(e); }
});
