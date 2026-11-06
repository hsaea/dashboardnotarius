import { fetchWonLeads } from './kommo.js';
import { sinceEpoch, CACHE_TTL } from './config.js';

let leads = [];
let fetchedAt = 0;
let inflight = null;
let lastError = null;

// Повертає угоди з кешу; оновлює при простроченні TTL або force
export async function getLeads({ force = false } = {}) {
  const fresh = Date.now() - fetchedAt < CACHE_TTL && leads.length >= 0 && fetchedAt > 0;
  if (!force && fresh) return leads;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const data = await fetchWonLeads(sinceEpoch());
      leads = data;
      fetchedAt = Date.now();
      lastError = null;
      return leads;
    } catch (e) {
      lastError = e;
      // Якщо вже є попередні дані — віддаємо їх, помилку лишаємо для статусу
      if (leads.length) return leads;
      throw e;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function cacheStatus() {
  return {
    count: leads.length,
    fetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null,
    ttlMs: CACHE_TTL,
    error: lastError ? String(lastError.message || lastError) : null,
  };
}
