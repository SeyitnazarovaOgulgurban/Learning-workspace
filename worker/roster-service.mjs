const sessionCookie = 'spm_session';
const sessionLifetime = 8 * 60 * 60;
const roles = ['student', 'teacher', 'admin'];
const actorCheck = "EXISTS (SELECT 1 FROM roster_user AS actor WHERE actor.key = ? AND actor.revision = ? AND actor.role = 'admin')";
const normalName = value => value.normalize('NFKC').trim().replace(/\s+/g, ' ');
const normalId = value => value.normalize('NFKC').trim().toUpperCase();

async function sha256(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

const credential = (nameKey, id) => sha256(JSON.stringify([nameKey, id]));

function reply(body, status = 200, cookie) {
  const headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};
  if (cookie) headers['Set-Cookie'] = cookie;
  return Response.json(body, {status, headers});
}

function error(code, status) {
  return reply({error: code}, status);
}

function cookie(value, seconds) {
  return sessionCookie + '=' + value + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + seconds;
}

function tokenFrom(request) {
  const explicit = request.headers.get('X-SPM-Session');
  if (explicit !== null) return /^[a-f0-9]{64}$/.test(explicit) ? explicit : undefined;
  return request.headers.get('Cookie')?.match(/(?:^|;\s*)spm_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}

async function initializeRoster(db) {
  const sql = "SELECT 1 FROM roster_setup WHERE name = 'initial-roster'";
  if (await db.prepare(sql).first()) return;
  // The rows and marker commit together so deletions never trigger reseeding.
  await db.batch([
    ...initialRoster.map(user => db.prepare(`
      INSERT OR IGNORE INTO roster_user (key, name, name_key, role, masked_id, sample, credential)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (${sql})
    `).bind(user.key, user.name, normalName(user.name).toLowerCase(), user.role, user.maskedId, Number(user.sample), user.match)),
    db.prepare("INSERT OR IGNORE INTO roster_setup (name) VALUES ('initial-roster')"),
  ]);
}

const publicUser = row => ({
  key: row.key,
  name: row.name,
  role: row.role,
  maskedId: row.masked_id,
  sample: Boolean(row.sample),
  revision: row.revision,
});

async function sessionPayload(db, user) {
  if (!user) return {user: null};
  const counts = await db.prepare("SELECT count(*) AS total, count(CASE WHEN role = 'student' THEN 1 END) AS students FROM roster_user").first();
  return {user: publicUser(user), counts};
}

async function sessionUser(db, token) {
  if (!token) return null;
  return db.prepare(`SELECT u.* FROM roster_session s JOIN roster_user u ON u.key = s.user_key
    WHERE s.token_hash = ? AND s.expires_at > ? AND s.user_revision = u.revision`)
    .bind(await sha256(token), Date.now()).first();
}

async function signIn(db, data, priorToken) {
  if (typeof data.name !== 'string' || typeof data.id !== 'string') return error('credentials', 401);
  const nameKey = normalName(data.name).toLowerCase();
  const id = normalId(data.id);
  if (!nameKey || nameKey.length > 80 || !id || id.length > 24) return error('credentials', 401);
  await initializeRoster(db);
  const user = await db.prepare('SELECT * FROM roster_user WHERE credential = ?').bind(await credential(nameKey, id)).first();
  if (!user) return error('credentials', 401);
  if (data.mode === 'register') return error('registered', 409);

  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM roster_session WHERE expires_at <= ? OR token_hash = ?')
      .bind(now, priorToken ? await sha256(priorToken) : ''),
    db.prepare('INSERT INTO roster_session (token_hash, user_key, user_revision, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256(token), user.key, user.revision, now + sessionLifetime * 1000),
  ]);
  return reply({...await sessionPayload(db, user), sessionToken: token}, 200, cookie(token, sessionLifetime));
}

function validDetails(data) {
  return typeof data.name === 'string' && typeof data.id === 'string' && roles.includes(data.role);
}

