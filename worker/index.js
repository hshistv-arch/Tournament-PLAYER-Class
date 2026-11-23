// Cloudflare Workers 版のAPI(Vercelの api/state.js・api/backups.js と同じ仕様)。
// データは KV(バインディング名: CLUB_KV)に保存する。画面(index.html・assets/)は Workers の静的アセットとして配信される。
//   GET  /api/state                         現在のクラウド上のデータ(なければ null)
//   PUT  /api/state (POST も可)             データを保存(上書き)
//   GET  /api/backups                       バックアップ一覧 {backups:[{name, uploadedAt, size}]}
//   POST /api/backups                       現在のデータをバックアップとして複製保存(古いものから30件を超えた分を削除)
//   POST /api/backups?action=restore&name=  バックアップの内容で現在のデータを置き換える
//   DELETE /api/backups?name=               バックアップを1件削除
//
// 書き換えの保護: バックアップの作成・復元・削除(POST・DELETE /api/backups)は、合言葉が必要。
//   合言葉はリクエストヘッダ X-Admin-Pass で送り、Worker のシークレット ADMIN_PASS_HASH(scripts/make-pass-hash.mjs で作る
//   ハッシュ。合言葉そのものは保存しない)と照合する。連続して間違えると一定時間ロックする(5回で15分)。
//   ADMIN_PASS_HASH が未登録の間は、従来どおり合言葉なしで動く(登録すると保護が有効になる)。
//   GET /api/state と画面(表示ページ ?display=1 を含む)は公開のまま。

const STATE_KEY = "club-state.json";
const BACKUP_PREFIX = "backups/";
const MAX_BACKUPS = 30;
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

const MAX_FAILS = 5;
const LOCK_SECONDS = 15 * 60;

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}
// 保存形式: pbkdf2$<回数>$<saltのhex>$<ハッシュのhex>
async function verifyPass(pass, stored) {
  const parts = String(stored || "").trim().split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iter = parseInt(parts[1], 10);
  if (!(iter > 0 && iter <= 100000)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(parts[2]), iterations: iter }, key, 256);
  const got = new Uint8Array(bits), want = hexToBytes(parts[3]);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}
// 合言葉のチェック。通れば null、通らなければエラーの応答を返す
async function requireAdmin(request, env) {
  if (!env.ADMIN_PASS_HASH) return null;   // 合言葉が未登録の間は保護なし
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const failKey = "auth-fail/" + ip;
  const rec = JSON.parse((await env.CLUB_KV.get(failKey)) || "null") || { count: 0, lockedUntil: 0 };
  const now = Date.now();
  if (rec.lockedUntil > now) {
    return json({ error: "合言葉の入力に続けて失敗したため、しばらく操作できません。約" + Math.ceil((rec.lockedUntil - now) / 60000) + "分後にやり直してください。" }, 429);
  }
  const pass = request.headers.get("X-Admin-Pass") || "";
  if (pass && (await verifyPass(pass, env.ADMIN_PASS_HASH))) {
    if (rec.count) await env.CLUB_KV.delete(failKey);
    return null;
  }
  if (pass) {   // 合言葉を送ってきて間違えた場合だけ数える(未入力の最初の問い合わせは数えない)
    const next = { count: rec.count + 1, lockedUntil: 0 };
    if (next.count >= MAX_FAILS) { next.lockedUntil = now + LOCK_SECONDS * 1000; next.count = 0; }
    await env.CLUB_KV.put(failKey, JSON.stringify(next), { expirationTtl: LOCK_SECONDS + 60 });
  }
  return json({ error: pass ? "合言葉が違います。" : "この操作には合言葉が必要です。" }, 401);
}

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
  if (request.method === "POST" || request.method === "DELETE") {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;
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
