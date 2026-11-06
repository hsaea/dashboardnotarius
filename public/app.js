const $ = (id) => document.getElementById(id);
const api = async (url, opts = {}) => {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (res.status === 401) { showLogin(); throw new Error('unauth'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return data;
};
const fmt = (n) => Number(n || 0).toLocaleString('uk-UA');

let ME = null;
let ASSISTANTS = [];
let RATES = { sign_rate: 0, act_rate: 0 };

function showLogin() {
  $('login-view').classList.remove('hidden');
  $('app-view').classList.add('hidden');
}
function showApp() {
  $('login-view').classList.add('hidden');
  $('app-view').classList.remove('hidden');
}

// --- Вхід ---
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ login: $('login').value, password: $('password').value }) });
    await init();
  } catch {
    $('login-error').textContent = 'Невірний логін або пароль';
  }
});

$('logout-btn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  showLogin();
});

$('refresh-btn').addEventListener('click', async () => {
  $('refresh-btn').disabled = true;
  try { await api('/api/refresh', { method: 'POST' }); await reload(); } finally { $('refresh-btn').disabled = false; }
});

// --- Контролери ---
$('month-select').addEventListener('change', reload);
$('assistant-select').addEventListener('change', reload);

// --- Експорт у CSV ---
function downloadExport(type) {
  const month = $('month-select').value;
  const assistant = ME.role === 'ceo' ? $('assistant-select').value : '';
  const q = new URLSearchParams({ type, month });
  if (assistant) q.set('assistant', assistant);
  window.location.href = '/api/export?' + q.toString();
}
$('exp-ledger').addEventListener('click', () => downloadExport('ledger'));
$('exp-summary').addEventListener('click', () => downloadExport('summary'));

// --- Згортання журналу ---
$('toggle-ledger').addEventListener('click', () => {
  const hidden = $('ledger-wrap').classList.toggle('hidden');
  $('toggle-ledger').textContent = hidden ? 'Розгорнути' : 'Згорнути';
});

// --- Згортання аналітики ---
$('toggle-analytics').addEventListener('click', () => {
  const hidden = $('analytics-wrap').classList.toggle('hidden');
  $('toggle-analytics').textContent = hidden ? 'Розгорнути' : 'Згорнути';
});

// --- Згортання посилань-віджетів ---
$('toggle-widgets').addEventListener('click', () => {
  const hidden = $('widgets-wrap').classList.toggle('hidden');
  $('toggle-widgets').textContent = hidden ? 'Розгорнути' : 'Згорнути';
});

// --- Посилання-віджети (CEO) ---
function widgetUrl(token) { return location.origin + '/w/' + token; }
async function loadWidgets() {
  const { widgets } = await api('/api/widgets');
  const box = $('widgets-wrap');
  box.innerHTML = `<p class="muted small">Персональне посилання кожного менеджера — вставте в дашборд Kommo. Кожен бачить лише свої підсумки.</p>` +
    widgets.map((w) => {
      const url = widgetUrl(w.token);
      return `<div class="wrow">
        <span class="wname">${escapeHtml(w.name)}</span>
        <input class="wurl" readonly value="${escapeHtml(url)}" onclick="this.select()" />
        <button class="ghost btn-sm wcopy" data-url="${escapeHtml(url)}">Копіювати</button>
        <button class="ghost btn-sm wregen" data-login="${escapeHtml(w.login)}">Оновити токен</button>
      </div>`;
    }).join('');
  box.querySelectorAll('.wcopy').forEach((b) => b.addEventListener('click', () => {
    navigator.clipboard.writeText(b.dataset.url).then(() => {
      b.textContent = 'Скопійовано'; setTimeout(() => (b.textContent = 'Копіювати'), 1500);
    });
  }));
  box.querySelectorAll('.wregen').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Оновити токен? Старе посилання перестане працювати.')) return;
    await api('/api/widgets/' + encodeURIComponent(b.dataset.login) + '/regen', { method: 'POST' });
    await loadWidgets();
  }));
}

$('save-rates').addEventListener('click', async () => {
  const sign = Number($('sign-rate').value);
  const act = Number($('act-rate').value);
  if (!Number.isFinite(sign) || !Number.isFinite(act) || sign < 0 || act < 0) {
    alert('Ставки мають бути невідʼємними числами.');
    return;
  }
  if (sign === RATES.sign_rate && act === RATES.act_rate) {
    alert('Ставки не змінилися.');
    return;
  }
  const msg =
    'Зберегти нові ставки?\n\n' +
    `Підпис: ${RATES.sign_rate} → ${sign} грн\n` +
    `Акт: ${RATES.act_rate} → ${act} грн\n\n` +
    'Поточний місяць буде перерахований за новими ставками. Архівні місяці не зміняться.';
  if (!confirm(msg)) {
    // відновити попередні значення у полях
    $('sign-rate').value = RATES.sign_rate;
    $('act-rate').value = RATES.act_rate;
    return;
  }
  const r = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ sign_rate: sign, act_rate: act }) });
  RATES = { sign_rate: r.settings.sign_rate, act_rate: r.settings.act_rate };
  await reload();
  alert('Ставки збережено.');
});

