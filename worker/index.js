// Cloudflare Workers 版のAPI(Vercelの api/state.js・api/backups.js と同じ仕様)。
// データは KV(バインディング名: CLUB_KV)に保存する。画面(index.html・assets/)は Workers の静的アセットとして配信される。
//   GET  /api/state                         現在のクラウド上のデータ(なければ null)
//   PUT  /api/state (POST も可)             データを保存(上書き)
//   GET  /api/backups                       バックアップ一覧 {backups:[{name, uploadedAt, size}]}
//   POST /api/backups                       現在のデータをバックアップとして複製保存(古いものから30件を超えた分を削除)
//   POST /api/backups?action=restore&name=  バックアップの内容で現在のデータを置き換える
//   DELETE /api/backups?name=               バックアップを1件削除

const STATE_KEY = "club-state.json";
const BACKUP_PREFIX = "backups/";
const MAX_BACKUPS = 30;
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function json(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: JSON_HEADERS });
}

async function listBackups(kv) {
  const items = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: BACKUP_PREFIX, cursor: cursor });
    page.keys.forEach(function (k) {
      const meta = k.metadata || {};
      items.push({ name: k.name.slice(BACKUP_PREFIX.length), uploadedAt: meta.uploadedAt || null, size: meta.size || 0 });
    });
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  items.sort(function (a, b) { return new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0); });
  return items;
}

async function handleState(request, env) {
  const kv = env.CLUB_KV;
  if (request.method === "GET") {
    const text = await kv.get(STATE_KEY);
    return new Response(text === null ? "null" : text, { status: 200, headers: JSON_HEADERS });
  }
  if (request.method === "PUT" || request.method === "POST") {
    const text = await request.text();
    JSON.parse(text);   // 壊れたデータで上書きしない
    await kv.put(STATE_KEY, text);
    return json({ ok: true });
  }
  return json({ error: "method not allowed" }, 405);
}

async function handleBackups(request, env, url) {
  const kv = env.CLUB_KV;
  if (request.method === "GET") {
    return json({ backups: await listBackups(kv) });
  }
  if (request.method === "POST") {
    const action = url.searchParams.get("action");
    if (action === "restore") {
      const name = url.searchParams.get("name");
      if (!name) return json({ error: "name is required" }, 400);
      const text = await kv.get(BACKUP_PREFIX + name);
      if (text === null) return json({ error: "backup not found" }, 404);
      await kv.put(STATE_KEY, text);
      return json({ ok: true });
    }
    // アクション未指定: 現在のクラウド上のデータをそのままバックアップとして複製保存する
    const current = await kv.get(STATE_KEY);
    if (current === null) return json({ error: "no current state to back up" }, 400);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const name = "club-state-" + ts + ".json";
    await kv.put(BACKUP_PREFIX + name, current, {
      metadata: { uploadedAt: new Date().toISOString(), size: new TextEncoder().encode(current).length },
    });
    // バックアップが増えすぎないよう、古いものから自動的に削除する
    const all = await listBackups(kv);
    const toDelete = all.slice(MAX_BACKUPS);
    for (const b of toDelete) await kv.delete(BACKUP_PREFIX + b.name);
    return json({ ok: true, name: name });
  }
  if (request.method === "DELETE") {
    const name = url.searchParams.get("name");
    if (!name) return json({ error: "name is required" }, 400);
    await kv.delete(BACKUP_PREFIX + name);
    return json({ ok: true });
  }
  return json({ error: "method not allowed" }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (!env.CLUB_KV) return json({ error: "KV binding CLUB_KV is not configured" }, 500);
      if (url.pathname === "/api/state") return await handleState(request, env);
      if (url.pathname === "/api/backups") return await handleBackups(request, env, url);
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response("not found", { status: 404 });
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500);
    }
  },
};
