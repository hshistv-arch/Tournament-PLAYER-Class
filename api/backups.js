const { put, get, list, del } = require("@vercel/blob");

const STATE_PATHNAME = "club-state.json";
const BACKUP_PREFIX = "backups/";
const MAX_BACKUPS = 30;

function backupName(pathname) {
  return pathname.slice(BACKUP_PREFIX.length);
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { blobs } = await list({ prefix: BACKUP_PREFIX });
      const items = blobs
        .map(function (b) {
          return { name: backupName(b.pathname), uploadedAt: b.uploadedAt, size: b.size };
        })
        .sort(function (a, b) {
          return new Date(b.uploadedAt) - new Date(a.uploadedAt);
        });
      res.status(200).json({ backups: items });
      return;
    }

    if (req.method === "POST") {
      const action = req.query.action;

      if (action === "restore") {
        const name = req.query.name;
        if (!name) {
          res.status(400).json({ error: "name is required" });
          return;
        }
        const found = await get(BACKUP_PREFIX + name, { access: "private", useCache: false });
        if (!found) {
          res.status(404).json({ error: "backup not found" });
          return;
        }
        const text = await new Response(found.stream).text();
        await put(STATE_PATHNAME, text, {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: "application/json",
        });
        res.status(200).json({ ok: true });
        return;
      }

      // アクション未指定: 現在のクラウド上のデータをそのままバックアップとして複製保存する
      const current = await get(STATE_PATHNAME, { access: "private", useCache: false });
      if (!current) {
        res.status(400).json({ error: "no current state to back up" });
        return;
      }
      const text = await new Response(current.stream).text();
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const name = "club-state-" + ts + ".json";
      await put(BACKUP_PREFIX + name, text, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "application/json",
      });

      // バックアップが増えすぎないよう、古いものから自動的に削除する
      const { blobs } = await list({ prefix: BACKUP_PREFIX });
      const sorted = blobs.slice().sort(function (a, b) {
        return new Date(b.uploadedAt) - new Date(a.uploadedAt);
      });
      const toDelete = sorted.slice(MAX_BACKUPS);
      if (toDelete.length) {
        await del(toDelete.map(function (b) { return b.url; }));
      }

      res.status(200).json({ ok: true, name: name });
      return;
    }

    if (req.method === "DELETE") {
      const name = req.query.name;
      if (!name) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      const { blobs } = await list({ prefix: BACKUP_PREFIX + name });
      const target = blobs.find(function (b) { return b.pathname === BACKUP_PREFIX + name; });
      if (target) {
        await del(target.url);
      }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