// --- Ініціалізація ---
async function init() {
  const me = await api('/api/me');
  ME = me.user; ASSISTANTS = me.assistants || [];
  showApp();

  $('who-am-i').textContent = ME.role === 'ceo' ? 'CEO' : ME.assistant_name;
  $('role-badge').textContent = ME.role === 'ceo' ? '· керівник' : '· помічник';

  const isCeo = ME.role === 'ceo';
  $('ceo-tools').classList.toggle('hidden', !isCeo);
  $('assistant-filter-wrap').classList.toggle('hidden', !isCeo);

  // Журнал угод (логи) — лише для CEO
  $('ledger-heading').classList.toggle('hidden', !isCeo);
  $('ledger-wrap').classList.add('hidden');
  $('exp-ledger').classList.toggle('hidden', !isCeo);

  // Посилання-віджети — лише CEO
  $('widgets-box').classList.toggle('hidden', !isCeo);
  if (isCeo) loadWidgets().catch(() => {});

  // Фільтр помічників (лише CEO)
  if (isCeo) {
    const sel = $('assistant-select');
    sel.innerHTML = '<option value="">Усі помічники</option>' +
      ASSISTANTS.map((a) => `<option value="${a}">${a}</option>`).join('');
  }

  // Ставки
  const s = await api('/api/settings');
  RATES = { sign_rate: s.settings.sign_rate, act_rate: s.settings.act_rate };
  $('sign-rate').value = s.settings.sign_rate;
  $('act-rate').value = s.settings.act_rate;

  await loadMonths();
  await reload();
  refreshStatus();
  startAutoRefresh();
}

async function loadMonths() {
  const { months } = await api('/api/months');
  const sel = $('month-select');
  const prev = sel.value;
  sel.innerHTML = months.map((m) => `<option value="${m}">${m}</option>`).join('');
  if (months.includes(prev)) sel.value = prev;
}

async function reload() {
  const month = $('month-select').value;
  const assistant = ME.role === 'ceo' ? $('assistant-select').value : '';
  const q = new URLSearchParams({ month });
  if (assistant) q.set('assistant', assistant);

  const sum = await api('/api/summary?' + q.toString());
  renderSummary(sum);

  // Журнал — лише CEO
  if (ME.role === 'ceo') {
    const led = await api('/api/ledger?' + q.toString());
    renderLedger(led);
  }

  // Аналітика — кругові діаграми (не ламає сторінку при помилці)
  try { renderPies(sum); } catch {}
  loadDocTypes().catch(() => {});

  // Бейдж архіву (місяць закрито автоматично)
  $('frozen-badge').classList.toggle('hidden', !sum.frozen);
}

