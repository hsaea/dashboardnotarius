import express from 'express';
import session from 'express-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT, SESSION_SECRET, SINCE_MONTH, TZ } from './config.js';
import { initDb } from './db.js';
import { router as api } from './routes.js';
import { syncFromKommo, scheduleSync } from './sync.js';
import { archivePastMonths, scheduleMonthlyArchive } from './archive.js';
import { widgetPage } from './widget.js';

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

// Публічний віджет менеджера (доступ за токеном у посиланні)
app.get('/w/:token', widgetPage);

// API
app.use('/api', api);

// Обробник помилок
app.use((err, req, res, next) => {
  console.error('API error:', err.message);
  res.status(500).json({ error: 'server_error', message: err.message });
});

// Хостинг (adm.tools/Passenger) передає порт і хост через process.env.PORT / process.env.HOST
const LISTEN_PORT = process.env.PORT || PORT;
const LISTEN_HOST = process.env.HOST || undefined; // порожній HOST => усі інтерфейси
const listenArgs = LISTEN_HOST ? [LISTEN_PORT, LISTEN_HOST] : [LISTEN_PORT];

// Старт: БД -> перша синхронізація з Kommo -> автоархів -> планувальники
async function start() {
  await initDb();
  console.log('БД готова');

  app.listen(...listenArgs, () => {
    console.log(`\nДашборд Expert-Docs запущено на ${LISTEN_HOST || '0.0.0.0'}:${LISTEN_PORT}`);
    console.log(`Період з: ${SINCE_MONTH} | Пояс: ${TZ}`);
  });

  // Синхронізація та архів — у фоні, щоб не блокувати старт
  (async () => {
    try {
      const r = await syncFromKommo();
      console.log(`Синхронізація з Kommo: ${r.synced} угод (missing: ${r.missing})`);
      const archived = await archivePastMonths();
      if (archived.length) console.log('Заархівовано місяців:', archived.join(', '));
    } catch (e) {
      console.error('Помилка першої синхронізації:', e.message);
    }
    scheduleSync();
    scheduleMonthlyArchive();
  })();
}

start().catch((e) => {
  console.error('Фатальна помилка старту:', e.message);
  process.exit(1);
});
