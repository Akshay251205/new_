import React, { useEffect, useMemo, useState } from "react";

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:7000";

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  const val = bytes / Math.pow(k, i);
  return `${val.toFixed(val >= 10 || i === 0 ? 0 : 1)} ${sizes[i]}`;
}

function Badge({ tone = "neutral", children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function Card({ title, right, children }) {
  return (
    <div className="card">
      <div className="card-h">
        <div>
          <div className="card-title">{title}</div>
        </div>
        <div className="card-right">{right}</div>
      </div>
      <div className="card-b">{children}</div>
    </div>
  );
}

async function api(path, opts) {
  const r = await fetch(`${GATEWAY_URL}${path}`, opts);
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`${r.status} ${t || r.statusText}`);
  }
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await r.json();
  return await r.text();
}

export default function App() {
  const [files, setFiles] = useState([]);
  const [health, setHealth] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const config = health?.config;
  const nodeRows = useMemo(() => health?.nodes ?? [], [health]);

  async function refresh() {
    const [f, h] = await Promise.all([api("/api/files"), api("/api/health")]);
    setFiles(f.files ?? []);
    setHealth(h);
  }

  useEffect(() => {
    refresh().catch((e) => setMsg({ tone: "bad", text: String(e.message ?? e) }));
    const t = setInterval(() => {
      api("/api/health")
        .then(setHealth)
        .catch(() => {});
    }, 2500);
    return () => clearInterval(t);
  }, []);

  async function onUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api("/api/upload", { method: "POST", body: fd });
      await refresh();
      setMsg({ tone: "good", text: "Uploaded successfully." });
    } catch (err) {
      setMsg({ tone: "bad", text: String(err.message ?? err) });
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function onDelete(fileId) {
    if (!confirm("Delete file entry from index? (Blobs remain in demo storage)")) return;
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/files/${fileId}`, { method: "DELETE" });
      await refresh();
      setMsg({ tone: "good", text: "Deleted." });
    } catch (err) {
      setMsg({ tone: "bad", text: String(err.message ?? err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">FD</div>
          <div>
            <div className="brand-title">Fault-Tolerant Distributed File System</div>
            <div className="brand-sub">College demo: replication + quorum + read-repair</div>
          </div>
        </div>
        <div className="topbar-right">
          <Badge tone={health?.ok ? "good" : "bad"}>{health?.ok ? "Gateway OK" : "Gateway ?"}</Badge>
          <a className="link" href={GATEWAY_URL} target="_blank" rel="noreferrer">
            Gateway
          </a>
        </div>
      </header>

      <main className="grid">
        <div className="col">
          <Card
            title="Upload"
            right={
              <div className="muted">
                R={config?.REPLICATION_FACTOR ?? "?"} W={config?.WRITE_QUORUM ?? "?"} chunk={formatBytes(config?.CHUNK_SIZE ?? 0)}
              </div>
            }
          >
            <div className="row">
              <input type="file" onChange={onUpload} disabled={busy} />
              <button className="btn" onClick={() => refresh()} disabled={busy}>
                Refresh
              </button>
            </div>
            {msg && <div className={`msg msg-${msg.tone}`}>{msg.text}</div>}
            <div className="hint">
              Tip: stop one storage node and try upload/download again to demonstrate fault tolerance.
            </div>
          </Card>

          <Card title={`Files (${files.length})`}>
            <div className="table">
              <div className="tr th">
                <div>Name</div>
                <div>Size</div>
                <div>Created</div>
                <div>Actions</div>
              </div>
              {files.map((f) => (
                <div key={f.fileId} className="tr">
                  <div className="mono">{f.name}</div>
                  <div>{formatBytes(f.size ?? 0)}</div>
                  <div className="muted">{new Date(f.createdAt ?? Date.now()).toLocaleString()}</div>
                  <div className="actions">
                    <a className="btn btn-ghost" href={`${GATEWAY_URL}/api/download/${f.fileId}`}>
                      Download
                    </a>
                    <button className="btn btn-danger" onClick={() => onDelete(f.fileId)} disabled={busy}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {!files.length && <div className="empty">No files yet. Upload something to begin.</div>}
            </div>
          </Card>
        </div>

        <div className="col">
          <Card title="Cluster health">
            <div className="cluster">
              {nodeRows.map((n) => (
                <div key={n.index} className={`node ${n.ok ? "node-ok" : "node-bad"}`}>
                  <div className="node-h">
                    <div className="node-title">
                      Node #{n.index} <span className="muted">({n.base})</span>
                    </div>
                    <Badge tone={n.ok ? "good" : "bad"}>{n.ok ? "UP" : "DOWN"}</Badge>
                  </div>
                  <div className="node-b">
                    <div className="kv">
                      <div className="k">nodeId</div>
                      <div className="v">{n.nodeId ?? "-"}</div>
                      <div className="k">dataDir</div>
                      <div className="v mono">{n.dataDir ?? "-"}</div>
                    </div>
                    {!n.ok && <div className="muted">error: {n.error}</div>}
                  </div>
                </div>
              ))}
              {!nodeRows.length && <div className="empty">No nodes configured.</div>}
            </div>
          </Card>

          <Card title="How fault tolerance works (demo)">
            <ol className="steps">
              <li>
                File is split into chunks; each chunk stored under its <span className="mono">SHA-256</span> hash.
              </li>
              <li>
                Each blob is replicated to <b>R</b> nodes; upload succeeds when <b>W</b> nodes confirm.
              </li>
              <li>
                Download reads from any available replica; gateway verifies hash (integrity) and performs read-repair.
              </li>
            </ol>
          </Card>
        </div>
      </main>

      <footer className="footer">
        <span className="muted">
          Gateway: <span className="mono">{GATEWAY_URL}</span>
        </span>
      </footer>
    </div>
  );
}

