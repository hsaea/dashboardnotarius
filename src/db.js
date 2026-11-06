import mysql from 'mysql2/promise';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { DB, DEFAULT_SIGN_RATE, DEFAULT_ACT_RATE, ACTIVE_ASSISTANTS, leadUrl } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const CREDS_FILE = path.join(DATA_DIR, 'initial-credentials.txt');

let pool;

export function getPool() {
  if (!pool) {
    if (!DB.database) throw new Error('DB_NAME не заданий у .env');
    pool = mysql.createPool({
      host: DB.host, port: DB.port, user: DB.user,
      password: DB.password, database: DB.database,
      charset: 'utf8mb4', connectionLimit: 5, waitForConnections: true,
    });
  }
  return pool;
}

const q = async (sql, params = []) => (await getPool().query(sql, params))[0];

async function createSchema() {
  await q(`CREATE TABLE IF NOT EXISTS users (
    login VARCHAR(64) PRIMARY KEY,
    pass_hash VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL,
    assistant_name VARCHAR(64) NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await q(`CREATE TABLE IF NOT EXISTS settings (
    id TINYINT PRIMARY KEY,
    sign_rate INT NOT NULL,
    act_rate INT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await q(`CREATE TABLE IF NOT EXISTS bonuses (
    month CHAR(7) NOT NULL,
    assistant VARCHAR(64) NOT NULL,
    amount INT NOT NULL,
    PRIMARY KEY (month, assistant)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await q(`CREATE TABLE IF NOT EXISTS deals (
    id BIGINT PRIMARY KEY,
    name VARCHAR(255),
    budget INT DEFAULT 0,
    who VARCHAR(64),
    acts INT DEFAULT 0,
    signs INT DEFAULT 0,
    closed_at BIGINT,
    month CHAR(7),
    missing TINYINT DEFAULT 0,
    missing_since BIGINT NULL,
    locked TINYINT DEFAULT 0,
    first_seen BIGINT,
    last_seen BIGINT,
    INDEX idx_month (month),
    INDEX idx_who (who)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await q(`CREATE TABLE IF NOT EXISTS monthly_close (
    month CHAR(7) PRIMARY KEY,
    sign_rate INT NOT NULL,
    act_rate INT NOT NULL,
    closed_at BIGINT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

// Переносить users/settings/bonuses зі старого data/store.json (щоб паролі не змінились)
async function migrateFromJson() {
  if (!fs.existsSync(STORE_FILE)) return;
  let store;
  try { store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); } catch { return; }

  const [[u]] = await getPool().query('SELECT COUNT(*) AS c FROM users');
  if (u.c === 0 && Array.isArray(store.users)) {
    for (const x of store.users) {
      await q('INSERT IGNORE INTO users (login, pass_hash, role, assistant_name) VALUES (?,?,?,?)',
        [x.login, x.pass_hash, x.role, x.assistant_name || null]);
    }
    console.log(`Перенесено користувачів зі store.json: ${store.users.length}`);
  }
  if (store.settings) {
    await q('INSERT IGNORE INTO settings (id, sign_rate, act_rate) VALUES (1,?,?)',
      [store.settings.sign_rate, store.settings.act_rate]);
  }
  if (store.bonuses) {
    for (const [month, byWho] of Object.entries(store.bonuses)) {
      for (const [assistant, amount] of Object.entries(byWho)) {
        await q('INSERT IGNORE INTO bonuses (month, assistant, amount) VALUES (?,?,?)', [month, assistant, amount]);
      }
    }
  }
}

async function ensureSettings() {
  await q('INSERT IGNORE INTO settings (id, sign_rate, act_rate) VALUES (1,?,?)',
    [DEFAULT_SIGN_RATE, DEFAULT_ACT_RATE]);
}

async function seedUsers() {
  const [[u]] = await getPool().query('SELECT COUNT(*) AS c FROM users');
  if (u.c > 0) return;

  const genPass = () => crypto.randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
  const lines = ['Початкові облікові дані (змініть паролі у надійному місці):', ''];
  const translit = { 'Віта': 'vita', 'Катерина': 'kateryna' };

  const mk = async (login, role, name) => {
    const pass = genPass();
    await q('INSERT INTO users (login, pass_hash, role, assistant_name) VALUES (?,?,?,?)',
      [login, bcrypt.hashSync(pass, 10), role, name || null]);
    lines.push(`${role === 'ceo' ? 'CEO' : 'Помічник (' + name + ')'} — логін: ${login} / пароль: ${pass}`);
  };

  await mk('ceo', 'ceo', null);
  for (const name of ACTIVE_ASSISTANTS) await mk(translit[name] || name.toLowerCase(), 'assistant', name);

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CREDS_FILE, lines.join('\n') + '\n', 'utf8');
  console.log('\n=== СТВОРЕНО АКАУНТИ ===\n' + lines.join('\n') + `\n(також у ${CREDS_FILE})\n`);
}

export async function initDb() {
  getPool();
  await createSchema();
  await migrateFromJson();
  await ensureSettings();
  await seedUsers();
}

// --- Користувачі ---
export async function findUser(login) {
  const rows = await q('SELECT * FROM users WHERE login=?', [login]);
  return rows[0] || null;
}
export function checkPassword(user, password) {
  return bcrypt.compareSync(password, user.pass_hash);
}

// --- Ставки ---
export async function getSettings() {
  const rows = await q('SELECT sign_rate, act_rate FROM settings WHERE id=1');
  return rows[0] || { sign_rate: DEFAULT_SIGN_RATE, act_rate: DEFAULT_ACT_RATE };
}
export async function setSettings({ sign_rate, act_rate }) {
  const cur = await getSettings();
  const s = Number.isFinite(sign_rate) ? sign_rate : cur.sign_rate;
  const a = Number.isFinite(act_rate) ? act_rate : cur.act_rate;
  await q('UPDATE settings SET sign_rate=?, act_rate=? WHERE id=1', [s, a]);
  return { sign_rate: s, act_rate: a };
}

// --- Премії ---
export async function getBonuses(month) {
  const rows = await q('SELECT assistant, amount FROM bonuses WHERE month=?', [month]);
  return Object.fromEntries(rows.map((r) => [r.assistant, r.amount]));
}
export async function setBonus(month, assistant, amount) {
  const n = Number(amount) || 0;
  if (n <= 0) await q('DELETE FROM bonuses WHERE month=? AND assistant=?', [month, assistant]);
  else await q(`INSERT INTO bonuses (month, assistant, amount) VALUES (?,?,?)
                ON DUPLICATE KEY UPDATE amount=VALUES(amount)`, [month, assistant, n]);
  return getBonuses(month);
}

// --- Угоди ---
function normalizeRow(r) {
  return {
    id: Number(r.id), name: r.name, price: r.budget, who: r.who,
    acts: r.acts, signs: r.signs, closed_at: Number(r.closed_at),
    missing: !!r.missing, locked: !!r.locked, url: leadUrl(r.id),
  };
}

// Угоди місяця з урахуванням заморозки:
// закритий місяць -> лише locked=1; відкритий -> лише present (missing=0)
export async function getDealsForMonth(month, { frozen, assistant = null } = {}) {
  const cond = frozen ? 'locked=1' : 'missing=0';
  const params = [month];
  let sql = `SELECT * FROM deals WHERE month=? AND ${cond}`;
  if (assistant) { sql += ' AND who=?'; params.push(assistant); }
  const rows = await q(sql, params);
  return rows.map(normalizeRow);
}

export async function listMonths() {
  const rows = await q('SELECT DISTINCT month FROM deals WHERE month IS NOT NULL ORDER BY month DESC');
  return rows.map((r) => r.month);
}

// --- Заморозка місяців ---
export async function getMonthlyClose(month) {
  const rows = await q('SELECT * FROM monthly_close WHERE month=?', [month]);
  return rows[0] || null;
}
export async function listClosedMonths() {
  const rows = await q('SELECT month FROM monthly_close');
  return rows.map((r) => r.month);
}
export async function closeMonth(month, rates, nowSec) {
  await q(`INSERT IGNORE INTO monthly_close (month, sign_rate, act_rate, closed_at) VALUES (?,?,?,?)`,
    [month, rates.sign_rate, rates.act_rate, nowSec]);
  // Зафіксувати угоди, що були присутні на момент закриття
  await q('UPDATE deals SET locked=1 WHERE month=? AND missing=0', [month]);
}

// --- Синхронізація: UPSERT пачки угод і позначення зниклих ---
export async function upsertDeals(deals, syncTs) {
  for (const d of deals) {
    await q(`INSERT INTO deals (id,name,budget,who,acts,signs,closed_at,month,missing,missing_since,first_seen,last_seen)
             VALUES (?,?,?,?,?,?,?,?,0,NULL,?,?)
             ON DUPLICATE KEY UPDATE name=VALUES(name), budget=VALUES(budget), who=VALUES(who),
               acts=VALUES(acts), signs=VALUES(signs), closed_at=VALUES(closed_at), month=VALUES(month),
               missing=0, missing_since=NULL, last_seen=VALUES(last_seen)`,
      [d.id, d.name, d.price, d.who, d.acts, d.signs, d.closed_at, d.month, syncTs, syncTs]);
  }
}
// Угоди у вікні, яких не було в цій синхронізації -> позначити missing (але не видаляти)
export async function markMissing(sinceEpoch, syncTs) {
  const res = await q(`UPDATE deals SET missing=1, missing_since=IFNULL(missing_since,?)
                       WHERE closed_at>=? AND last_seen<>? AND missing=0`, [syncTs, sinceEpoch, syncTs]);
  return res.affectedRows || 0;
}

export async function dealsCount() {
  const [[r]] = await getPool().query('SELECT COUNT(*) AS c FROM deals');
  return r.c;
}
