import assert from "node:assert/strict";
import test from "node:test";
import { applySourceFilter, isVideoFile, migrateTheme, parseFilename, parseMediaFilename, sourceForTitle } from "./library.ts";
import type { LibraryTitle, LibSource } from "./library.ts";

test("parseFilename reads title and year", () => {
  assert.equal(parseFilename("Blade Runner (1982).mkv").title, "Blade Runner");
  assert.equal(parseFilename("Blade Runner (1982).mkv").year, "1982");
  assert.equal(parseFilename("The.Matrix.1999.1080p.BluRay.x264.mp4").title.includes("Matrix"), true);
  assert.equal(parseFilename("The.Matrix.1999.1080p.BluRay.x264.mp4").year, "1999");
  assert.equal(isVideoFile("foo.mp4"), true);
  assert.equal(isVideoFile("notes.txt"), false);
});

test("parseMediaFilename follows Plex-style episode naming", () => {
  const sxe = parseMediaFilename("Slow Horses.S03E04.Uninvited Guests.1080p.WEB-DL.mkv");
  assert.equal(sxe.kind, "series");
  assert.equal(sxe.seriesTitle, "Slow Horses");
  assert.equal(sxe.season, 3);
  assert.equal(sxe.episode, 4);
  assert.equal(sxe.title, "Slow Horses - S03E04 - Uninvited Guests");

  const x = parseMediaFilename("The Wire - 2x11 - Bad Dreams.mkv");
  assert.equal(x.kind, "series");
  assert.equal(x.title, "The Wire - S02E11 - Bad Dreams");

  const nested = parseMediaFilename("Slow Horses/Season 03/S03E04 - Uninvited Guests.mkv");
  assert.equal(nested.kind, "series");
  assert.equal(nested.seriesTitle, "Slow Horses");
  assert.equal(nested.title, "Slow Horses - S03E04 - Uninvited Guests");

  assert.equal(parseMediaFilename("Blade Runner (1982).mkv").kind, "movie");
});

test("migrateTheme maps legacy ids", () => {
  assert.equal(migrateTheme("nova"), "harbor");
  assert.equal(migrateTheme("pulse"), "harbor");
  assert.equal(migrateTheme("noir"), "ink");
  assert.equal(migrateTheme("iris"), "day");
  assert.equal(migrateTheme("paper"), "day");
  assert.equal(migrateTheme("sage"), "grove");
  assert.equal(migrateTheme("ember"), "ember");
  assert.equal(migrateTheme("unknown"), "harbor");
});

function stub(id: string, source: LibraryTitle["source"]): LibraryTitle {
  return {
    id,
    title: id,
    kind: "movie",
    year: "2024",
    runtime: "90m",
    genre: "Drama",
    genres: ["Drama"],
    synopsis: "",
    cast: [],
    director: "",
    rating: 0,
    addedAt: "2024-01-01",
    poster: "",
    still: "",
    accent: "cyan",
    source,
    sourceLabel: source,
  };
}

test("applySourceFilter isolates shared catalogs", () => {
  const local = [stub("f1", "folder")];
  const remote = [stub("p1", "plex"), stub("j1", "jellyfin"), stub("s1", "shared")];
  assert.equal(applySourceFilter("all", local, remote).length, 4);
  assert.deepEqual(
    applySourceFilter("shared", local, remote).map((t) => t.id),
    ["s1"],
  );
  assert.deepEqual(
    applySourceFilter("folder", local, remote).map((t) => t.id),
    ["f1"],
  );
  assert.deepEqual(
    applySourceFilter("plex", local, remote).map((t) => t.id),
    ["p1"],
  );
});

test("sourceForTitle matches label and kind", () => {
  const sources: LibSource[] = [
    { id: "plex-1", kind: "plex", name: "Living Room", selected: true, count: 1 },
    { id: "jf-1", kind: "jellyfin", name: "james", selected: true, count: 1 },
  ];
  assert.equal(sourceForTitle({ source: "plex", sourceLabel: "Living Room" }, sources)?.id, "plex-1");
  assert.equal(sourceForTitle({ source: "jellyfin", sourceLabel: "james · Movies" }, sources)?.id, "jf-1");
  assert.equal(sourceForTitle({ source: "folder", sourceLabel: "Living Room" }, sources), undefined);
});
