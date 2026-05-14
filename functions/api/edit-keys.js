const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const EDIT_KEY_LENGTH = 20;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

async function ensureSchema(db) {
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

function randomId() {
  return crypto.randomUUID?.() || `key-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function generateEditKey() {
  const bytes = new Uint8Array(EDIT_KEY_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => KEY_ALPHABET[byte % KEY_ALPHABET.length]).join('');
}

async function hashKey(key) {
  const value = String(key || '').trim();
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function isValidKeyFormat(key) {
  return /^[A-Za-z0-9]{20}$/.test(String(key || '').trim());
}

function adminAuthorized(request, env) {
  const expected = env.EDIT_KEYS_ADMIN_KEY;
  if (!expected) return false;
  const header = request.headers.get('X-Admin-Key') || '';
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
  return header === expected || bearer === expected;
}

async function validateEditKey(db, key, touch = false) {
  if (!isValidKeyFormat(key)) return false;
  await ensureSchema(db);
  const keyHash = await hashKey(key);
  const row = await db.prepare('SELECT id FROM edit_keys WHERE key_hash = ?').bind(keyHash).first();
  if (!row) return false;
  if (touch) {
    await db.prepare(`
      UPDATE edit_keys
      SET last_used_at = CURRENT_TIMESTAMP,
          use_count = use_count + 1
      WHERE id = ?
    `).bind(row.id).run();
  }
  return true;
}

async function parseBody(request) {
  try { return await request.json(); }
  catch { return {}; }
}

export async function onRequestGet(context) {
  const db = context.env.DB;
  if (!db) return jsonResponse({ error: 'D1 binding DB is not configured' }, 500);
  if (!adminAuthorized(context.request, context.env)) return jsonResponse({ error: 'Unauthorized' }, 401);

  await ensureSchema(db);
  const result = await db.prepare(`
    SELECT id, label, created_at, last_used_at, use_count
    FROM edit_keys
    ORDER BY created_at DESC
  `).all();
  return jsonResponse({ keys: result.results || [] });
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  if (!db) return jsonResponse({ error: 'D1 binding DB is not configured' }, 500);

  const payload = await parseBody(context.request);
  const action = String(payload.action || '').trim().toLowerCase();

  if (action === 'validate') {
    const ok = await validateEditKey(db, payload.key, true);
    return jsonResponse({ ok });
  }

  if (action === 'generate') {
    if (!adminAuthorized(context.request, context.env)) return jsonResponse({ error: 'Unauthorized' }, 401);
    await ensureSchema(db);
    const key = generateEditKey();
    const keyHash = await hashKey(key);
    const id = randomId();
    const label = String(payload.label || '').trim().slice(0, 80);
    await db.prepare(`
      INSERT INTO edit_keys (id, key_hash, label, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(id, keyHash, label).run();
    return jsonResponse({ id, key, label, message: 'Save this key now. It will not be shown again.' }, 201);
  }

  return jsonResponse({ error: 'Unknown action' }, 400);
}

export async function onRequestDelete(context) {
  const db = context.env.DB;
  if (!db) return jsonResponse({ error: 'D1 binding DB is not configured' }, 500);
  if (!adminAuthorized(context.request, context.env)) return jsonResponse({ error: 'Unauthorized' }, 401);

  const payload = await parseBody(context.request);
  const id = String(payload.id || '').trim();
  if (!id) return jsonResponse({ error: 'Missing key id' }, 400);

  await ensureSchema(db);
  const result = await db.prepare('DELETE FROM edit_keys WHERE id = ?').bind(id).run();
  return jsonResponse({ ok: true, deleted: result.meta?.changes || 0 });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: jsonHeaders });
}
