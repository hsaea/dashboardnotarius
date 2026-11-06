import { API_BASE, TOKEN, PIPELINE_ID, WON_STATUS_ID, FIELDS, leadUrl } from './config.js';

// Дістає значення кастомного поля угоди
function cfValue(lead, fieldId) {
  const f = (lead.custom_fields_values || []).find((x) => x.field_id === fieldId);
  if (!f || !f.values || !f.values.length) return null;
  return f.values[0].value;
}

// Нормалізує угоду Kommo у плоский обʼєкт для дашборда
function normalize(lead) {
  return {
    id: lead.id,
    name: lead.name || '',
    price: Number(lead.price || 0),          // Бюджет
    who: cfValue(lead, FIELDS.who) || null,  // Хто готує довіреність?
    acts: Number(cfValue(lead, FIELDS.acts) || 0),
    signs: Number(cfValue(lead, FIELDS.signs) || 0),
    doc_type: cfValue(lead, FIELDS.docType) || null, // Тип документа

    closed_at: lead.closed_at || lead.updated_at,
    url: leadUrl(lead.id),
  };
}

// Тягне всі виграні угоди Expert-Docs, закриті починаючи з fromEpoch (включно)
export async function fetchWonLeads(fromEpoch) {
  const leads = [];
  let page = 1;
  const limit = 250;
  // Захист від нескінченного циклу
  for (let guard = 0; guard < 200; guard++) {
    const params = new URLSearchParams();
    params.set('filter[statuses][0][pipeline_id]', String(PIPELINE_ID));
    params.set('filter[statuses][0][status_id]', String(WON_STATUS_ID));
    if (fromEpoch) params.set('filter[closed_at][from]', String(fromEpoch));
    params.set('with', 'custom_fields');
    params.set('limit', String(limit));
    params.set('page', String(page));

    const res = await fetch(`${API_BASE}/leads?${params.toString()}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
    });

    if (res.status === 204) break;            // немає даних
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Kommo API ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = await res.json();
    const batch = (data._embedded && data._embedded.leads) || [];
    for (const l of batch) leads.push(normalize(l));

    const hasNext = data._links && data._links.next;
    if (!hasNext || batch.length === 0) break;
    page += 1;
  }
  return leads;
}
