import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, HardDrive, MonitorPlay, Radio, Users } from "lucide-react";
import { PublicFrame } from "@/components/cinevo/public-frame";

export const Route = createFileRoute("/how-it-works")({ component: HowItWorks });

const parts = [[HardDrive, "Your library", "Plex, Jellyfin, a folder, or CINEVO Server remains the source of truth. CINEVO indexes only the sections you choose."], [Radio, "Your server", "CINEVO Server runs close to the files, stores media-server credentials locally, and stays on your home network."], [MonitorPlay, "Your player", "The same cinema interface works in a browser, on Android, and on iPhone. Cast or AirPlay when you want the big screen."], [Users, "Your people", "Invite people to browse a catalog without sending them your files. Remove a device or connection whenever you like."]];

function HowItWorks() { return <PublicFrame kicker="HOW IT WORKS" title="One private cinema, four simple pieces." lede="CINEVO is a player for the media you already own—not a public catalog, streaming service, or file host."><div className="grid gap-4 md:grid-cols-2">{parts.map(([Icon, title, copy]) => { const I = Icon as typeof HardDrive; return <article key={title as string} className="rounded-xl border border-cine-border bg-cine-surface p-5"><I size={22} className="text-cine-cyan"/><h2 className="mt-5 font-ui text-xl font-semibold">{title as string}</h2><p className="mt-2 text-sm leading-6 text-cine-muted">{copy as string}</p></article>; })}</div><section className="mt-10 rounded-xl border border-cine-border bg-cine-well p-6"><p className="font-ui text-xs font-semibold tracking-[0.14em] text-cine-cyan">THE SHORT VERSION</p><p className="mt-3 max-w-2xl text-lg leading-8">Connect a source. Choose your sections. Pair the screens you trust. CINEVO keeps the catalog and playback close to your home setup.</p><Link to="/start" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-cine-cyan">Walk through setup <ArrowRight size={16}/></Link></section></PublicFrame>; }

export default HowItWorks;
                        