async function saveUser(db, data, actor, key, token) {
  if (!validDetails(data)) return error('invalid', 400);
  const name = normalName(data.name);
  const nameKey = name.toLowerCase();
  const id = normalId(data.id);
  if (!name || name.length > 80 || id.length > 24 || /[\p{C}]/u.test(name + id)) return error('invalid', 400);
  const actorArgs = [actor.key, actor.revision];

  let result;
  if (!key) {
    if (!id) return error('id_required', 400);
    result = await db.prepare(`INSERT INTO roster_user (key, name, name_key, role, masked_id, credential)
      SELECT ?, ?, ?, ?, ?, ? WHERE ${actorCheck} ON CONFLICT(credential) DO NOTHING`)
      .bind(crypto.randomUUID(), name, nameKey, data.role, '•••• ' + id.slice(-4), await credential(nameKey, id), ...actorArgs).run();
    if (!result.meta.changes) return error('conflict', 409);
    return reply({ok: true}, 201);
  }

  const current = await db.prepare('SELECT * FROM roster_user WHERE key = ?').bind(key).first();
  if (!current) return error('missing', 404);
  if (data.revision !== current.revision) return error('stale', 409);
  if (nameKey !== current.name_key && !id) return error('id_required', 400);
  if (key === actor.key && data.role !== 'admin') return error('own_admin', 409);

  const nextCredential = id ? await credential(nameKey, id) : current.credential;
  const maskedId = id ? '•••• ' + id.slice(-4) : current.masked_id;
  const changed = current.name !== name || current.role !== data.role || current.credential !== nextCredential;
  if (!changed) return reply({ok: true, signInAgain: false});

  const nextRevision = current.revision + 1;
  result = await db.prepare(`UPDATE roster_user SET name = ?, name_key = ?, role = ?, masked_id = ?,
      credential = ?, revision = ? WHERE key = ? AND revision = ? AND ${actorCheck}
      AND NOT EXISTS (SELECT 1 FROM roster_user other WHERE other.credential = ? AND other.key <> ?)`)
    .bind(name, nameKey, data.role, maskedId, nextCredential, nextRevision,
      key, current.revision, ...actorArgs, nextCredential, key).run();
  if (!result.meta.changes) return error('conflict', 409);

  const self = key === actor.key;
  if (self) {
    await db.prepare('UPDATE roster_session SET user_revision = ? WHERE token_hash = ? AND user_key = ?').bind(nextRevision, await sha256(token), key).run();
  }
  return reply({ok: true, session: self ? await sessionPayload(db, await sessionUser(db, token)) : undefined});
}

async function deleteUser(db, key, data, actor) {
  if (key === actor.key) return error('own_admin', 409);
  const result = await db.prepare(`DELETE FROM roster_user WHERE key = ? AND revision = ? AND ${actorCheck}`)
    .bind(key, Number.isSafeInteger(data.revision) ? data.revision : 0, actor.key, actor.revision).run();
  return result.meta.changes ? reply({ok: true}) : error('stale', 409);
}

async function handleApi(request, env, path) {
  const db = env.DB;
  const method = request.method;
  let data = {};
  if (method !== 'GET') {
    if (request.headers.get('Sec-Fetch-Site') === 'cross-site' ||
      !request.headers.get('Content-Type')?.startsWith('application/json')) return error('invalid', 400);
    const raw = await request.text();
    if (raw.length > 4096) return error('invalid', 400);
    try { data = JSON.parse(raw); } catch { return error('invalid', 400); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return error('invalid', 400);
  }

  const token = tokenFrom(request);
  if (path === '/api/sign-in' && method === 'POST') return signIn(db, data, token);
  if (path === '/api/sign-out' && method === 'POST') {
    if (token) await db.prepare('DELETE FROM roster_session WHERE token_hash = ?').bind(await sha256(token)).run();
    return reply({ok: true}, 200, cookie('', 0));
  }
  const actor = await sessionUser(db, token);
  if (path === '/api/session' && method === 'GET') return reply(await sessionPayload(db, actor));
  if (!actor) return error('session', 401);
  if (actor.role !== 'admin') return error('forbidden', 403);

  if (path === '/api/users') {
    if (method === 'GET') {
      const users = await db.prepare("SELECT * FROM roster_user ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'teacher' THEN 1 ELSE 2 END, name COLLATE NOCASE").all();
      return reply({users: users.results.map(publicUser)});
    }
    if (method === 'POST') return saveUser(db, data, actor);
  }
  const key = path.match(/^\/api\/users\/([a-z0-9-]{1,48})$/)?.[1];
  if (key && method === 'PATCH') return saveUser(db, data, actor, key, token);
  if (key && method === 'DELETE') return deleteUser(db, key, data, actor);
  return error('missing', 404);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/')) {
      try { return await handleApi(request, env, path); }
      catch (exception) {
        console.error('Roster request failed', exception?.name);
        return error('unavailable', 503);
      }
    }
    const asset = assets.get(path);
    if (!asset || !['GET','HEAD'].includes(request.method)) return new Response('Not found', {status: 404});
    return new Response(request.method === 'HEAD' ? null : asset.body, {
      headers: {'Content-Type': asset.type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff'},
    });
  },
};
