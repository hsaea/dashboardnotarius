import express from 'express';
import session from 'express-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT, SESSION_SECRET, SINCE_MONTH, TZ } from './config.js';
import { seedUsers } from './store.js';
import { router as api } from './routes.js';
import { getLeads } from './cache.js';
import { archivePastMonths, scheduleMonthlyArchive } from './archive.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '256kb' }));

// За reverse-proxy (nginx) на VPS увімкнути TRUST_PROXY=1, щоб secure-cookie й req.ip працювали
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

app.use(session({
  name: 'edsid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    // Увімкнути для HTTPS (на VPS): COOKIE_SECURE=1
    secure: process.env.COOKIE_SECURE === '1',
    maxAge: 1000 * 60 * 60 * 12,
  },
}));

// Статика (фронтенд)
const pub = path.join(__dirname, '..', 'public');
app.use(express.static(pub));

// API
app.use('/api', api);

// Обробник помилок
app.use((err, req, res, next) => {
  console.error('API error:', err.message);
  res.status(500).json({ error: 'server_error', message: err.message });
});

// Старт
seedUsers();
app.listen(PORT, () => {
  console.log(`\nДашборд Expert-Docs запущено: http://localhost:${PORT}`);
  console.log(`Період з: ${SINCE_MONTH} | Пояс: ${TZ}`);
  // Прогріваємо кеш, тоді автоархівуємо завершені місяці й запускаємо щогодинну перевірку
  getLeads()
    .then(async (l) => {
      console.log(`Кеш Kommo прогріто: ${l.length} угод`);
      const archived = await archivePastMonths();
      if (archived.length) console.log('Заархівовано місяців:', archived.join(', '));
      scheduleMonthlyArchive();
    })
    .catch((e) => console.error('Не вдалося прогріти кеш:', e.message));
});
