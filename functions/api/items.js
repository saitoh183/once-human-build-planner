const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

const ITEM_CONFIG_KEY = 'item_config';
const DEFAULT_OVERRIDES = {
  'anti-phase': {
    name: 'Precision Weapon Mastery',
    description: 'Damage +15% when wielding sniper rifles, SMGs, or crossbows.'
  }
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
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS edit_keys (
      id TEXT PRIMARY KEY,
      key_hash TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT,
      use_count INTEGER NOT NULL DEFAULT 0
    )
  `).run();
}

function editKeyFromRequest(request) {
  const header = request.headers.get('X-Edit-Key') || '';
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
  return (header || bearer).trim();
}

function isValidKeyFormat(key) {
  return /^[A-Za-z0-9]{20}$/.test(String(key || '').trim());
}

async function hashKey(key) {
  const bytes = new TextEncoder().encode(String(key || '').trim());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hasValidEditKey(db, request) {
  const key = editKeyFromRequest(request);
  if (!isValidKeyFormat(key)) return false;
  const keyHash = await hashKey(key);
  const row = await db.prepare('SELECT id FROM edit_keys WHERE key_hash = ?').bind(keyHash).first();
  if (!row) return false;
  await db.prepare(`
    UPDATE edit_keys
    SET last_used_at = CURRENT_TIMESTAMP,
        use_count = use_count + 1
    WHERE id = ?
  `).bind(row.id).run();
  return true;
}

function normalizeConfig(value) {
  const source = value && typeof value === 'object' ? value : {};
  const overrides = {};
  for (const [id, override] of Object.entries(source.overrides || {})) {
    const itemId = String(id || '').trim();
    if (!itemId || !override || typeof override !== 'object') continue;
    const name = String(override.name || '').trim();
    const description = String(override.description || '').trim();
    if (name || description) overrides[itemId] = { name, description };
  }

  const notes = {};
  for (const [id, note] of Object.entries(source.notes || {})) {
    const itemId = String(id || '').trim();
    const value = String(note || '').trim();
    if (itemId && value) notes[itemId] = value;
  }

  return { overrides: { ...DEFAULT_OVERRIDES, ...overrides }, notes };
}

async function loadConfig(db) {
  await ensureSchema(db);
  const row = await db.prepare('SELECT value, updated_at FROM app_state WHERE key = ?').bind(ITEM_CONFIG_KEY).first();
  if (!row?.value) return { config: { overrides: { ...DEFAULT_OVERRIDES }, notes: {} }, updated_at: null };
  try {
    return { config: normalizeConfig(JSON.parse(row.value)), updated_at: row.updated_at };
  } catch {
    return { config: { overrides: { ...DEFAULT_OVERRIDES }, notes: {} }, updated_at: row.updated_at };
  }
}

export async function onRequestGet(context) {
  const db = context.env.DB;
  if (!db) return jsonResponse({ error: 'D1 binding DB is not configured' }, 500);
  const { config, updated_at } = await loadConfig(db);
  return jsonResponse({ ...config, updated_at });
}

export async function onRequestPut(context) {
  const db = context.env.DB;
  if (!db) return jsonResponse({ error: 'D1 binding DB is not configured' }, 500);
  await ensureSchema(db);
  if (!(await hasValidEditKey(db, context.request))) {
    return jsonResponse({ error: 'A valid edit key is required to save item overrides and notes.' }, 401);
  }

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const config = normalizeConfig(payload);
  await db.prepare(`
    INSERT INTO app_state (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).bind(ITEM_CONFIG_KEY, JSON.stringify(config)).run();

  return jsonResponse({ ok: true, overrideCount: Object.keys(config.overrides).length, noteCount: Object.keys(config.notes).length });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: jsonHeaders });
}
