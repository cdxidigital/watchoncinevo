import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { PublicFrame } from "@/components/cinevo/public-frame";

export const Route = createFileRoute("/start")({ component: Start });

const steps = [
  ["Choose your source", "Connect Plex, Jellyfin, a folder on this computer, or CINEVO Server. Start with one library; you can add more later."],
  ["Install CINEVO Server", "If your files live on another computer or NAS, install the small local server there. It keeps credentials and media at home."],
  ["Pair your player", "Enter the short code from the server dashboard. Pairing codes expire after 10 minutes and can be revoked any time."],
  ["Scan and play", "Pick the sections you want indexed, then test one title. Add your TV or phone when the first playback works."],
];

function Start() {
  return <PublicFrame kicker="GET STARTED" title="From files to first play." lede="A calm setup path for Plex users, Jellyfin households, NAS owners, and home media collectors.">
    <div className="grid gap-8 md:grid-cols-[1fr_0.72fr]">
      <div className="space-y-3">
        {steps.map(([title, copy], index) => <article key={title} className="rounded-xl border border-cine-border bg-cine-surface p-5">
          <div className="flex gap-4"><span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-cine-cyan font-mono text-sm text-cine-accent-ink">0{index + 1}</span><div><h2 className="font-ui text-lg font-semibold">{title}</h2><p className="mt-2 text-sm text-cine-muted">{copy}</p></div></div>
        </article>)}
      </div>
      <aside className="glass h-fit rounded-xl p-5"><div className="flex items-center gap-2 text-cine-cyan"><ShieldCheck size={17}/><b className="font-ui text-sm">Safe by default</b></div><ul className="mt-4 space-y-3 text-sm text-cine-muted">{["Files stay on your computer or server", "No port forwarding required", "Catalog sharing never shares files", "CINEVO does not provide movies or shows"].map((item) => <li key={item} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-cine-cyan"/>{item}</li>)}</ul><Link to="/app" search={{ room: "library" }} className="mt-6 inline-flex h-11 items-center gap-2 rounded-md bg-cine-cyan px-4 font-ui text-sm font-bold text-cine-accent-ink">Start with your library <ArrowRight size={16}/></Link></aside>
    </div>
    <p className="mt-10 text-sm text-cine-faint">Already paired? <Link to="/node" className="text-cine-cyan underline underline-offset-4">Manage CINEVO Server</Link>.</p>
  </PublicFrame>;
}

export default Start;

