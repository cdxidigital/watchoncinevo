import { useState } from "react";
import { libraryPool, useCinevo } from "@/lib/cinevo-store";
import { planLibrary, type LibraryAction, type LibraryPlan } from "@/lib/organise-library";

const PRESETS = [
  { label: "By genre", q: "Put every title onto shelves by genre." },
  { label: "By decade", q: "Organise my library into shelves by decade." },
  { label: "Movie night", q: "Build three moods of movie-night shelves from what I have." },
  { label: "Tidy shelves", q: "Tidy my existing shelves: merge duplicates, give them clearer names, and drop empty ones." },
];

function describe(action: LibraryAction, titleName: (id: string) => string, shelfName: (ref: string) => string) {
  const list = (ids: string[]) => {
    const names = ids.slice(0, 3).map(titleName);
    return ids.length > 3 ? `${names.join(", ")} +${ids.length - 3}` : names.join(", ");
  };
  switch (action.type) {
    case "create_shelf":
      return { verb: "New shelf", detail: `${action.name}${action.titleIds.length ? ` · ${list(action.titleIds)}` : ""}` };
    case "add_to_shelf":
      return { verb: "Add", detail: `${list(action.titleIds)} → ${shelfName(action.shelf)}` };
    case "remove_from_shelf":
      return { verb: "Remove", detail: `${list(action.titleIds)} from ${shelfName(action.shelf)}` };
    case "rename_shelf":
      return { verb: "Rename shelf", detail: `${shelfName(action.shelf)} → ${action.name}` };
    case "delete_shelf":
      return { verb: "Delete shelf", detail: `${shelfName(action.shelf)} (titles stay in the library)` };
    case "retag_title":
      return { verb: "Retag", detail: `${titleName(action.titleId)} → ${action.genre}` };
    case "rename_title":
      return { verb: "Rename", detail: `${titleName(action.titleId)} → ${action.name}` };
  }
}

export function OrganisePanel() {
  const collections = useCinevo((s) => s.collections);
  const planUndo = useCinevo((s) => s.planUndo);
  const applyLibraryPlan = useCinevo((s) => s.applyLibraryPlan);
  const undoLibraryPlan = useCinevo((s) => s.undoLibraryPlan);
  const flash = useCinevo((s) => s.flash);
  const [request, setRequest] = useState("");
  const [plan, setPlan] = useState<LibraryPlan | null>(null);
  const [pending, setPending] = useState(false);

  const propose = async () => {
    const trimmed = request.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setPlan(null);
    try {
      const res = await planLibrary({
        data: {
          request: trimmed,
          titles: libraryPool()
            .slice(0, 300)
            .map((t) => ({ id: t.id, title: t.title.slice(0, 200), year: String(t.year ?? "").slice(0, 12), kind: String(t.kind ?? "").slice(0, 20), genre: String(t.genre ?? "").slice(0, 60) })),
          shelves: collections.slice(0, 40).map((c) => ({ id: c.id, name: c.name.slice(0, 60), titleIds: c.titleIds.slice(0, 300) })),
        },
      });
      if (res.ok) setPlan(res.plan);
      else flash(res.error);
    } catch {
      flash("The librarian is unavailable. Sign in and try again.");
    } finally {
      setPending(false);
    }
  };

  const titles = new Map(libraryPool().map((t) => [t.id, t.title]));
  const titleName = (id: string) => titles.get(id) ?? "Unknown title";
  const shelfName = (ref: string) => (ref.startsWith("new:") ? ref.slice(4) : collections.find((c) => c.id === ref)?.name ?? "a shelf");

  return (
    <div className="mt-4 flex flex-col gap-3">
      <p className="text-sm leading-relaxed text-cine-muted">
        Your server, your way. Describe how you want the library arranged. You&apos;ll see every change before anything moves, and files are never touched.
      </p>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" className="h-11 rounded-full border border-white/10 bg-white/5 px-4 font-ui text-sm" onClick={() => setRequest(p.q)}>
            {p.label}
          </button>
        ))}
      </div>
      <label className="sr-only" htmlFor="organise-request">How should CINEVO organise your library?</label>
      <textarea
        id="organise-request"
        value={request}
        onChange={(e) => setRequest(e.target.value)}
        maxLength={400}
        placeholder="Shelf every Nolan film together and retag anything untagged."
        className="h-28 w-full rounded-2xl border border-white/10 bg-black/30 p-3 font-ui"
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={propose} disabled={pending || !request.trim()} className="house-btn house-btn--play h-11">
          {pending ? "Planning…" : "Plan changes"}
        </button>
        {planUndo ? (
          <button type="button" onClick={undoLibraryPlan} className="house-btn house-btn--ghost h-11">
            Undo last change
          </button>
        ) : null}
      </div>
      {plan ? (
        <section aria-label="Proposed changes" className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-sm leading-relaxed text-cine-muted">{plan.summary}</p>
          {plan.actions.length ? (
            <>
              <ul className="flex max-h-56 flex-col gap-2 overflow-y-auto">
                {plan.actions.map((action, i) => {
                  const { verb, detail } = describe(action, titleName, shelfName);
                  return (
                    <li key={i} className="flex gap-2 text-sm leading-relaxed">
                      <b className="shrink-0 font-ui text-cine-cyan">{verb}</b>
                      <span className="min-w-0 text-cine-muted">{detail}</span>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="house-btn house-btn--play h-11"
                  onClick={() => {
                    if (applyLibraryPlan(plan.actions)) setPlan(null);
                    else flash("Nothing in that plan matched your library.");
                  }}
                >
                  Apply {plan.actions.length} change{plan.actions.length === 1 ? "" : "s"}
                </button>
                <button type="button" className="house-btn house-btn--ghost h-11" onClick={() => setPlan(null)}>
                  Discard
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-cine-faint">No changes needed. Try a more specific request.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
