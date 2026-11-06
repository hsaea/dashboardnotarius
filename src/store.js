import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { DEFAULT_SIGN_RATE, DEFAULT_ACT_RATE, ACTIVE_ASSISTANTS } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const CREDS_FILE = path.join(DATA_DIR, 'initial-credentials.txt');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function emptyStore() {
  return {
    users: [],
    settings: { sign_rate: DEFAULT_SIGN_RATE, act_rate: DEFAULT_ACT_RATE },
    // snapshots[month] = { frozen_at, rates, summary:[], ledger:{assistant:[...]} }
    snapshots: {},
    // bonuses[month][assistant] = сума премії, грн
    bonuses: {},
  };
}

let cache = null;

export function load() {
  ensureDir();
  if (cache) return cache;
  if (fs.existsSync(STORE_FILE)) {
    cache = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } else {
    cache = emptyStore();
    save();
  }
  return cache;
}

export function save() {
  ensureDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(cache, null, 2));
}

// Створює акаунти при першому запуску й записує паролі у data/initial-credentials.txt
export function seedUsers() {
  const s = load();
  if (s.users && s.users.length) return;

  const genPass = () => crypto.randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
  const lines = ['Початкові облікові дані (змініть паролі у надійному місці):', ''];

  const mkUser = (login, role, assistantName) => {
    const pass = genPass();
    s.users.push({
      login,
      role,                       // 'ceo' | 'assistant'
      assistant_name: assistantName || null,
      pass_hash: bcrypt.hashSync(pass, 10),
    });
    lines.push(`${role === 'ceo' ? 'CEO' : 'Помічник (' + assistantName + ')'} — логін: ${login} / пароль: ${pass}`);
  };

  mkUser('ceo', 'ceo', null);
  // Логіни помічників за транслітерацією імен
  const translit = { 'Віта': 'vita', 'Катерина': 'kateryna' };
  for (const name of ACTIVE_ASSISTANTS) {
    mkUser(translit[name] || name.toLowerCase(), 'assistant', name);
  }

  save();
  ensureDir();
  fs.writeFileSync(CREDS_FILE, lines.join('\n') + '\n', 'utf8');
  console.log('\n=== СТВОРЕНО АКАУНТИ ===');
  console.log(lines.join('\n'));
  console.log(`(також збережено у ${CREDS_FILE})\n`);
}

export function findUser(login) {
  return load().users.find((u) => u.login === login);
}

export function checkPassword(user, password) {
  return bcrypt.compareSync(password, user.pass_hash);
}

export function getSettings() {
  return { ...load().settings };
}

export function setSettings({ sign_rate, act_rate }) {
  const s = load();
  if (Number.isFinite(sign_rate)) s.settings.sign_rate = Number(sign_rate);
  if (Number.isFinite(act_rate)) s.settings.act_rate = Number(act_rate);
  save();
  return { ...s.settings };
}

export function getSnapshot(month) {
  return load().snapshots[month] || null;
}

export function setSnapshot(month, payload) {
  const s = load();
  s.snapshots[month] = payload;
  save();
  return payload;
}

export function deleteSnapshot(month) {
  const s = load();
  delete s.snapshots[month];
  save();
}

export function listSnapshotMonths() {
  return Object.keys(load().snapshots);
}

// --- Премії (фіксована сума на помічника за місяць) ---
export function getBonuses(month) {
  const s = load();
  return (s.bonuses && s.bonuses[month]) || {};
}

export function setBonus(month, assistant, amount) {
  const s = load();
  s.bonuses = s.bonuses || {};
  s.bonuses[month] = s.bonuses[month] || {};
  const n = Number(amount) || 0;
  if (n <= 0) delete s.bonuses[month][assistant];
  else s.bonuses[month][assistant] = n;
  save();
  return getBonuses(month);
}
