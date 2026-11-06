import express from 'express';
import { getLeads, cacheStatus } from './cache.js';
import { getSettings, setSettings, getSnapshot, listSnapshotMonths, getBonuses, setBonus } from './store.js';
import { summarize, ledger, totals, monthsFromLeads } from './aggregate.js';
import { login, requireAuth, requireCeo, scopeAssistant } from './auth.js';
import { ACTIVE_ASSISTANTS } from './config.js';
import { currentMonthKey } from './archive.js';

export const router = express.Router();

// --- Простий захист від перебору паролів (in-memory) ---
const attempts = new Map(); // ip -> { count, ts }
const MAX_FAILS = 10;
const WINDOW_MS = 15 * 60 * 1000;
function throttle(ip) {
  const a = attempts.get(ip);
  if (a && Date.now() - a.ts < WINDOW_MS && a.count >= MAX_FAILS) return false;
  return true;
}
function noteFail(ip) {
  const a = attempts.get(ip);
  if (a && Date.now() - a.ts < WINDOW_MS) a.count += 1;
  else attempts.set(ip, { count: 1, ts: Date.now() });
}
function resetFails(ip) { attempts.delete(ip); }

// --- Авторизація ---
router.post('/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (!throttle(ip)) return res.status(429).json({ error: 'too_many_attempts' });
  const { login: loginName, password } = req.body || {};
  const user = login(req, String(loginName || ''), String(password || ''));
  if (!user) { noteFail(ip); return res.status(401).json({ error: 'bad_credentials' }); }
  resetFails(ip);
  res.json({ user });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', requireAuth, (req, res) => {
  const u = req.session.user;
  // Список помічників потрібен лише CEO (для фільтра). Помічник його не отримує.
  res.json({ user: u, assistants: u.role === 'ceo' ? ACTIVE_ASSISTANTS : [] });
});

// --- Місяці (архів) ---
router.get('/months', requireAuth, async (req, res, next) => {
  try {
    const leads = await getLeads();
    const fromData = monthsFromLeads(leads);
    const frozen = listSnapshotMonths();
    // Поточний місяць завжди присутній (навіть якщо ще 0 угод — «починається з 0»)
    const months = [...new Set([currentMonthKey(), ...fromData, ...frozen])].sort().reverse();
    res.json({ months, frozen, current: currentMonthKey() });
  } catch (e) { next(e); }
});

// --- Підсумки ---
router.get('/summary', requireAuth, async (req, res, next) => {
  try {
    const month = req.query.month || null;
    const assistant = scopeAssistant(req, req.query.assistant || null);
    const rates = getSettings();

    // Додає премію (фіксована сума) та «Разом» до кожного рядка
    const bonuses = month ? getBonuses(month) : {};
    const withBonus = (list) => list.map((r) => {
      const bonus = bonuses[r.assistant] || 0;
      return { ...r, bonus, total: r.salary + bonus };
    });

    // Якщо місяць у архіві — віддаємо збережений знімок (премія накладається поверх)
    const snap = month ? getSnapshot(month) : null;
    if (snap) {
      let rows = snap.summary;
      if (assistant) rows = rows.filter((r) => r.assistant === assistant);
      rows = withBonus(rows);
      return res.json({
        month, assistant, frozen: true, frozen_at: snap.frozen_at,
        rates: snap.rates, rows, totals: totals(rows),
      });
    }

    const leads = await getLeads();
    const rows = withBonus(summarize(leads, rates, { month, assistant }));
    res.json({ month, assistant, frozen: false, rates, rows, totals: totals(rows) });
  } catch (e) { next(e); }
});

// --- Журнал угод (лог) ---
router.get('/ledger', requireAuth, async (req, res, next) => {
  try {
    const month = req.query.month || null;
    const assistant = scopeAssistant(req, req.query.assistant || null);

    const snap = month ? getSnapshot(month) : null;
    if (snap) {
      let rows = [];
      for (const [who, arr] of Object.entries(snap.ledger)) {
        if (assistant && who !== assistant) continue;
        rows = rows.concat(arr);
      }
      rows.sort((a, b) => (b.time_ts || 0) - (a.time_ts || 0));
      return res.json({ month, assistant, frozen: true, rows });
    }

    const rates = getSettings();
    const leads = await getLeads();
    const rows = ledger(leads, rates, { month, assistant });
    res.json({ month, assistant, frozen: false, rows });
  } catch (e) { next(e); }
});

// --- Ставки (лише CEO на зміну) ---
router.get('/settings', requireAuth, (req, res) => {
  res.json({ settings: getSettings() });
});

// --- Премія помічника за місяць (лише CEO) ---
router.put('/bonus', requireAuth, requireCeo, (req, res) => {
  const { month, assistant } = req.body || {};
  const amount = Number(req.body?.amount);
  if (!month || !assistant) return res.status(400).json({ error: 'bad_request' });
  const bonuses = setBonus(month, assistant, Number.isFinite(amount) ? amount : 0);
  res.json({ month, bonuses });
});

router.put('/settings', requireAuth, requireCeo, (req, res) => {
  const sign_rate = Number(req.body?.sign_rate);
  const act_rate = Number(req.body?.act_rate);
  const s = setSettings({ sign_rate, act_rate });
  res.json({ settings: s });
});

// --- Оновити кеш з Kommo вручну ---
router.post('/refresh', requireAuth, async (req, res, next) => {
  try {
    await getLeads({ force: true });
    res.json({ ok: true, cache: cacheStatus() });
  } catch (e) { next(e); }
});

router.get('/status', requireAuth, (req, res) => {
  const c = cacheStatus();
  // Загальну кількість угод бачить лише CEO; помічнику — тільки час оновлення
  if (req.session.user.role !== 'ceo') {
    return res.json({ cache: { fetchedAt: c.fetchedAt, error: c.error } });
  }
  res.json({ cache: c });
});
