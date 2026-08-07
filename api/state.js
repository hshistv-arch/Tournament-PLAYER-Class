const { put, get } = require("@vercel/blob");

const PATHNAME = "club-state.json";

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const result = await get(PATHNAME, { access: "private", useCache: false });
      if (!result) {
        res.status(200).json(null);
        return;
      }
      const text = await new Response(result.stream).text();
      res.setHeader("Content-Type", "application/json");
      res.status(200).send(text);
      return;
    }
    if (req.method === "PUT" || req.method === "POST") {
      const body = JSON.stringify(req.body);
      await put(PATHNAME, body, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
      });
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
