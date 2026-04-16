const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());

// For blob uploads, accept raw bytes
app.use(
  express.raw({
    type: "*/*",
    limit: "100mb",
  })
);

function readArg(name) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((a) => a.startsWith(prefix));
  if (!raw) return undefined;
  return raw.slice(prefix.length);
}

const PORT = Number(readArg("PORT") ?? process.env.STORAGE_PORT ?? process.env.PORT ?? 5001);
const NODE_ID = String(readArg("NODE_ID") ?? process.env.NODE_ID ?? "0");
const DATA_DIR = path.resolve(readArg("DATA_DIR") ?? process.env.DATA_DIR ?? `./data/node${NODE_ID}`);

fs.mkdirSync(path.join(DATA_DIR, "blobs"), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "kv"), { recursive: true });

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function blobPath(hash) {
  // small fan-out to avoid huge directories
  const a = hash.slice(0, 2);
  const b = hash.slice(2, 4);
  const dir = path.join(DATA_DIR, "blobs", a, b);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, hash);
}

function kvPath(key) {
  // key is urlencoded already on gateway side, but keep safe
  const safe = encodeURIComponent(key);
  return path.join(DATA_DIR, "kv", `${safe}.json`);
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    nodeId: NODE_ID,
    port: PORT,
    dataDir: DATA_DIR,
    ts: Date.now(),
  });
});

app.get("/stats", async (_req, res) => {
  const dir = path.join(DATA_DIR, "blobs");
  let files = 0;
  let bytes = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    const entries = fs.readdirSync(cur, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        files += 1;
        try {
          bytes += fs.statSync(p).size;
        } catch {}
      }
    }
  }
  res.json({ nodeId: NODE_ID, blobs: { files, bytes } });
});

// Store blob by hash (integrity check enforced)
app.put("/blobs/:hash", (req, res) => {
  const { hash } = req.params;
  if (!/^[a-f0-9]{64}$/i.test(hash)) {
    return res.status(400).json({ error: "Invalid hash" });
  }
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
  const computed = sha256(body);
  if (computed !== hash.toLowerCase()) {
    return res.status(400).json({ error: "Hash mismatch", computed });
  }
  const p = blobPath(hash.toLowerCase());
  fs.writeFileSync(p, body);
  res.json({ ok: true, hash: hash.toLowerCase(), size: body.length });
});

app.get("/blobs/:hash", (req, res) => {
  const { hash } = req.params;
  if (!/^[a-f0-9]{64}$/i.test(hash)) {
    return res.status(400).json({ error: "Invalid hash" });
  }
  const p = blobPath(hash.toLowerCase());
  if (!fs.existsSync(p)) return res.status(404).json({ error: "Not found" });
  res.setHeader("Content-Type", "application/octet-stream");
  fs.createReadStream(p).pipe(res);
});

app.head("/blobs/:hash", (req, res) => {
  const { hash } = req.params;
  const p = blobPath(hash.toLowerCase());
  if (!fs.existsSync(p)) return res.sendStatus(404);
  return res.sendStatus(200);
});

// Minimal replicated KV for file index shards (gateway handles replication/quorum)
app.put("/kv/:key", (req, res) => {
  const key = decodeURIComponent(req.params.key);
  let value;
  try {
    const body = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "{}";
    value = JSON.parse(body || "{}");
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  const record = {
    key,
    value,
    ts: Date.now(),
  };
  fs.writeFileSync(kvPath(key), JSON.stringify(record, null, 2));
  res.json({ ok: true, key, ts: record.ts });
});

app.get("/kv/:key", (req, res) => {
  const key = decodeURIComponent(req.params.key);
  const p = kvPath(key);
  if (!fs.existsSync(p)) return res.status(404).json({ error: "Not found" });
  try {
    const record = JSON.parse(fs.readFileSync(p, "utf8"));
    return res.json(record);
  } catch {
    return res.status(500).json({ error: "Corrupt record" });
  }
});

app.listen(PORT, () => {
  console.log(`[storage-node ${NODE_ID}] listening on :${PORT} data=${DATA_DIR}`);
});

