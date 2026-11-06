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

$('save-rates').addEventListener('click', async () => {
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({
    sign_rate: Number($('sign-rate').value), act_rate: Number($('act-rate').value),
  }) });
  await reload();
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
