import { fetchWonLeads } from './kommo.js';
import { sinceEpoch, SYNC_INTERVAL, monthKey } from './config.js';
import { upsertDeals, markMissing, dealsCount } from './db.js';

let lastSync = 0;
let lastError = null;
let inflight = null;

// Тягне угоди з Kommo і зберігає в БД (UPSERT). Зниклі угоди не видаляє — позначає missing.
export async function syncFromKommo() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const since = sinceEpoch();
      const leads = await fetchWonLeads(since);
      const syncTs = Math.floor(Date.now() / 1000);
      const withMonth = leads
        .filter((l) => l.who && l.closed_at)
        .map((l) => ({
          ...l,
          name: String(l.name || '').slice(0, 255),
          price: Math.round(Number(l.price) || 0),
          acts: Math.round(Number(l.acts) || 0),
          signs: Math.round(Number(l.signs) || 0),
          month: monthKey(l.closed_at),
        }));
      await upsertDeals(withMonth, syncTs);
      const missing = await markMissing(since, syncTs);
      lastSync = Date.now();
      lastError = null;
      return { synced: withMonth.length, missing };
    } catch (e) {
      lastError = e;
      throw e;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// Синхронізувати, якщо дані застарілі (TTL)
export async function ensureFresh() {
  if (Date.now() - lastSync < SYNC_INTERVAL) return;
  try { await syncFromKommo(); } catch { /* помилку видно у статусі */ }
}

export function scheduleSync() {
  setInterval(() => {
    syncFromKommo().catch((e) => console.error('Помилка синхронізації:', e.message));
  }, SYNC_INTERVAL);
}

export async function syncStatus() {
  return {
    count: await dealsCount().catch(() => null),
    syncedAt: lastSync ? new Date(lastSync).toISOString() : null,
    intervalMs: SYNC_INTERVAL,
    error: lastError ? String(lastError.message || lastError) : null,
  };
}
