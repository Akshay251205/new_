const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const multer = require("multer");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

function readArg(name) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((a) => a.startsWith(prefix));
  if (!raw) return undefined;
  return raw.slice(prefix.length);
}

const PORT = Number(readArg("PORT") ?? process.env.GATEWAY_PORT ?? process.env.PORT ?? 7000);
const NODE_URLS = String(readArg("NODE_URLS") ?? process.env.NODE_URLS ?? "http://localhost:5001,http://localhost:5002,http://localhost:5003")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const NODE_COUNT = Number(readArg("NODE_COUNT") ?? process.env.NODE_COUNT ?? NODE_URLS.length ?? 3);
const REPLICATION_FACTOR = Number(readArg("REPLICATION_FACTOR") ?? process.env.REPLICATION_FACTOR ?? 3);
const WRITE_QUORUM = Number(readArg("WRITE_QUORUM") ?? process.env.WRITE_QUORUM ?? 2);
const CHUNK_SIZE = Number(readArg("CHUNK_SIZE") ?? process.env.CHUNK_SIZE ?? 256 * 1024);

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickReplicaIndices(hashHex) {
  // primary = (first 8 hex digits) % NODE_COUNT
  const primary = (parseInt(hashHex.slice(0, 8), 16) >>> 0) % NODE_COUNT;
  const r = Math.min(REPLICATION_FACTOR, NODE_COUNT);
  const idx = [];
  for (let i = 0; i < r; i++) idx.push((primary + i) % NODE_COUNT);
  return idx;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 2000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function nodeHealth() {
  const results = await Promise.all(
    NODE_URLS.map(async (base, i) => {
      try {
        const r = await fetchWithTimeout(`${base}/health`, {}, 1200);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        return { index: i, base, ok: true, ...json };
      } catch (e) {
        return { index: i, base, ok: false, error: String(e?.message ?? e) };
      }
    })
  );
  return results;
}

async function putBlobToNode(nodeBase, hash, bytes) {
  const r = await fetchWithTimeout(
    `${nodeBase}/blobs/${hash}`,
    {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: bytes,
    },
    4000
  );
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`put failed ${r.status} ${t}`);
  }
  return await r.json();
}

async function headBlob(nodeBase, hash) {
  const r = await fetchWithTimeout(`${nodeBase}/blobs/${hash}`, { method: "HEAD" }, 2000);
  return r.ok;
}

async function getBlobFromNode(nodeBase, hash) {
  const r = await fetchWithTimeout(`${nodeBase}/blobs/${hash}`, { method: "GET" }, 4000);
  if (!r.ok) throw new Error(`get failed ${r.status}`);
  const arr = new Uint8Array(await r.arrayBuffer());
  return Buffer.from(arr);
}

async function replicateBlob(hash, bytes) {
  const indices = pickReplicaIndices(hash);
  async function putWithRetry(i) {
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await putBlobToNode(NODE_URLS[i], hash, bytes);
      } catch (e) {
        lastErr = e;
        await sleep(150 * (attempt + 1));
      }
    }
    throw lastErr ?? new Error("unknown put failure");
  }

  const attempts = await Promise.allSettled(indices.map((i) => putWithRetry(i)));
  const ok = attempts.filter((a) => a.status === "fulfilled").length;
  if (ok < WRITE_QUORUM) {
    const errors = attempts
      .map((a, idx) => {
        if (a.status === "fulfilled") return null;
        return { replicaIndex: indices[idx], base: NODE_URLS[indices[idx]], error: String(a.reason?.message ?? a.reason) };
      })
      .filter(Boolean);
    const err = new Error(`write quorum not met (ok=${ok}, W=${WRITE_QUORUM})`);
    err.details = { errors };
    throw err;
  }
  return { hash, replicas: indices, ok };
}

async function readBlobWithRepair(hash) {
  const indices = pickReplicaIndices(hash);
  let bytes = null;
  let foundAt = null;

  for (const i of indices) {
    try {
      const b = await getBlobFromNode(NODE_URLS[i], hash);
      if (sha256(b) !== hash) throw new Error("integrity check failed");
      bytes = b;
      foundAt = i;
      break;
    } catch {
      // try next replica
    }
  }
  if (!bytes) throw new Error("not found on any replica");

  // read repair: for missing replicas, re-put
  const repairTargets = [];
  for (const i of indices) {
    if (i === foundAt) continue;
    try {
      const exists = await headBlob(NODE_URLS[i], hash);
      if (!exists) repairTargets.push(i);
    } catch {
      // node down; skip
    }
  }
  if (repairTargets.length) {
    await Promise.allSettled(repairTargets.map((i) => putBlobToNode(NODE_URLS[i], hash, bytes)));
  }

  return { bytes, replicas: indices, repaired: repairTargets };
}

// ---- distributed file index (simple college-friendly approach) ----
// We store the "file list" as a single JSON record in KV replicated to nodes (same replication/quorum).
const FILE_INDEX_KEY = "fileIndex:v1";

