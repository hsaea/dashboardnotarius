import express from 'express';
import { syncFromKommo, ensureFresh, syncStatus } from './sync.js';
import {
  getSettings, setSettings, getBonuses, setBonus,
  getDealsForMonth, listMonths, listClosedMonths, getMonthlyClose,
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

// --- Журнал угод (лог) ---
router.get('/ledger', requireAuth, async (req, res, next) => {
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
