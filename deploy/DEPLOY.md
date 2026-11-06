# Деплой на VPS (Ubuntu 22.04/24.04)

Інструкція для українського хостингу (HostPro, Tucha, DeltaHost, FreeHost, Mirohost тощо).
Мінімум: **1 vCPU / 1 GB RAM**, Ubuntu. Потрібен SSH-доступ (root або sudo).

---

## 0. Підключення
```bash
ssh root@IP_СЕРВЕРА
```

## 1. Базові пакети + Node.js 20
```bash
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git nginx
node -v    # має бути v20.x
```

## 2. Окремий користувач для застосунку
```bash
adduser --system --group --home /opt/dashboardnotarius nodeapp
```

## 3. Клон репозиторію
```bash
cd /opt
git clone https://github.com/hsaea/dashboardnotarius.git
cd dashboardnotarius
npm install --omit=dev
```

## 4. Налаштування .env (СЕКРЕТИ — лише на сервері)
```bash
cp .env.example .env
nano .env
```
Заповнити:
- `KOMMO_TOKEN` — довготривалий токен Kommo
- `SESSION_SECRET` — випадковий рядок (згенерувати: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`)
- Для HTTPS розкоментувати: `COOKIE_SECURE=1` та `TRUST_PROXY=1`

Права доступу (щоб .env читав лише застосунок):
```bash
chown -R nodeapp:nodeapp /opt/dashboardnotarius
chmod 600 /opt/dashboardnotarius/.env
```

## 5. Автозапуск через systemd
```bash
cp deploy/expert-docs.service /etc/systemd/system/
# перевірте шлях до node: which node  (якщо не /usr/bin/node — виправте у файлі)
systemctl daemon-reload
systemctl enable --now expert-docs
systemctl status expert-docs        # має бути active (running)
journalctl -u expert-docs -n 30     # лог; тут же друкуються початкові паролі
```
> ⚠️ На першому старті в лозі зʼявляться логіни/паролі (CEO + помічники).
> Також вони у `data/initial-credentials.txt`. **Збережіть їх і видаліть файл:**
> `rm /opt/dashboardnotarius/data/initial-credentials.txt`

## 6. Nginx reverse-proxy
```bash
cp deploy/nginx-expert-docs.conf /etc/nginx/sites-available/expert-docs
# заміни домен у файлі:
nano /etc/nginx/sites-available/expert-docs
ln -s /etc/nginx/sites-available/expert-docs /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

## 7. HTTPS (Let's Encrypt) — потрібен домен, спрямований A-записом на IP
```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d dashboard.example.com
```
Certbot додасть сертифікат і редірект на HTTPS. Після цього переконайтесь, що в `.env`
стоїть `COOKIE_SECURE=1` і `TRUST_PROXY=1`, і перезапустіть:
```bash
systemctl restart expert-docs
```

## 8. Фаєрвол
```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```
Порт 3000 назовні **не відкривати** — доступ лише через nginx.

---

## Оновлення версії (після змін у git)
```bash
cd /opt/dashboardnotarius
git pull
npm install --omit=dev
systemctl restart expert-docs
```

## Корисне
- Логи: `journalctl -u expert-docs -f`
- Рестарт: `systemctl restart expert-docs`
- Дані (архів, премії, користувачі) зберігаються у `data/store.json` — **робіть бекап** цього файлу.

## Без домену (тимчасово, по IP)
Можна пропустити кроки 6–7 і відкрити порт напряму (менш безпечно, без HTTPS):
у `.env` лишити `COOKIE_SECURE` вимкненим, `ufw allow 3000`, заходити на `http://IP:3000`.
Рекомендовано все ж використати домен + HTTPS.
