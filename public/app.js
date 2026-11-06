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

  const led = await api('/api/ledger?' + q.toString());
  renderLedger(led);

  // Аналітика (не ламає сторінку при помилці)
  loadTrends().catch(() => {});
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

// --- Аналітика: графіки та типи документів ---
function barChart(months, seriesDefs, { height = 170, fmt: fmtFn = (v) => v } = {}) {
  if (!months.length) return '<div class="muted">Немає даних</div>';
  const max = Math.max(1, ...months.flatMap((m) => seriesDefs.map((s) => m[s.key] || 0)));
  const nS = seriesDefs.length;
  const groupW = 46, gap = 16, barW = Math.max(6, (groupW - (nS - 1) * 2) / nS);
  const W = 36 + months.length * (groupW + gap), H = height, base = H - 24, top = 12;
  const scale = (v) => (base - top) * (v / max);
  let bars = '';
  months.forEach((m, i) => {
    const gx = 30 + i * (groupW + gap);
    seriesDefs.forEach((s, j) => {
      const v = m[s.key] || 0, h = scale(v), x = gx + j * (barW + 2);
      bars += `<rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${s.color}"><title>${m.month} · ${s.label}: ${fmtFn(v)}</title></rect>`;
    });
    bars += `<text x="${gx + (groupW) / 2}" y="${H - 7}" text-anchor="middle" class="axlbl">${m.month.slice(2)}</text>`;
  });
  const legend = seriesDefs.map((s) => `<span class="lg"><i style="background:${s.color}"></i>${s.label}</span>`).join('');
  return `<div class="legend">${legend}</div><svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="xMinYMid meet">${bars}</svg>`;
}

async function loadTrends() {
  const assistant = ME.role === 'ceo' ? $('assistant-select').value : '';
  const q = new URLSearchParams();
  if (assistant) q.set('assistant', assistant);
  const { series } = await api('/api/trends?' + q.toString());
  $('chart-acts-signs').innerHTML = barChart(series, [
    { key: 'signs', color: '#4f8cff', label: 'Підписи' },
    { key: 'acts', color: '#2ecc8f', label: 'Акти' },
  ]);
  $('chart-salary').innerHTML = barChart(series, [
    { key: 'salary', color: '#ffb020', label: 'ЗП, грн' },
  ], { fmt });
}

async function loadDocTypes() {
  const month = $('month-select').value;
  const assistant = ME.role === 'ceo' ? $('assistant-select').value : '';
  const q = new URLSearchParams({ month });
  if (assistant) q.set('assistant', assistant);
  const { rows } = await api('/api/doctypes?' + q.toString());
  $('dt-month').textContent = month;
  const tb = $('doctypes-table').querySelector('tbody');
  tb.innerHTML = rows.map((r) => `
    <tr><td>${escapeHtml(r.doc_type)}</td>
      <td class="num">${fmt(r.deals)}</td>
      <td class="num">${fmt(r.acts)}</td>
      <td class="num">${fmt(r.signs)}</td></tr>`).join('') ||
    `<tr><td colspan="4" class="muted">Немає даних за цей період</td></tr>`;
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
