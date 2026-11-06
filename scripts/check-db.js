// Перевірка підключення до MySQL і створення схеми.
// Запуск: node scripts/check-db.js
import { initDb, dealsCount, getSettings } from '../src/db.js';

try {
  await initDb();
  console.log('OK: підключення до MySQL працює, схема створена.');
  console.log('Угод у БД:', await dealsCount());
  console.log('Ставки:', await getSettings());
  process.exit(0);
} catch (e) {
  console.error('ПОМИЛКА БД:', e.message);
  process.exit(1);
}
