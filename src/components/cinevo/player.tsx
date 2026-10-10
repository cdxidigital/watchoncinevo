import { useEffect, useRef, useState } from "react";
import { Activity, Bookmark, Cast, Download, Expand, Info, Pause, Play, Subtitles, Volume2, VolumeX, X } from "lucide-react";
import { titleById, useCinevo } from "@/lib/cinevo-store";
import { mediaUrl, sourceForTitle } from "@/lib/library";
import { reconnectFolders } from "@/lib/folder-handles";
import { bumpWatch } from "@/lib/sharing";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import type { RemoteCommand } from "@/lib/remote-protocol";
import { issuePlayback } from "@/lib/playback";
import type { PlaybackFit } from "@/lib/playback-urls";
import { nodePlayUrl } from "@/lib/node-client";
import { castBlock, type WirelessVideo } from "@/lib/cast";
import { isLoopbackUrl } from "@/lib/playback-urls";
import { BrandWatermark } from "./logo";

function formatClock(current: number, duration: number) {
  const stamp = (n: number) => {
    if (!Number.isFinite(n) || n < 0) return "0:00";
    const m = Math.floor(n / 60);
    const s = Math.floor(n % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };
  return `${stamp(current)} / ${stamp(duration)}`;
}

function streamPath(file?: string, source?: string) {
  if (!file) return "No stream";
  if (file.startsWith("blob:")) return "Direct play · this browser";
  if (file.includes("/api/stream")) {
    if (source === "plex") return "CINEVO proxy · Plex";
    if (source === "jellyfin") return "CINEVO proxy · Jellyfin";
    if (source === "folder") return "CINEVO proxy · Node";
    return "CINEVO proxy";
  }
  if (file.includes("/v1/play")) return "Node on this computer";
  return "CINEVO proxy";
}

function captionTracks(video: HTMLVideoElement) {
  const tracks: TextTrack[] = [];
  for (let i = 0; i < video.textTracks.length; i++) {
    const track = video.textTracks[i];
    if (track.kind === "subtitles" || track.kind === "captions") tracks.push(track);
  }
  return tracks;
}

function shiftCueTimes(
  video: HTMLVideoElement,
  offset: number,
  bases: WeakMap<TextTrackCue, { start: number; end: number }>,
) {
  let cues = 0;
  for (const track of captionTracks(video)) {
    const list = track.cues;
    if (!list) continue;
    for (let i = 0; i < list.length; i++) {
      const cue = list[i];
      if (!("startTime" in cue) || !("endTime" in cue)) continue;
      let base = bases.get(cue);
      if (!base) {
        base = { start: cue.startTime, end: cue.endTime };
        bases.set(cue, base);
      }
      const start = Math.max(0, base.start + offset);
      cue.startTime = start;
      cue.endTime = Math.max(start + 0.05, base.end + offset);
      cues += 1;
    }
  }
  return cues;
}

export function Player() {
  const playingId = useCinevo((s) => s.playingId);
  const playing = useCinevo((s) => s.playing);
  const progress = useCinevo((s) => (s.playingId ? s.progress[s.playingId] ?? 0 : 0));
  const focusMode = useCinevo((s) => s.prefs.focusMode);
  const play = useCinevo((s) => s.play);
  const togglePlay = useCinevo((s) => s.togglePlay);
  const stopPlay = useCinevo((s) => s.stopPlay);
  const setProgress = useCinevo((s) => s.setProgress);
  const flash = useCinevo((s) => s.flash);
  const introSkip = useCinevo((s) => s.prefs.introSkip);
  const subtitleOffset = useCinevo((s) => s.prefs.subtitleOffset);
  const markers = useCinevo((s) => s.markers);
  const addMarker = useCinevo((s) => s.addMarker);
  const removeMarker = useCinevo((s) => s.removeMarker);
  const sources = useCinevo((s) => s.sources);
  const nodeUrl = useCinevo((s) => s.nodeUrl);
  const nodeToken = useCinevo((s) => s.nodeToken);
  const plexClient = useCinevo((s) => s.plexClientId);
  const user = useCurrentUser();
  const title = titleById(playingId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [muted, setMuted] = useState(true);
  const [chrome, setChrome] = useState(true);
  const [statsOpen, setStatsOpen] = useState(false);
  const [nerd, setNerd] = useState<{ output: string; dropped: string; buffered: string; clock: string; path: string } | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [remoteSrc, setRemoteSrc] = useState<string>();
  const [remoteErr, setRemoteErr] = useState("");
  const [remotePending, setRemotePending] = useState(false);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [fit, setFit] = useState<PlaybackFit>("original");
  const [fitTitle, setFitTitle] = useState<string | null | undefined>(playingId);
  if (fitTitle !== playingId) {
    setFitTitle(playingId);
    setFit("original");
  }
  const [onTv, setOnTv] = useState(false);
  const blob = title ? mediaUrl(title.id) : undefined;
  const file = playbackFailed ? undefined : blob || remoteSrc;
  const cueBase = useRef(new WeakMap<TextTrackCue, { start: number; end: number }>());
  const primed = useRef("");

  useEffect(() => {
    const video = videoRef.current as WirelessVideo | null;
    if (!video || !file) {
      setOnTv(false);
      return;
    }
    video.disableRemotePlayback = false;
    video.setAttribute("x-webkit-airplay", "allow");
    const remote = video.remote;
    if (!remote) return;
    const mark = () => setOnTv(remote.state === "connected");
    remote.addEventListener("connect", mark);
    remote.addEventListener("connecting", mark);
    remote.addEventListener("disconnect", mark);
    mark();
    return () => {
      remote.removeEventListener("connect", mark);
      remote.removeEventListener("connecting", mark);
      remote.removeEventListener("disconnect", mark);
    };
  }, [file]);

  const onCast = () => {
    const video = videoRef.current as WirelessVideo | null;
    if (!video || !file) return;
    const block = castBlock(file, window.location.href);
    if (block === "local") {
      flash("This file is only in this browser. Cast and AirPlay need a proxied stream the TV can open.");
      return;
    }
    if (block === "loopback") {
      flash("This page is on localhost. A TV cannot open it. Use the house address on your network.");
      return;
    }
    const remote = video.remote;
    if (remote?.prompt) {
      void remote.prompt().catch((err: unknown) => {
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError" || name === "AbortError") return;
        if (typeof video.webkitShowPlaybackTargetPicker === "function") {
          video.webkitShowPlaybackTargetPicker();
          return;
        }
        flash("No Cast or AirPlay receiver answered. Use Chrome on Android, or Safari on iPhone or Mac, on the same network.");
      });
      return;
    }
    if (typeof video.webkitShowPlaybackTargetPicker === "function") {
      video.webkitShowPlaybackTargetPicker();
      return;
    }
    flash("This browser has no Cast or AirPlay. Use Chrome on Android, or Safari on iPhone or Mac.");
  };

  useEffect(() => {
    let cancelled = false;
    setRemoteSrc(undefined);
    setRemoteErr("");
    setRemotePending(false);
    setPlaybackFailed(false);
    setStatsOpen(false);
    setInfoOpen(false);
    primed.current = "";
    cueBase.current = new WeakMap();
    if (!title || mediaUrl(title.id)) return;
    const source =
      sourceForTitle(title, sources) ||
      sources.find((item) => item.kind === title.source && item.baseUrl && (item.accessToken || item.kind === "folder"));
    const openProxy = (
      provider: "plex" | "jellyfin" | "node",
      uri: string,
      key: string,
      token: string,
      clientId?: string,
    ) => {
      setRemotePending(true);
      void issuePlayback({ data: { provider, uri, key, token, clientId, fit: provider === "node" ? "original" : fit } })
        .then((res) => {
          if (cancelled) return;
          if (res.ok) setRemoteSrc(res.src);
          else setRemoteErr(res.error);
        })
        .catch(() => {
          if (!cancelled) setRemoteErr("Could not open a playback stream through CINEVO.");
        })
        .finally(() => {
          if (!cancelled) setRemotePending(false);
        });
    };
    if (title.source === "folder" && source?.baseUrl && title.path && nodeToken) {
      const base = source.baseUrl || nodeUrl;
      if (isLoopbackUrl(base)) {
        setRemoteSrc(nodePlayUrl(base, nodeToken, title.path, title.id));
        return;
      }
      openProxy("node", base, title.path, nodeToken, title.id);
      return () => {
        cancelled = true;
      };
    }
    if ((title.source === "plex" || title.source === "jellyfin") && title.path && source?.baseUrl && source.accessToken) {
      openProxy(title.source, source.baseUrl, title.path, source.accessToken, plexClient || undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [title, nodeToken, nodeUrl, plexClient, sources, fit]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !file) return;
    video.muted = muted;
    if (playing) void video.play().catch(() => useCinevo.setState({ playing: false }));
    else video.pause();
  }, [playing, file, playingId, muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !file) return;
    const on = captionTracks(video).some((track) => track.mode === "showing");
    if (on) shiftCueTimes(video, subtitleOffset, cueBase.current);
  }, [subtitleOffset, file, playingId]);

  useEffect(() => {
    if (!playing || !file) {
      setChrome(true);
      return;
    }
    let timer = window.setTimeout(() => setChrome(false), 2200);
    const bump = () => {
      setChrome(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setChrome(false), 2200);
    };
    window.addEventListener("mousemove", bump);
    window.addEventListener("touchstart", bump);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousemove", bump);
      window.removeEventListener("touchstart", bump);
    };
  }, [playing, file]);

  useEffect(() => {
    if (!playingId || !user || user.isDevFallback) return;
    void bumpWatch().catch(() => undefined);
  }, [playingId, user]);

  useEffect(() => {
    if (!statsOpen) return;
    const tick = () => {
      const v = videoRef.current;
      const path = streamPath(file, title?.source);
      if (!v) {
        setNerd({ output: "—", dropped: "—", buffered: "—", clock: "—", path });
        return;
      }
      const quality = v.getVideoPlaybackQuality?.();
      const buffered = v.buffered?.length ? v.buffered.end(v.buffered.length - 1) : 0;
      setNerd({
        output: v.videoWidth ? `${v.videoWidth}×${v.videoHeight}` : "—",
        dropped: quality ? `${quality.droppedVideoFrames} / ${quality.totalVideoFrames}` : "—",
        buffered: buffered ? `${Math.round(buffered)}s` : "—",
        clock: formatClock(v.currentTime, v.duration),
        path,
      });
    };
    tick();
    const id = window.setInterval(tick, 400);
    return () => window.clearInterval(id);
  }, [statsOpen, file, title?.source]);

  const seek = (value: number) => {
    if (!title) return;
    setProgress(title.id, value);
    const video = videoRef.current;
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      video.currentTime = (value / 100) * video.duration;
    }
  };

  const onToggle = () => {
    if (!title) return;
    const video = videoRef.current;
    if ((progress >= 100 || video?.ended) && video && file) {
      video.currentTime = 0;
      setProgress(title.id, 0);
      useCinevo.setState({ playing: true });
      void video.play().catch(() => useCinevo.setState({ playing: false }));
      return;
    }
    if (video && file) {
      if (video.paused) {
        useCinevo.setState({ playing: true });
        void video.play().catch(() => useCinevo.setState({ playing: false }));
      } else {
        video.pause();
        useCinevo.setState({ playing: false });
      }
      return;
    }
    if (progress >= 100) play(title.id);
    else togglePlay();
  };

  useEffect(() => {
    const onRemote = (event: Event) => {
      const command = (event as CustomEvent<RemoteCommand>).detail;
      if (!command) return;
      const video = videoRef.current;
      const current = titleById(useCinevo.getState().playingId);
      if (command.type === "playTitle") {
        play(command.titleId);
        return;
      }
      if (!current) return;
      if (command.type === "stop") {
        stopPlay();
        return;
      }
      if (command.type === "toggle") {
        onToggle();
        return;
      }
      if (command.type === "play") {
        useCinevo.setState({ playing: true });
        if (video) void video.play().catch(() => useCinevo.setState({ playing: false }));
        return;
      }
      if (command.type === "pause") {
        if (video) video.pause();
        useCinevo.setState({ playing: false });
        return;
      }
      if (command.type === "volume") {
        if (!video) return;
        video.volume = command.value;
        video.muted = command.value <= 0;
        setMuted(command.value <= 0);
        return;
      }
      if (command.type === "seek" && video && Number.isFinite(video.duration) && video.duration > 0) {
        if (typeof command.by === "number") {
          video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + command.by));
        } else if (typeof command.to === "number") {
          video.currentTime = (command.to / 100) * video.duration;
        }
        setProgress(current.id, (video.currentTime / video.duration) * 100);
      } else if (command.type === "seek" && typeof command.to === "number") {
        seek(command.to);
      }
    };
    window.addEventListener("cinevo-remote", onRemote);
    return () => window.removeEventListener("cinevo-remote", onRemote);
  });

  useEffect(() => {
    if (!title) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        setStatsOpen((open) => !open);
        return;
      }
      if (e.key !== " ") return;
      e.preventDefault();
      onToggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // onToggle closes over current video/progress
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, file, progress, playing]);

  if (!title) return null;

  const missing = remotePending
    ? fit === "compatible"
      ? "This file will not play as-is. Asking your server for a browser-friendly copy…"
      : "Opening a private stream through CINEVO…"
    : remoteErr
      ? remoteErr
      : title.source === "folder"
        ? "Folder playback needs a folder picked in this browser, or a paired CINEVO Node for a disk path."
        : title.source === "shared"
          ? "Shared libraries are an index only. Playback stays on the original Plex or Jellyfin server."
          : title.source === "plex" || title.source === "jellyfin"
            ? "Reconnect this library so CINEVO can proxy playback from your server."
            : "No playable file on this device.";

  return (
    <div
      ref={stageRef}
      className="fixed inset-0 z-50 bg-cine-bg text-cine-text"
      role="dialog"
      aria-modal="true"
      aria-label={`${title.title} player`}
      onClick={() => file && onToggle()}
    >
      {file ? (
        <video
          ref={videoRef}
          data-cinevo-player=""
          src={file}
          className="player-video absolute inset-0 h-full w-full bg-cine-bg object-contain"
          playsInline
          preload="auto"
          autoPlay
          disableRemotePlayback={false}
          muted={muted}
          onLoadedData={(e) => {
            const v = e.currentTarget;
            v.muted = muted;
            if (primed.current !== title.id) {
              primed.current = title.id;
              const skip = useCinevo.getState().prefs.introSkip;
              if (progress > 0 && progress < 100 && Number.isFinite(v.duration)) {
                v.currentTime = (progress / 100) * v.duration;
              } else if (skip > 0 && Number.isFinite(v.duration) && v.duration > skip + 1) {
                v.currentTime = skip;
                setProgress(title.id, (skip / v.duration) * 100);
                flash(`Skipped the first ${skip}s`);
              }
            }
            if (playing) void v.play().catch(() => useCinevo.setState({ playing: false }));
          }}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            if (!v.duration) return;
            setProgress(title.id, (v.currentTime / v.duration) * 100);
          }}
          onError={() => {
            if (!blob && !remoteSrc) return;
            if (
              !blob &&
              remoteSrc?.includes("/api/stream") &&
              fit === "original" &&
              (title.source === "plex" || title.source === "jellyfin")
            ) {
              setFit("compatible");
              setPlaybackFailed(false);
              return;
            }
            setPlaybackFailed(true);
            if (blob) setRemoteErr("This file could not be played in the browser.");
            else if (remoteSrc?.includes("/v1/play")) setRemoteErr("Could not play this file from Node on this computer.");
            else if (fit === "compatible") setRemoteErr("Your server could not make a browser-friendly copy of this file.");
            else setRemoteErr("CINEVO could not play this file through the proxy. The server has to be reachable from here.");
          }}
          onEnded={() => {
            setProgress(title.id, 100);
            useCinevo.setState({ playing: false });
            setChrome(true);
          }}
        />
      ) : (
        <img src={title.still || title.poster} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <BrandWatermark
        className={`absolute left-4 top-4 z-10 transition-opacity ${
          file && playing && !chrome ? "opacity-40" : "opacity-90"
        }`}
      />
      {statsOpen ? (
        <dl className="nerd-stats" onClick={(e) => e.stopPropagation()}>
          <div>
            <dt>Title</dt>
            <dd>{title.title}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{title.sourceLabel || title.source}</dd>
          </div>
          <div>
            <dt>Decision</dt>
            <dd>{nerd?.path ?? streamPath(file, title.source)}</dd>
          </div>
          <div>
            <dt>Quality</dt>
            <dd>
              {fit === "compatible"
                ? "Browser copy · your server"
                : file?.startsWith("/api/stream")
                  ? "Original · proxied"
                  : file
                    ? "Original on this device"
                    : "—"}
            </dd>
          </div>
          <div>
            <dt>Output</dt>
            <dd>{nerd?.output ?? "—"}</dd>
          </div>
          <div>
            <dt>Dropped frames</dt>
            <dd>{nerd?.dropped ?? "—"}</dd>
          </div>
          <div>
            <dt>Buffered</dt>
            <dd>{nerd?.buffered ?? "—"}</dd>
          </div>
          <div>
            <dt>Clock</dt>
            <dd>{nerd?.clock ?? "—"}</dd>
          </div>
          <div>
            <dt>Intro skip</dt>
            <dd>{introSkip > 0 ? `${introSkip}s from the start` : "Off"}</dd>
          </div>
          <div>
            <dt>Subtitle offset</dt>
            <dd>{subtitleOffset ? `${subtitleOffset > 0 ? "+" : ""}${subtitleOffset}s` : "0s"}</dd>
          </div>
          <div>
            <dt>Text track</dt>
            <dd>{videoRef.current ? (captionTracks(videoRef.current).length ? "Present" : "None on this file") : "—"}</dd>
          </div>
        </dl>
      ) : null}
      {infoOpen ? (
        <aside className="player-info" onClick={(e) => e.stopPropagation()}>
          <p className="player-info__kicker">On this file</p>
          <h2>{title.title}</h2>
          <p>
            {[title.year, title.runtime, title.genre].filter(Boolean).join(" · ")}
          </p>
          {title.director ? <p>Directed by {title.director}</p> : null}
          {title.cast?.length ? <p>{title.cast.slice(0, 6).join(", ")}</p> : null}
          {title.synopsis ? <p>{title.synopsis}</p> : null}
          <p className="player-info__note">
            {title.sourceLabel || title.source || "This house"} · CINEVO does not add a public filmography.
          </p>
        </aside>
      ) : null}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-linear-to-t from-cine-bg to-transparent transition-opacity ${
          chrome ? "opacity-100" : "opacity-0"
        }`}
      />
      <button
        type="button"
        aria-label="Close player"
        onClick={(e) => {
          e.stopPropagation();
          stopPlay();
        }}
        className={`absolute right-4 top-4 z-10 flex size-11 items-center justify-center rounded-full border border-cine-line bg-cine-elevated/80 text-cine-text transition-opacity ${
          chrome ? "opacity-100" : "opacity-0"
        }`}
      >
        <X size={18} />
      </button>
      <div
        className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 transition-opacity ${
          file && playing && !chrome ? "opacity-0" : "opacity-100"
        }`}
      >
        {file ? (
          <span className="flex size-16 items-center justify-center rounded-full bg-cine-text text-cine-bg">
            {playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
          </span>
        ) : (
          <div className="pointer-events-auto max-w-md text-center">
            <p className="font-ui text-sm text-cine-muted">{missing}</p>
            {title.source === "folder" && !remotePending ? (
              <button
                type="button"
                className="house-btn house-btn--play mt-4"
                onClick={async (e) => {
                  e.stopPropagation();
                  const n = await reconnectFolders();
                  if (n) {
                    useCinevo.setState({ localTitles: [...useCinevo.getState().localTitles] });
                    flash(`Reconnected ${n} files`);
                  } else {
                    flash("Re-select the folder in Library");
                    useCinevo.getState().setRoom("sidebar");
                    stopPlay();
                  }
                }}
              >
                Reconnect folder
              </button>
            ) : null}
          </div>
        )}
        {file && muted && playing ? (
          <p className="font-ui text-xs font-medium uppercase tracking-[0.08em] text-cine-muted">Sound off · unmute in the bar</p>
        ) : null}
      </div>
      <section
        className={`player-bar absolute inset-x-0 bottom-0 z-10 space-y-3 transition-opacity ${
          chrome ? "opacity-100" : "pointer-events-none opacity-0"
        } ${focusMode ? "opacity-70" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="font-ui text-xs font-medium tracking-[0.08em] text-cine-muted">
          {progress >= 100
            ? "Finished · Play again from the start"
            : file
              ? "Esc closes · Space pauses · I stats"
              : "Esc closes"}
        </p>
        {file ? (
          <div className="player-marks">
            {introSkip > 0 ? (
              <button
                type="button"
                onClick={() => {
                  const v = videoRef.current;
                  if (!v || !Number.isFinite(v.duration) || v.duration <= introSkip) {
                    flash("This file is shorter than the skip");
                    return;
                  }
                  v.currentTime = introSkip;
                  setProgress(title.id, (introSkip / v.duration) * 100);
                }}
              >
                Skip {introSkip}s
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                const v = videoRef.current;
                const at = v && v.duration ? (v.currentTime / v.duration) * 100 : progress;
                const stamp = v && Number.isFinite(v.currentTime) ? formatClock(v.currentTime, v.duration).split(" / ")[0] : "";
                addMarker(title.id, at, stamp ? `Mark ${stamp}` : "Marker");
              }}
            >
              <Bookmark size={14} /> Mark
            </button>
            {markers
              .filter((marker) => marker.titleId === title.id)
              .map((marker) => (
                <span key={marker.id} className="player-mark">
                  <button type="button" onClick={() => seek(marker.at)}>
                    {marker.label}
                  </button>
                  <button type="button" aria-label={`Remove ${marker.label}`} onClick={() => removeMarker(marker.id)}>
                    <X size={12} />
                  </button>
                </span>
              ))}
          </div>
        ) : null}
        {file ? (
          <div className="flex items-center gap-3 font-mono text-xs text-cine-muted">
            <span className="w-10 tabular-nums">{Math.round(progress)}%</span>
            <input
              aria-label="Timeline"
              type="range"
              min={0}
              max={100}
              value={progress}
              onChange={(e) => seek(Number(e.target.value))}
              className="h-1 flex-1 accent-cine-cyan"
            />
            <span>{title.runtime}</span>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {file ? (
              <button
                type="button"
                onClick={onToggle}
                aria-label={playing ? "Pause" : "Play"}
                className="flex size-11 items-center justify-center"
              >
                {playing ? <Pause size={18} /> : <Play size={18} />}
              </button>
            ) : null}
            <strong className="truncate font-ui text-lg font-semibold tracking-tight">{title.title}</strong>
          </div>
          <div className="flex max-w-full flex-wrap items-center justify-end text-cine-muted">
            {file ? (
              <>
                <button
                  type="button"
                  aria-label={muted ? "Unmute" : "Mute"}
                  className="flex size-11 items-center justify-center"
                  onClick={() => {
                    const next = !muted;
                    setMuted(next);
                    if (videoRef.current) videoRef.current.muted = next;
                  }}
                >
                  {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
                <button
                  type="button"
                  aria-label="Subtitles"
                  aria-pressed={Boolean(videoRef.current && captionTracks(videoRef.current).some((track) => track.mode === "showing"))}
                  className="flex size-11 items-center justify-center"
                  onClick={() => {
                    const video = videoRef.current;
                    if (!video) {
                      flash("No subtitles on this file");
                      return;
                    }
                    const tracks = captionTracks(video);
                    if (!tracks.length) {
                      flash("No subtitles on this file");
                      return;
                    }
                    const showing = tracks.some((track) => track.mode === "showing");
                    if (showing) {
                      for (const track of tracks) track.mode = "hidden";
                      flash("Subtitles off");
                      return;
                    }
                    for (const track of tracks) track.mode = "showing";
                    const offset = useCinevo.getState().prefs.subtitleOffset;
                    const cues = shiftCueTimes(video, offset, cueBase.current);
                    if (offset !== 0 && cues === 0) {
                      flash("Track on. Cue times are not exposed yet, so the offset cannot move them.");
                    } else if (offset !== 0) {
                      flash(`Subtitles on · ${offset > 0 ? "+" : ""}${offset}s`);
                    } else {
                      flash("Subtitles on");
                    }
                  }}
                >
                  <Subtitles size={18} />
                </button>
                <button
                  type="button"
                  aria-pressed={infoOpen}
                  aria-label={infoOpen ? "Hide file info" : "File info"}
                  className="flex size-11 items-center justify-center"
                  onClick={() => setInfoOpen((open) => !open)}
                >
                  <Info size={18} />
                </button>
                <button
                  type="button"
                  aria-pressed={statsOpen}
                  aria-label={statsOpen ? "Hide nerd stats" : "Show nerd stats"}
                  className="flex size-11 items-center justify-center"
                  onClick={() => setStatsOpen((open) => !open)}
                >
                  <Activity size={18} />
                </button>
                <button
                  type="button"
                  aria-label="Download original"
                  className="flex size-11 items-center justify-center"
                  onClick={() => {
                    if (!file.startsWith("/api/stream")) {
                      flash("This file plays from the browser. Use the folder if you need the original.");
                      return;
                    }
                    const href = `${file}${file.includes("?") ? "&" : "?"}download=1`;
                    const link = document.createElement("a");
                    link.href = href;
                    link.download = `${title.title}.mp4`;
                    document.body.appendChild(link);
                    link.click();
                    link.remove();
                  }}
                >
                  <Download size={18} />
                </button>
                <button
                  type="button"
                  aria-pressed={onTv}
                  aria-label={onTv ? "Playing on a TV" : "Play on a TV"}
                  className={`flex size-11 items-center justify-center ${onTv ? "text-cine-cyan" : ""}`}
                  onClick={onCast}
                >
                  <Cast size={18} />
                </button>
                <button
                  type="button"
                  aria-label="Fullscreen"
                  className="flex size-11 items-center justify-center"
                  onClick={() => {
                    const node = stageRef.current;
                    if (!node) return;
                    if (document.fullscreenElement) void document.exitFullscreen();
                    else void node.requestFullscreen();
                  }}
                >
                  <Expand size={18} />
                </button>
              </>
            ) : null}
            <button type="button" className="h-11 px-3 font-ui text-sm font-bold text-cine-cyan" onClick={stopPlay}>
              Close
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