function renderSummary(data) {
  const tb = $('summary-table').querySelector('tbody');
  const tf = $('summary-table').querySelector('tfoot');
  const isCeo = ME.role === 'ceo';
  tb.innerHTML = data.rows.map((r) => {
    const bonusCell = isCeo
      ? `<input class="bonus-inp" data-a="${escapeHtml(r.assistant)}" type="number" min="0" step="1" value="${r.bonus || 0}" />`
      : fmt(r.bonus || 0);
    return `
    <tr>
      <td>${r.assistant}</td>
      <td class="num">${fmt(r.acts)}</td>
      <td class="num">${fmt(r.signs)}</td>
      <td class="num">${fmt(r.deals)}</td>
      <td class="num">${fmt(r.budget)}</td>
      <td class="num">${fmt(r.salary)}</td>
      <td class="num">${bonusCell}</td>
      <td class="num strong">${fmt(r.total)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" class="muted">Немає даних за цей період</td></tr>`;

  const t = data.totals;
  tf.innerHTML = `<tr class="total">
    <td>Разом${data.rates ? ` <span class="muted small">(підпис ${data.rates.sign_rate} / акт ${data.rates.act_rate} грн)</span>` : ''}</td>
    <td class="num">${fmt(t.acts)}</td><td class="num">${fmt(t.signs)}</td>
    <td class="num">${fmt(t.deals)}</td><td class="num">${fmt(t.budget)}</td>
    <td class="num">${fmt(t.salary)}</td><td class="num">${fmt(t.bonus)}</td>
    <td class="num strong">${fmt(t.total)}</td></tr>`;

  // Редагування премії (лише CEO)
  if (isCeo) {
    tb.querySelectorAll('.bonus-inp').forEach((inp) => {
      inp.addEventListener('change', async () => {
        const month = $('month-select').value;
        await api('/api/bonus', {
          method: 'PUT',
          body: JSON.stringify({ month, assistant: inp.dataset.a, amount: Number(inp.value) }),
        });
        await reload();
      });
    });
  }
}

function renderLedger(data) {
  const tb = $('ledger-table').querySelector('tbody');
  $('ledger-count').textContent = `(${data.rows.length})`;
  tb.innerHTML = data.rows.map((r) => `
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td class="num">${fmt(r.budget)}</td>
      <td>${r.who}</td>
      <td class="num">${fmt(r.acts)}</td>
      <td class="num">${fmt(r.signs)}</td>
      <td class="nowrap">${r.time}</td>
      <td class="num">${r.id}</td>
      <td class="num">${fmt(r.salary)}</td>
      <td><a href="${r.url}" target="_blank" rel="noopener">угода ↗</a></td>
    </tr>`).join('') || `<tr><td colspan="9" class="muted">Немає угод</td></tr>`;
}

// Кругова (donut) діаграма
const PIE_COLORS = ['#4f8cff', '#2ecc8f', '#ffb020', '#ff6b6b', '#a66cff', '#19c3d6', '#8a97b4'];
function pieChart(items, { size = 150 } = {}) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!total) return '<div class="muted">Немає даних</div>';
  const cx = size / 2, cy = size / 2, r = size / 2 - 2, rin = r * 0.56;
  let a0 = -Math.PI / 2, paths = '';
  items.forEach((it, idx) => {
    const frac = it.value / total;
    const a1 = a0 + frac * 2 * Math.PI;
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const p = (ang, rad) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
    const [x0, y0] = p(a0, r), [x1, y1] = p(a1, r);
    const [xi1, yi1] = p(a1, rin), [xi0, yi0] = p(a0, rin);
    const color = it.color || PIE_COLORS[idx % PIE_COLORS.length];
    paths += `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} L${xi1.toFixed(1)} ${yi1.toFixed(1)} A${rin} ${rin} 0 ${large} 0 ${xi0.toFixed(1)} ${yi0.toFixed(1)} Z" fill="${color}"><title>${escapeHtml(it.label)}: ${it.value} (${Math.round(frac * 100)}%)</title></path>`;
    a0 = a1;
  });
  const legend = items.map((it, idx) =>
    `<span class="lg"><i style="background:${it.color || PIE_COLORS[idx % PIE_COLORS.length]}"></i>${escapeHtml(it.label)} — ${it.value}</span>`).join('');
  return `<div class="pie-wrap"><svg viewBox="0 0 ${size} ${size}" class="pie">${paths}</svg><div class="legend pie-legend">${legend}</div></div>`;
}

// Кругові діаграми з даних підсумків (частка помічників, акти/підписи)
function renderPies(sum) {
  const tile = $('tile-assistants');
  if (ME.role === 'ceo' && sum.rows.length > 1) {
    tile.classList.remove('hidden');
    const items = sum.rows.map((r, i) => ({ label: r.assistant, value: r.salary, color: PIE_COLORS[i % PIE_COLORS.length] }));
    $('pie-assistants').innerHTML = pieChart(items, { size: 130 });
  } else {
    tile.classList.add('hidden');
  }
  const t = sum.totals;
  $('pie-actsigns').innerHTML = pieChart([
    { label: 'Підписи', value: t.signs, color: '#4f8cff' },
    { label: 'Акти', value: t.acts, color: '#2ecc8f' },
  ], { size: 130 });
}

// Кругова діаграма типів документів (топ-6 + «Інші»)
async function loadDocTypes() {
  const month = $('month-select').value;
  const assistant = ME.role === 'ceo' ? $('assistant-select').value : '';
  const q = new URLSearchParams({ month });
  if (assistant) q.set('assistant', assistant);
  const { rows } = await api('/api/doctypes?' + q.toString());
  $('dt-month').textContent = month;
  const short = (s) => { const t = String(s || ''); return t.length > 24 ? t.slice(0, 23) + '…' : t; };
  const top = rows.slice(0, 6).map((r) => ({ label: short(r.doc_type), value: r.deals }));
  const restVal = rows.slice(6).reduce((s, r) => s + r.deals, 0);
  if (restVal > 0) top.push({ label: 'Інші', value: restVal });
  $('pie-doctypes').innerHTML = pieChart(top, { size: 130 });
}

async function refreshStatus() {
  try {
    const { cache } = await api('/api/status');
    const when = cache.syncedAt ? new Date(cache.syncedAt).toLocaleTimeString('uk-UA') : '—';
    const countPart = cache.count != null ? `дані: ${cache.count} угод, ` : '';
    $('cache-info').textContent = `${countPart}оновлено ${when}` + (cache.error ? ` ⚠ ${cache.error}` : '');
  } catch {}
}

// Автооновлення: дані (премії, ставки, нові угоди) синхронізуються без ручного оновлення
let autoTimer = null;
function startAutoRefresh() {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = setInterval(async () => {
    // Не оновлюємо, поки CEO редагує поле (щоб не збити ввід)
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    try { await reload(); await refreshStatus(); } catch {}
  }, 60 * 1000);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Старт: перевіряємо сесію
api('/api/me').then(() => init()).catch(() => showLogin());
