import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, KeyRound, Link2, LoaderCircle, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { useState } from "react";
import { InstallerCards } from "@/components/cinevo/installers";
import { checkNode, DEFAULT_NODE, nodeStatus, pairNode, revokeConnection, type NodeStatus } from "@/lib/node-client";
import { useCinevo } from "@/lib/cinevo-store";
import { Logo } from "@/components/cinevo/logo";

export const Route = createFileRoute("/node")({ component: NodePairing });

function NodePairing() {
  const nodeUrl = useCinevo((s) => s.nodeUrl);
  const setNodeUrl = useCinevo((s) => s.setNodeUrl);
  const nodeToken = useCinevo((s) => s.nodeToken);
  const setNodeSession = useCinevo((s) => s.setNodeSession);
  const clearNodeSession = useCinevo((s) => s.clearNodeSession);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<NodeStatus | null>(null);
  const [message, setMessage] = useState("Install CINEVO Server on this computer, then enter its pairing code.");
  const [loading, setLoading] = useState(false);
  const [ok, setOk] = useState(Boolean(nodeToken));

  const ping = async () => {
    setLoading(true);
    try {
      const res = await checkNode(nodeUrl || DEFAULT_NODE);
      setOk(res.ok);
      setMessage(res.ok ? "CINEVO Node is ready. Enter the code from its dashboard." : res.error);
    } finally {
      setLoading(false);
    }
  };

  const pair = async () => {
    if (!code.trim()) {
      setMessage("Enter the short code shown by CINEVO Server.");
      return;
    }
    setLoading(true);
    try {
      const res = await pairNode(nodeUrl || DEFAULT_NODE, code);
      if (!res.ok) {
        setOk(false);
        setMessage(res.error);
        return;
      }
      setNodeSession(res.token, res.deviceId);
      const st = await nodeStatus(nodeUrl || DEFAULT_NODE, res.token);
      if (st.ok) setStatus(st.status);
      setOk(true);
      setMessage("Paired for a short local session. Media-server credentials stay in CINEVO Node.");
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    if (!nodeToken) return;
    setLoading(true);
    try {
      const st = await nodeStatus(nodeUrl || DEFAULT_NODE, nodeToken);
      if (!st.ok) {
        clearNodeSession();
        setStatus(null);
        setMessage(st.error);
        return;
      }
      setStatus(st.status);
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id: string) => {
    if (!nodeToken) return;
    setLoading(true);
    const res = await revokeConnection(nodeUrl || DEFAULT_NODE, nodeToken, id);
    if (!res.ok) setMessage(res.error);
    else {
      setMessage("Connection removed locally.");
      await refresh();
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-cine-bg text-cine-text">
      <nav className="mx-auto flex max-w-3xl items-center justify-between px-5 py-5">
        <Link to="/" className="inline-flex items-center gap-3 text-cine-muted">
          <ArrowLeft size={18} />
          <Logo size="md" tagline={false} layout="horizontal" />
        </Link>
        <span className="font-ui text-xs font-semibold tracking-[0.12em] text-cine-cyan">CINEVO SERVER</span>
      </nav>

      <main className="relative z-10 mx-auto max-w-6xl px-5 py-12">
        <section className="grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <p className="flex items-center gap-3 font-ui text-xs font-semibold uppercase tracking-[0.14em] text-cine-muted">
              <img src="/node-icon.png" alt="" className="size-8 rounded-md" />
              CINEVO Server
            </p>
            <h1 className="mt-3 font-ui text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
              Your library,
              <br />
              close to home.
            </h1>
            <p className="mt-5 max-w-xl text-cine-muted">
              This is the server, separate from the player. It stays on loopback, uses a ten-minute code, and never
              sends Plex or Jellyfin credentials to the CINEVO app.
            </p>
            <div className="mt-6 flex flex-wrap gap-3 text-sm text-cine-muted">
              <span className="inline-flex items-center gap-2">
                <ShieldCheck size={15} className="text-cine-cyan" /> Loopback only
              </span>
              <span className="inline-flex items-center gap-2">
                <KeyRound size={15} className="text-cine-cyan" /> 10-minute code
              </span>
              <span className="inline-flex items-center gap-2">
                <Link2 size={15} className="text-cine-cyan" /> Files stay on this computer
              </span>
            </div>
          </div>

          <aside className="glass rounded-xl p-5">
            <header className="mb-5 flex items-center justify-between">
              <div>
                <b className="block font-ui">Connect this device</b>
                <small className="text-cine-faint">Local pairing only</small>
              </div>
              <button
                type="button"
                onClick={() => void ping()}
                disabled={loading}
                aria-label="Check CINEVO Node"
                className="flex size-11 items-center justify-center rounded-full border border-cine-border"
              >
                <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              </button>
            </header>
            <label className="font-ui text-xs font-medium tracking-[0.1em] text-cine-muted">SERVER ADDRESS</label>
            <input
              value={nodeUrl}
              onChange={(e) => setNodeUrl(e.target.value)}
              className="mt-2 h-11 w-full rounded-md border border-cine-border bg-cine-well px-3 font-mono text-sm"
              autoCapitalize="none"
              autoCorrect="off"
              aria-label="CINEVO Server address"
              placeholder="http://192.168.1.20:48184"
            />
            <p className="mt-2 text-xs text-cine-faint">Example: http://192.168.1.20:48184. Keep this server on your home network.</p>
            <label className="mt-4 block font-ui text-xs font-medium tracking-[0.1em] text-cine-muted">PAIRING CODE</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABC-123"
              aria-label="Pairing code"
              className="mt-2 h-11 w-full rounded-md border border-cine-border bg-cine-well px-3 font-mono text-base tracking-[0.12em]"
              autoCapitalize="characters"
              autoCorrect="off"
            />
            <button
              type="button"
              onClick={() => void pair()}
              disabled={loading}
              className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-cine-cyan font-ui font-bold tracking-wider text-cine-bg"
            >
              {loading ? <LoaderCircle size={16} className="animate-spin" /> : <KeyRound size={16} />}
              Pair CINEVO Server
            </button>
            <p className={`mt-3 flex gap-2 text-sm ${ok ? "text-cine-lime" : "text-cine-muted"}`}>
              {ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : null}
              {message}
            </p>
            <p className="mt-4 border-t border-cine-border pt-4 text-xs leading-relaxed text-cine-faint">Safety note: never expose this server address or port to the public internet.</p>
          </aside>
        </section>

        {status ? (
          <section className="mt-14">
            <p className="font-ui text-xs font-semibold tracking-[0.12em] text-cine-cyan">LOCAL STATUS</p>
            <h2 className="font-ui mt-1 text-2xl font-semibold tracking-tight">Connected servers</h2>
            <p className="mt-2 max-w-xl text-sm text-cine-muted">
              Only names and addresses. Access tokens never leave Node. Device {status.deviceId}.
            </p>
            <div className="mt-5 space-y-2">
              {status.connections.length ? (
                status.connections.map((c) => (
                  <article
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-cine-border bg-cine-surface px-4 py-3"
                  >
                    <div>
                      <b className="font-ui capitalize">{c.provider}</b>
                      <p className="font-mono text-xs text-cine-faint">{c.baseUrl}</p>
                    </div>
                    <button
                      type="button"
                      className="inline-flex h-11 items-center gap-1 font-ui text-sm text-cine-muted"
                      onClick={() => void remove(c.id)}
                    >
                      <Unplug size={14} /> Remove
                    </button>
                  </article>
                ))
              ) : (
                <p className="rounded-xl border border-dashed border-cine-border px-4 py-6 text-sm text-cine-faint">
                  No local media servers yet. Add Plex or Jellyfin in the Node dashboard, then refresh.
                </p>
              )}
            </div>
          </section>
        ) : null}

        <section className="mt-16">
          <p className="font-ui text-xs font-semibold tracking-[0.12em] text-cine-cyan">INSTALLERS</p>
          <h2 className="font-ui mt-1 text-2xl font-semibold tracking-tight">Windows, Mac, and Linux / NAS</h2>
          <p className="mt-2 mb-5 max-w-xl text-sm text-cine-muted">
            The computer or NAS that holds the files. Linux listens on the home network so this house can pair with it. Do not forward that port to the internet.
          </p>
          <InstallerCards />
        </section>

        <section className="mt-10 rounded-xl border border-cine-border bg-cine-well p-5">
          <p className="font-ui text-xs font-semibold tracking-[0.12em] text-cine-cyan">SAFE INSTALL</p>
          <div className="mt-4 grid gap-4 text-sm text-cine-muted md:grid-cols-3">
            <p><strong className="text-cine-text">Files stay local.</strong><br />The server reads the folders and media services you choose. CINEVO does not upload your library.</p>
            <p><strong className="text-cine-text">Do not port-forward.</strong><br />Keep the server on your home network. Remote access should use a deliberate, secured setup.</p>
            <p><strong className="text-cine-text">Codes expire.</strong><br />Pairing codes are short-lived. Remove a connected server from this page whenever needed.</p>
          </div>
        </section>

        <section className="flow-grid flow-grid--steps mt-14">
          {[
            ["01", "Start Node", "Open the installer on the computer that already hosts your library."],
            ["02", "Pair once", "Enter the code from the local dashboard. It expires after ten minutes."],
            ["03", "Stay in control", "Review connected servers here and remove them locally at any time."],
          ].map(([n, t, d]) => (
            <article key={n} className="rounded-xl border border-cine-border bg-cine-surface p-5">
              <span className="font-mono text-cine-cyan">{n}</span>
              <h3 className="mt-2 font-ui text-lg font-semibold tracking-tight">{t}</h3>
              <p className="mt-2 text-sm text-cine-muted">{d}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