async function kvPutReplicated(key, value) {
  const payload = Buffer.from(JSON.stringify(value));
  const hash = sha256(Buffer.from(key)); // shard selection by key hash
  const indices = pickReplicaIndices(hash);
  const attempts = await Promise.allSettled(
    indices.map((i) =>
      fetchWithTimeout(
        `${NODE_URLS[i]}/kv/${encodeURIComponent(key)}`,
        { method: "PUT", headers: { "content-type": "application/json" }, body: payload },
        2500
      )
    )
  );
  const ok = attempts.filter((a) => a.status === "fulfilled" && a.value.ok).length;
  if (ok < WRITE_QUORUM) throw new Error(`kv write quorum not met (ok=${ok}, W=${WRITE_QUORUM})`);
  return { ok, replicas: indices };
}

async function kvGetBestEffort(key) {
  const hash = sha256(Buffer.from(key));
  const indices = pickReplicaIndices(hash);
  for (const i of indices) {
    try {
      const r = await fetchWithTimeout(`${NODE_URLS[i]}/kv/${encodeURIComponent(key)}`, {}, 2000);
      if (!r.ok) continue;
      const json = await r.json();
      return json?.value ?? null;
    } catch {
      // try next
    }
  }
  return null;
}

async function getFileIndex() {
  const idx = await kvGetBestEffort(FILE_INDEX_KEY);
  return Array.isArray(idx) ? idx : [];
}

async function setFileIndex(list) {
  await kvPutReplicated(FILE_INDEX_KEY, list);
}

// ---- APIs ----
app.get("/api/health", async (_req, res) => {
  const nodes = await nodeHealth();
  res.json({
    ok: true,
    gateway: { port: PORT },
    config: { NODE_COUNT, REPLICATION_FACTOR, WRITE_QUORUM, CHUNK_SIZE, nodeUrls: NODE_URLS },
    nodes,
  });
});

app.get("/api/files", async (_req, res) => {
  const files = await getFileIndex();
  res.json({ files });
});

app.post("/api/upload", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "missing file" });

  try {
    const fileId = crypto.randomUUID();
    const name = file.originalname;
    const size = file.size;
    const mime = file.mimetype || "application/octet-stream";
    const bytes = file.buffer;

    const chunkHashes = [];
    const chunkSizes = [];

    for (let off = 0; off < bytes.length; off += CHUNK_SIZE) {
      const chunk = bytes.subarray(off, Math.min(off + CHUNK_SIZE, bytes.length));
      const h = sha256(chunk);
      await replicateBlob(h, chunk);
      chunkHashes.push(h);
      chunkSizes.push(chunk.length);
    }

    const manifest = {
      v: 1,
      fileId,
      name,
      size,
      mime,
      chunkSize: CHUNK_SIZE,
      chunks: chunkHashes,
      chunkSizes,
      createdAt: Date.now(),
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const manifestHash = sha256(manifestBytes);
    await replicateBlob(manifestHash, manifestBytes);

    const files = await getFileIndex();
    files.unshift({ fileId, name, size, mime, manifestHash, createdAt: manifest.createdAt });
    await setFileIndex(files);

    res.json({ ok: true, file: { fileId, name, size, mime, manifestHash } });
  } catch (e) {
    res.status(503).json({
      error: "upload_failed",
      message: String(e?.message ?? e),
      details: e?.details ?? null,
    });
  }
});

app.get("/api/download/:fileId", async (req, res) => {
  const { fileId } = req.params;
  const files = await getFileIndex();
  const entry = files.find((f) => f.fileId === fileId);
  if (!entry) return res.status(404).json({ error: "file not found" });

  const m = await readBlobWithRepair(entry.manifestHash);
  let manifest;
  try {
    manifest = JSON.parse(m.bytes.toString("utf8"));
  } catch {
    return res.status(500).json({ error: "manifest corrupt" });
  }

  res.setHeader("Content-Type", entry.mime || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(entry.name)}"`);

  for (const ch of manifest.chunks) {
    const { bytes } = await readBlobWithRepair(ch);
    res.write(bytes);
  }
  res.end();
});

app.delete("/api/files/:fileId", async (req, res) => {
  const { fileId } = req.params;
  const files = await getFileIndex();
  const next = files.filter((f) => f.fileId !== fileId);
  if (next.length === files.length) return res.status(404).json({ error: "file not found" });
  await setFileIndex(next);
  res.json({ ok: true });
});

// small debug endpoint: shows replicas for a blob hash
app.get("/api/debug/blob/:hash", async (req, res) => {
  const { hash } = req.params;
  if (!/^[a-f0-9]{64}$/i.test(hash)) return res.status(400).json({ error: "invalid hash" });
  const indices = pickReplicaIndices(hash.toLowerCase());
  const checks = await Promise.all(
    indices.map(async (i) => {
      try {
        const exists = await headBlob(NODE_URLS[i], hash.toLowerCase());
        return { index: i, base: NODE_URLS[i], exists };
      } catch (e) {
        return { index: i, base: NODE_URLS[i], exists: false, error: String(e?.message ?? e) };
      }
    })
  );
  res.json({ hash: hash.toLowerCase(), replicas: indices, checks });
});

app.listen(PORT, () => {
  console.log(`[gateway] listening on :${PORT} nodes=${NODE_URLS.length} R=${REPLICATION_FACTOR} W=${WRITE_QUORUM}`);
});

