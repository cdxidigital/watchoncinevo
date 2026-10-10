import { useEffect, useRef } from "react";
import { useCinevo } from "@/lib/cinevo-store";
import { loadAccountLibrary, saveAccountLibrary, type SavedLibrary } from "@/lib/library-account";
import type { LibSource, LibraryTitle } from "@/lib/library";
import type { PlexServer } from "@/lib/plex";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

function asSources(value: unknown): LibSource[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is LibSource => Boolean(item) && typeof item === "object" && "id" in item && "kind" in item);
}

function asTitles(value: unknown): LibraryTitle[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is LibraryTitle => Boolean(item) && typeof item === "object" && "id" in item && "title" in item);
}

function snapshot(): SavedLibrary {
  const s = useCinevo.getState();
  return {
    plexToken: s.plexToken,
    plexUser: s.plexUser,
    plexClientId: s.plexClientId,
    plexServers: s.plexServers,
    nodeUrl: s.nodeUrl,
    nodeToken: s.nodeToken,
    nodeDevice: s.nodeDevice,
    sources: s.sources,
    remoteTitles: s.remoteTitles,
    nodeTitles: s.localTitles.filter((title) => title.id.startsWith("node-")),
  };
}

function hasLinks(library: SavedLibrary) {
  return Boolean(library.plexToken || library.nodeToken || library.sources.length);
}

export function AccountLibraries() {
  const { user, isPending } = useCurrentUserState();
  const hydrated = useCinevo((s) => s.hydrated);
  const sources = useCinevo((s) => s.sources);
  const plexToken = useCinevo((s) => s.plexToken);
  const nodeToken = useCinevo((s) => s.nodeToken);
  const remoteCount = useCinevo((s) => s.remoteTitles.length);
  const plexUser = useCinevo((s) => s.plexUser);
  const plexClientId = useCinevo((s) => s.plexClientId);
  const plexServerCount = useCinevo((s) => s.plexServers.length);
  const ready = useRef("");

  useEffect(() => {
    if (!hydrated || isPending || !user || user.isDevFallback) return;
    let cancel = false;
    ready.current = "";
    void loadAccountLibrary()
      .then((res) => {
        if (cancel || !res.ok) return;
        const owner = useCinevo.getState().libraryOwner;
        const library = res.library;
        if (library && hasLinks(library)) {
          const nextSources = asSources(library.sources);
          const remote = asTitles(library.remoteTitles);
          const nodeTitles = asTitles(library.nodeTitles);
          const localKept = useCinevo.getState().localTitles.filter((title) => !title.id.startsWith("node-"));
          useCinevo.setState({
            plexToken: library.plexToken || "",
            plexUser: library.plexUser || "",
            plexClientId: library.plexClientId || useCinevo.getState().plexClientId,
            plexServers: Array.isArray(library.plexServers) ? (library.plexServers as PlexServer[]) : [],
            nodeUrl: library.nodeUrl || useCinevo.getState().nodeUrl,
            nodeToken: library.nodeToken || "",
            nodeDevice: library.nodeDevice || "",
            sources: nextSources,
            remoteTitles: remote,
            localTitles: [...nodeTitles, ...localKept],
            libraryOwner: user.id,
          });
        } else if (owner && owner !== user.id) {
          useCinevo.setState({
            plexToken: "",
            plexUser: "",
            plexServers: [],
            nodeToken: "",
            sources: useCinevo.getState().sources.filter((source) => source.kind === "folder"),
            remoteTitles: [],
            libraryOwner: user.id,
          });
        } else {
          useCinevo.setState({ libraryOwner: user.id });
        }
        ready.current = user.id;
      })
      .catch(() => {
        if (!cancel) ready.current = user.id;
      });
    return () => {
      cancel = true;
    };
  }, [hydrated, isPending, user]);

  useEffect(() => {
    if (!user || user.isDevFallback || ready.current !== user.id) return;
    const timer = window.setTimeout(() => {
      void saveAccountLibrary({ data: snapshot() }).catch(() => undefined);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [user, sources, plexToken, plexUser, plexClientId, plexServerCount, nodeToken, remoteCount]);

  return null;
}
