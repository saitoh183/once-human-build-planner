const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

async function ensureSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

export async function onRequestGet(context) {
  const db = context.env.DB;
  if (!db) return jsonResponse({ error: 'D1 binding DB is not configured' }, 500);

  await ensureSchema(db);
  const row = await db.prepare('SELECT value, updated_at FROM app_state WHERE key = ?')
    .bind('builds')
    .first();

  if (!row) return jsonResponse({ builds: [], updated_at: null });

  try {
    const parsed = JSON.parse(row.value);
    return jsonResponse({ builds: Array.isArray(parsed) ? parsed : [], updated_at: row.updated_at });
  } catch {
    return jsonResponse({ builds: [], updated_at: row.updated_at });
  }
}

export async function onRequestPut(context) {
  const db = context.env.DB;
  if (!db) return jsonResponse({ error: 'D1 binding DB is not configured' }, 500);

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!Array.isArray(payload?.builds)) {
    return jsonResponse({ error: 'Expected body shape: { builds: [] }' }, 400);
  }

  await ensureSchema(db);
  const value = JSON.stringify(payload.builds);
  await db.prepare(`
    INSERT INTO app_state (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).bind('builds', value).run();

  return jsonResponse({ ok: true, count: payload.builds.length });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: jsonHeaders });
}
