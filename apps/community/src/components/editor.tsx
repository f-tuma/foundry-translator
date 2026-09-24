import { useEffect, useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  Search,
  FileText,
  LockKeyhole,
  Check,
  Upload,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
import {
  maskReviewReferences,
  restoreReviewReferences,
} from "../../../../src/review/text-plan";
import { api, useSession } from "../api";
import type { Change, Doc, Proposal, Unit } from "../shared";
import { useGlossary } from "./glossary";
import { Notice, Help } from "./shell";

function useDrafts(userId: string) {
  const key = `ember.editor-draft.v1.${userId}`;
  const [drafts, setDrafts] = useState<Record<string, Change>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || "{}");
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
      return Object.fromEntries(
        Object.entries(raw).filter(
          ([id, c]: [string, any]) =>
            c &&
            c.unitId === id &&
            typeof c.baseRevision === "string" &&
            Array.isArray(c.before) &&
            Array.isArray(c.after) &&
            c.before.length === c.after.length &&
            c.before.every((v: unknown) => typeof v === "string") &&
            c.after.every((v: unknown) => typeof v === "string"),
        ),
      ) as Record<string, Change>;
    } catch {
      return {};
    }
  });
  const [error, setError] = useState("");
  useEffect(() => {
    try {
      if (Object.keys(drafts).length)
        localStorage.setItem(key, JSON.stringify(drafts));
      else localStorage.removeItem(key);
      setError("");
    } catch {
      setError(
        "Prohlížeč nemůže uložit koncept. Uložte návrh na server před zavřením stránky.",
      );
    }
  }, [drafts, key]);
  useEffect(() => {
    if (!Object.keys(drafts).length) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [drafts]);
  return {
    drafts,
    setDrafts,
    error,
    clear: () => {
      try {
        localStorage.removeItem(key);
      } catch {
        /* The confirmed server proposal is already safe. */
      }
      setDrafts({});
    },
  };
}
function ReferenceFields({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange?: (value: string) => void;
  label: string;
}) {
  const masked = maskReviewReferences(value);
  const [error, setError] = useState("");
  return (
    <>
      {masked.references.map((reference, index) => (
        <label key={reference.marker}>
          <span className="reference-marker">{reference.marker}</span>
          {onChange && reference.editable ? (
            <input
              aria-label={`${label} — název odkazu ${index + 1}`}
              value={reference.label}
              onChange={(event) => {
                try {
                  onChange(
                    restoreReviewReferences(
                      masked.text,
                      masked.references.map((item, i) =>
                        i === index
                          ? { ...item, label: event.target.value }
                          : item,
                      ),
                    ),
                  );
                  setError("");
                } catch {
                  setError("Popisek odkazu obsahuje nepovolené znaky.");
                }
              }}
            />
          ) : (
            <span>{reference.label || "Chráněný příkaz"}</span>
          )}
        </label>
      ))}
      <Notice error={error} />
    </>
  );
}

function RowReferences({
  source,
  target,
  row,
  onChange,
}: {
  source: string[];
  target: string[];
  row: number;
  onChange: (parts: string[]) => void;
}) {
  const count = Math.max(
    ...[source, target].map((parts) =>
      parts.reduce(
        (n, part) => n + maskReviewReferences(part).references.length,
        0,
      ),
    ),
  );
  if (!count) return null;
  return (
    <details className="reference-labels row-references">
      <summary>
        <ChevronRight size={14} className="disclosure-arrow" />
        <LockKeyhole size={12} />
        Odkazy ({count})
      </summary>
      <div className="reference-columns">
        <div>
          <h3>Originál</h3>
          {source.map((value, index) => (
            <ReferenceFields
              key={index}
              value={value}
              label={`Originál ${row}.${index + 1}`}
            />
          ))}
        </div>
        <div>
          <h3>Český překlad</h3>
          {target.map((value, index) => (
            <ReferenceFields
              key={index}
              value={value}
              label={`Překlad ${row}.${index + 1}`}
              onChange={(next) =>
                onChange(target.map((part, i) => (i === index ? next : part)))
              }
            />
          ))}
        </div>
      </div>
    </details>
  );
}

