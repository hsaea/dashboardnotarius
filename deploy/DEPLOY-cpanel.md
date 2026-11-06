# Деплой на shared-хостинг із підтримкою Node.js (Passenger) — notar.kommo.ooo

Для українських хостингів зі своєю панеллю / cPanel (Хостинг Україна, HostPro, Hostiq тощо),
шлях виду `/home/up466912/kommo.ooo/notar/`. Node.js-додаток керується панеллю (Passenger),
а не systemd. SSH потрібен для `git clone` і `npm install`.

> ВАЖЛИВО: це Node.js-застосунок. Хостинг МАЄ підтримувати Node.js (розділ «Node.js»
> у панелі). Якщо хостинг лише PHP/статика — застосунок не запуститься, потрібен VPS.
> Нижче — приклад для cPanel; для іншої панелі логіка та сама (вказати стартовий файл app.js).

---

## 1. Піддомен (якщо ще не створено)
cPanel → **Domains / Subdomains** → створити `notar.kommo.ooo` з Document Root
`kommo.ooo/notar` (саме та папка, що у вас).

## 2. Код через SSH
```bash
ssh up466912@СЕРВЕР
cd ~/kommo.ooo/notar
# якщо папка порожня:
git clone https://github.com/hsaea/dashboardnotarius.git .
# (крапка в кінці — клон у поточну папку)
```
Якщо папка не порожня — склонуйте поряд і перенесіть файли, або очистьте її заздалегідь.

## 3. Файл .env (секрети лише на сервері)
```bash
cp .env.example .env
nano .env
```
Заповнити:
- `KOMMO_SUBDOMAIN=frankohold`
- `KOMMO_TOKEN=` — ваш токен Kommo
- `SESSION_SECRET=` — випадковий рядок
  (`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`)
- Розкоментувати для HTTPS (cPanel AutoSSL ставить сертифікат автоматично):
  `COOKIE_SECURE=1` і `TRUST_PROXY=1`
```bash
chmod 600 .env
```

## 4. Створити Node.js-додаток у cPanel
cPanel → **Setup Node.js App** → **Create Application**:
- **Node.js version:** 20.x (або найновіша доступна)
- **Application mode:** Production
- **Application root:** `kommo.ooo/notar`
- **Application URL:** `notar.kommo.ooo`
- **Application startup file:** `app.js`
- Створити.

## 5. Встановити залежності
На сторінці додатку натиснути **Run NPM Install** (або у SSH — командою, яку
панель показує для входу у virtualenv, тоді `npm install --omit=dev`).

## 6. Запуск / перезапуск
Кнопка **Restart** на сторінці додатку. Готово — відкрити https://notar.kommo.ooo

> Початкові логіни/паролі (CEO + помічники) друкуються в лог при першому старті
> і зберігаються у `~/kommo.ooo/notar/data/initial-credentials.txt`.
> **Збережіть і видаліть файл:** `rm ~/kommo.ooo/notar/data/initial-credentials.txt`

---

## Оновлення після змін у git
```bash
cd ~/kommo.ooo/notar
git pull
# якщо мінялись залежності — Run NPM Install у панелі
mkdir -p tmp && touch tmp/restart.txt   # перезапуск Passenger
```
(або просто кнопка **Restart** у cPanel)

## Якщо панель ISPmanager (а не cPanel)
Розділ **WWW-домени → Node.js**: вкажіть робочу папку `~/kommo.ooo/notar`,
стартовий файл `app.js`, версію Node 20 — решта (git, .env) так само. Скажіть мені —
дам точні кроки під ISPmanager.

## Примітки
- Порт слухати не треба — Passenger передає його сам через `PORT` (код це враховує).
- HTTPS: cPanel AutoSSL видає сертифікат на піддомен автоматично (можна перевірити у
  **SSL/TLS Status**). Після появи сертифіката — `COOKIE_SECURE=1`, `TRUST_PROXY=1`, Restart.
- Бекап даних: файл `data/store.json` (архів, премії, користувачі).
