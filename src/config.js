import 'dotenv/config';

// Воронка Expert-Docs та статус успіху
export const PIPELINE_ID = 9126955;
export const WON_STATUS_ID = 142;

// ID кастомних полів угоди в Kommo
export const FIELDS = {
  who: 1109817,    // "Хто готує довіреність?" — відповідальний за документи
  acts: 1120598,   // "К-ть актів"
  signs: 1120600,  // "К-ть підписів"
};

// Активні помічники (значення поля "Хто готує довіреність?").
// Христя більше не працює — у списку активних її немає.
export const ACTIVE_ASSISTANTS = ['Віта', 'Катерина'];

export const SUBDOMAIN = process.env.KOMMO_SUBDOMAIN || 'frankohold';
export const TOKEN = process.env.KOMMO_TOKEN || '';
export const API_BASE = `https://${SUBDOMAIN}.kommo.com/api/v4`;
export const leadUrl = (id) => `https://${SUBDOMAIN}.kommo.com/leads/detail/${id}`;

export const TZ = process.env.TZ_REGION || 'Europe/Kyiv';
export const SINCE_MONTH = process.env.SINCE_MONTH || '2026-10';
export const PORT = Number(process.env.PORT || 3000);
export const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
export const CACHE_TTL = Number(process.env.CACHE_TTL || 600) * 1000;

export const DEFAULT_SIGN_RATE = Number(process.env.SIGN_RATE || 220);
export const DEFAULT_ACT_RATE = Number(process.env.ACT_RATE || 330);

// Початок періоду (SINCE_MONTH) як Unix timestamp у поясі Києва
export function sinceEpoch() {
  const [y, m] = SINCE_MONTH.split('-').map(Number);
  // 1-ше число місяця 00:00 за Києвом. Зсув визначаємо надійно нижче.
  const guessUtc = Date.UTC(y, m - 1, 1, 0, 0, 0);
  // Коригуємо на зсув поясу Києва для цієї дати (+2 або +3 години)
  const offsetMin = tzOffsetMinutes(new Date(guessUtc), TZ);
  return Math.floor((guessUtc - offsetMin * 60 * 1000) / 1000);
}

// Зсув часового поясу (хвилини) для вказаної дати
export function tzOffsetMinutes(date, tz = TZ) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  return Math.round((asUTC - date.getTime()) / 60000);
}

// Ключ місяця "YYYY-MM" за Києвом із Unix timestamp (секунди)
export function monthKey(tsSeconds) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit',
  }).format(new Date(tsSeconds * 1000));
}

// Дата-час "DD.MM.YYYY HH:mm" за Києвом
export function fmtDateTime(tsSeconds) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('uk-UA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(tsSeconds * 1000)).map((x) => [x.type, x.value])
  );
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}