export function TextPart({
  value,
  onChange,
  label,
  showReferences = true,
}: {
  value: string;
  onChange?: (value: string) => void;
  label: string;
  showReferences?: boolean;
}) {
  const masked = maskReviewReferences(value);
  const [error, setError] = useState("");
  const update = (text: string, references = masked.references) => {
    try {
      onChange?.(restoreReviewReferences(text, references));
      setError("");
    } catch {
      setError("Značky odkazů musí zůstat zachované a ve stejném pořadí.");
    }
  };
  return (
    <>
      {onChange ? (
        <textarea
          aria-label={label}
          className="prose-input"
          value={masked.text}
          rows={Math.max(2, Math.min(12, Math.ceil(masked.text.length / 48)))}
          onChange={(e) => update(e.target.value)}
        />
      ) : (
        <p className="prose">{masked.text}</p>
      )}
      {showReferences && masked.references.length ? (
        <details className="reference-labels">
          <summary>
            <LockKeyhole size={12} />
            Odkazy ({masked.references.length})
          </summary>
          <ReferenceFields value={value} onChange={onChange} label={label} />
        </details>
      ) : null}
      <Notice error={error} />
    </>
  );
}
export function Editor({
  initial = {},
}: {
  initial?: { book?: string; q?: string; state?: string; all?: boolean };
}) {
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  // Shell mounts this component only for an admitted member.
  const who = useSession().data!.member!;
  const qc = useQueryClient();
  const {
    drafts,
    setDrafts,
    error: storageError,
    clear: clearDrafts,
  } = useDrafts(who.id);
  const [book, setBook] = useState(initial.book || ""),
    [search, setSearch] = useState(initial.q || ""),
    [filter, setFilter] = useState(initial.state || "all"),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<string | null>(null),
    [side, setSide] = useState("context"),
    [contextOpen, setContextOpen] = useState(false);
  const [submit, setSubmit] = useState<"draft" | "submit" | null>(null),
    [title, setTitle] = useState(""),
    [requestId, setRequestId] = useState("");
  const books = useQuery({
    queryKey: ["books"],
    queryFn: () => api<{ books: Doc[] }>("books"),
  });
  const selectedBook =
    book || (initial.all ? "" : books.data?.books[0]?.id) || "";
  const rows = useQuery({
    queryKey: ["units", selectedBook, search, filter, offset],
    queryFn: () =>
      api<{ rows: Unit[]; total: number }>(
        `units?book=${search ? "" : selectedBook}&q=${encodeURIComponent(search)}&state=${filter}&offset=${offset}`,
      ),
    enabled: !!books.data?.books.length,
  });
  const glossary = useGlossary();
  const active =
    rows.data?.rows.find((r) => r.id === selected) || rows.data?.rows[0];
  const currentDoc = books.data?.books.find((b) => b.id === selectedBook);
  const proposals = useQuery({
    queryKey: ["proposals"],
    queryFn: () => api<{ proposals: Proposal[] }>("proposals"),
    enabled: side === "discussion",
  });
  const history = useQuery({
    queryKey: ["history"],
    queryFn: () =>
      api<{ events: { action: string; author: string; at: string }[] }>(
        "history",
      ),
    enabled: side === "history",
  });
  const changes = Object.values(drafts).filter(
    (c) => Array.isArray(c.after) && Array.isArray(c.before),
  );
  const save = useMutation({
    mutationFn: async () => {
      const result = await api<{ id: string }>("proposals/save", {
        requestId,
        title,
        changes,
      });
      if (submit === "submit") {
        const saved = await api<{ proposal: Proposal }>(
          `proposals/${result.id}`,
        );
        await api("proposals/transition", {
          id: result.id,
          revision: saved.proposal.revision,
          action: "submit",
        });
      }
      return result;
    },
    onSuccess: (r) => {
      clearDrafts();
      setSubmit(null);
      qc.invalidateQueries({ queryKey: ["proposals"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      navigate({ to: "/navrhy", search: { id: r.id } });
    },
  });
  function update(unit: Unit, parts: string[]) {
    setDrafts((old) => {
      const next = { ...old };
      if (JSON.stringify(parts) === JSON.stringify(unit.value))
        delete next[unit.id];
      else
        next[unit.id] = {
          unitId: unit.id,
          baseRevision: old[unit.id]?.baseRevision ?? unit.revision,
          before: old[unit.id]?.before ?? unit.value,
          after: parts,
        };
      return next;
    });
  }
  function prepare(mode: "draft" | "submit") {
    setTitle(currentDoc ? `Úpravy: ${currentDoc.title}` : "Úpravy překladu");
    setRequestId(crypto.randomUUID());
    save.reset();
    setSubmit(mode);
  }
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (changes.length) prepare("draft");
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [changes.length, currentDoc?.title]);
  useEffect(() => {
    if (submit) dialog.current?.showModal();
    else dialog.current?.close();
  }, [submit]);
  return (
    <div className="editor-layout">
      <aside className="book-rail">
        <h2>Obsah</h2>
        <label className="search">
          <Search size={17} />
          <input
            aria-label="Hledat ve všech textech"
            placeholder="Hledat v textech"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <nav aria-label="Dokumenty">
          <ul className="document-list">
            {books.data?.books.map((b) => (
              <li key={b.id}>
                <button
                  aria-current={b.id === selectedBook ? "page" : undefined}
                  onClick={() => {
                    setBook(b.id);
                    setSearch("");
                    setSelected(null);
                    setOffset(0);
                  }}
                >
                  {b.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <Notice error={books.error} />
        {who.role === "admin" ? (
          <Link to="/import" className="rail-upload">
            <Upload size={16} />
            Nahrajte export
          </Link>
        ) : null}
      </aside>
      <main className="manuscript">
        <header className="editor-heading">
          <button
            className="context-toggle"
            aria-expanded={contextOpen}
            aria-controls="context-rail"
            onClick={() => setContextOpen((v) => !v)}
          >
            Kontext a diskuse
          </button>
          <span className="breadcrumb">
            {search
              ? "Výsledky ve všech dokumentech"
              : currentDoc?.title || "Redakce"}
          </span>
          <h1>
            {search
              ? "Výsledky hledání"
              : currentDoc?.title ||
                (initial.all
                  ? "Všechny dokumenty"
                  : "Překlad čeká na své čtenáře.")}
          </h1>
          <div className="filters">
            {[
              ["all", "Všechny oddíly"],
              ["pending", "K opravě"],
              ["reviewed", "Ověřené"],
            ].map(([id, label]) => (
              <button
                key={id}
                className={filter === id ? "active" : ""}
                aria-pressed={filter === id}
                onClick={() => {
                  setFilter(id);
                  setOffset(0);
                }}
              >
                {label}
              </button>
            ))}
            <button
              className="icon-button"
              title="Obnovit texty"
              aria-label="Obnovit texty"
              onClick={() => {
                rows.refetch();
                books.refetch();
              }}
            >
              <RotateCcw size={16} />
            </button>
          </div>
        </header>
        <Notice error={storageError || rows.error} />
        <div className="column-labels">
          <span>ORIGINÁL</span>
          <span>ČESKÝ PŘEKLAD</span>
        </div>
        <div className="translation-rows">
          {rows.data?.rows.map((unit, index) => {
            const change = drafts[unit.id],
              parts = change?.after ?? unit.value;
            return (
              <section
                className={`translation-row ${active?.id === unit.id ? "is-selected" : ""}`}
                key={unit.id}
                onFocus={() => setSelected(unit.id)}
                onClick={() => setSelected(unit.id)}
              >
                <span className="row-number">
                  {String(offset + index + 1).padStart(2, "0")}
                </span>
                <div className="source-text">
                  {search ? (
                    <small className="result-location">
                      {unit.document_title} / {unit.label}
                    </small>
                  ) : null}
                  {unit.source.map((p, i) => (
                    <TextPart
                      key={i}
                      value={p}
                      showReferences={false}
                      label={`Originál ${offset + index + 1}.${i + 1}`}
                    />
                  ))}
                </div>
                <div className="target-text">
                  {parts.map((part, i) => (
                    <TextPart
                      key={i}
                      value={part}
                      showReferences={false}
                      label={`Překlad ${offset + index + 1}.${i + 1}`}
                      onChange={(value) =>
                        update(
                          unit,
                          parts.map((p, j) => (i === j ? value : p)),
                        )
                      }
                    />
                  ))}
                </div>
                <RowReferences
                  source={unit.source}
                  target={parts}
                  row={offset + index + 1}
                  onChange={(value) => update(unit, value)}
                />
                <div className="row-status">
                  {change ? (
                    <>
                      <span>
                        Koncept
                        {change.baseRevision !== unit.revision
                          ? " · aktuální text se změnil"
                          : ""}
                      </span>
                      <button
                        className="text-button"
                        onClick={() =>
                          setDrafts((old) => {
                            const next = { ...old };
                            delete next[unit.id];
                            return next;
                          })
                        }
                      >
                        Zahodit opravu
                      </button>
                    </>
                  ) : unit.approval ? (
                    <span className="verified">
                      <Check size={13} />
                      Ověřeno
                    </span>
                  ) : (
                    <>
                      <span>Čeká na kontrolu</span>
                      <button
                        className="text-button"
                        onClick={() =>
                          setDrafts((old) => ({
                            ...old,
                            [unit.id]: {
                              unitId: unit.id,
                              baseRevision: unit.revision,
                              before: unit.value,
                              after: unit.value,
                            },
                          }))
                        }
                      >
                        Zahrnout ke kontrole
                      </button>
                    </>
                  )}
                </div>
              </section>
            );
          })}
        </div>
        {rows.isPending && !!books.data?.books.length ? (
          <p>Načítám oddíly…</p>
        ) : null}
        {books.data?.books.length === 0 && !books.isPending ? (
          <div className="empty">
            <BookOpen size={28} />
            <p>Správce může začít nahráním exportu z Foundry.</p>
          </div>
        ) : rows.data?.total === 0 ? (
          <p className="empty">Žádné odpovídající oddíly.</p>
        ) : null}
        {(rows.data?.total ?? 0) > 60 ? (
          <div className="pagination">
            <button
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 60))}
            >
              <ChevronLeft size={16} />
              Předchozí
            </button>
            <span>
              {offset + 1}–{Math.min(offset + 60, rows.data!.total)} /{" "}
              {rows.data!.total}
            </span>
            <button
              disabled={offset + 60 >= rows.data!.total}
              onClick={() => setOffset(offset + 60)}
            >
              Další
              <ChevronRight size={16} />
            </button>
          </div>
        ) : null}
      </main>
      <aside
        id="context-rail"
        className={`context-rail ${contextOpen ? "is-open" : ""}`}
      >
        <button
          className="context-toggle"
          onClick={() => setContextOpen(false)}
        >
          Zavřít kontext
        </button>
        <div
          className="context-tabs"
          role="tablist"
          aria-label="Kontext oddílu"
        >
          {[
            ["context", "Kontext"],
            ["discussion", "Diskuse"],
            ["history", "Historie"],
          ].map(([id, label]) => (
            <button
              role="tab"
              aria-selected={side === id}
              key={id}
              onClick={() => setSide(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {side === "context" ? (
          <>
            <h2>
              <BookOpen size={19} />
              Glosář
            </h2>
            <dl className="terms">
              {glossary.data?.entries
                .filter((t) =>
                  active?.source
                    .join(" ")
                    .toLowerCase()
                    .includes(t.source.toLowerCase()),
                )
                .slice(0, 12)
                .map((t) => (
                  <div key={t.source}>
                    <dt>{t.source}</dt>
                    <dd>{t.replacement}</dd>
                  </div>
                ))}
            </dl>
            {!glossary.data?.entries.some((t) =>
              active?.source
                .join(" ")
                .toLowerCase()
                .includes(t.source.toLowerCase()),
            ) ? (
              <p className="muted">V tomto oddílu není shoda s glosářem.</p>
            ) : null}
            <h2>
              <FileText size={18} />
              Další výskyty
            </h2>
            <p className="muted">
              Označte název nebo ho napište do hledání vlevo.
            </p>
            <div className="protected-note">
              <LockKeyhole size={20} />
              <span>Odkazy jsou chráněné</span>
              <Help>
                Upravovat lze text a zobrazené názvy odkazů. UUID, příkazy,
                makra a strukturu dokumentu kontroluje stejný validátor jako ve
                Foundry.
              </Help>
            </div>
          </>
        ) : side === "discussion" ? (
          <>
            <h2>Návrhy k oddílu</h2>
            {proposals.data?.proposals
              .filter((p) => p.changes.some((c) => c.unitId === active?.id))
              .map((p) => (
                <a
                  className="context-link"
                  key={p.id}
                  href={`/navrhy?id=${p.id}`}
                >
                  {p.title}
                </a>
              ))}
            <p className="muted">
              Diskuse patří k návrhu opravy, aby měla souvislosti.
            </p>
            <Notice error={proposals.error} />
          </>
        ) : (
          <>
            <h2>Poslední změny</h2>
            {history.data?.events.slice(0, 12).map((e, i) => (
              <div className="history-entry" key={i}>
                <strong>{e.author}</strong>
                <span>{e.action}</span>
                <small>{new Date(e.at).toLocaleString("cs-CZ")}</small>
              </div>
            ))}
            <Notice error={history.error} />
          </>
        )}
      </aside>
      <footer className="editor-footer">
        <div>
          <Check size={19} />
          <span>
            <strong>
              {changes.length
                ? `Oddíly v návrhu: ${changes.length}`
                : "Vše připraveno ke čtení"}
            </strong>
            <small>
              {storageError
                ? "Koncept není uložený v prohlížeči"
                : "Koncepty se průběžně ukládají v tomto prohlížeči."}
            </small>
          </span>
        </div>
        <div>
          <button disabled={!changes.length} onClick={() => prepare("draft")}>
            Uložit návrh
          </button>
          <button
            className="primary"
            disabled={!changes.length}
            onClick={() => prepare("submit")}
          >
            Odeslat ke kontrole
          </button>
        </div>
      </footer>
      <dialog
        ref={dialog}
        onCancel={(e) => {
          if (save.isPending) e.preventDefault();
          else setSubmit(null);
        }}
        aria-labelledby="proposal-title"
        className="modal"
      >
        <h2 id="proposal-title">
          {submit === "submit" ? "Odeslat opravy ke kontrole" : "Uložit návrh"}
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <label>
            Název sady oprav
            <input
              autoFocus
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <p>
            Počet oddílů: {changes.length}. Aktuální společný překlad se změní
            až po schválení a sloučení.
          </p>
          <Notice error={save.error} />
          <div className="actions">
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => setSubmit(null)}
            >
              Zpět do editoru
            </button>
            <button className="primary" disabled={save.isPending}>
              {save.isPending
                ? "Ukládám…"
                : submit === "submit"
                  ? "Odeslat ke kontrole"
                  : "Uložit návrh"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
