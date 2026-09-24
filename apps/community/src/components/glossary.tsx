import { Fragment, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Search, Pencil, Check } from "lucide-react";
import { api, useSession } from "../api";
import type { Unit } from "../shared";
import { Help, Notice } from "./shell";
import { categories, GlossaryFields } from "./glossary-fields";
export interface Term {
  source: string;
  replacement: string;
  category: string;
  mode?: string;
  enabled?: boolean;
  notes?: string;
  aliases: string[];
}
export function useGlossary() {
  return useQuery({
    queryKey: ["glossary"],
    queryFn: () => api<{ entries: Term[]; rows: Unit[] }>("glossary"),
  });
}
export function Glossary() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const data = useGlossary();
  const rows =
    data.data?.entries
      .map((term, i) => ({ term, row: data.data!.rows[i] }))
      .filter(({ term }) =>
        `${term.source} ${term.replacement} ${term.aliases.join(" ")}`
          .toLocaleLowerCase("cs")
          .includes(search.toLocaleLowerCase("cs")),
      ) ?? [];
  return (
    <main className="page glossary-page">
      <div className="section-heading">
        <div>
          <h1>Společný glosář</h1>
          <p className="muted">Jedno jméno. Stejný svět.</p>
        </div>
        <Help>
          Upravit otevře návrh opravy hesla. Jiný kontrolor jej schválí a
          sloučí. Hotové texty se automaticky nepřepisují; jejich výskyty lze
          vyhledat v editoru. Poznámky zůstávají soukromé. Vypnuté heslo se při
          překladu nepoužívá.
        </Help>
      </div>
      <label className="search">
        <Search size={17} />
        <input
          aria-label="Hledat v glosáři"
          placeholder="Hledat název nebo jeho překlad…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <Notice error={data.error} />
      {data.isPending ? <p role="status">Načítám glosář…</p> : null}
      <table className="glossary-table">
        <thead>
          <tr>
            <th>Originál</th>
            <th>Český název</th>
            <th>Použití</th>
            <th>
              <span className="sr-only">Úpravy</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ term: t, row }) => (
            <Fragment key={row.id}>
              <tr className={selected === row.id ? "is-editing" : ""}>
                <td>
                  {t.source}
                  <small className="term-category">
                    {categories[t.category]}
                  </small>
                </td>
                <td>
                  {t.replacement}
                  {row.approval ? (
                    <small className="term-reviewed">
                      <Check size={13} /> Ověřeno
                    </small>
                  ) : null}
                </td>
                <td>
                  {t.enabled === false
                    ? "Vypnuto"
                    : t.mode === "inflect"
                      ? "Lze skloňovat"
                      : "Přesný tvar"}
                </td>
                <td>
                  <button
                    className="text-button"
                    aria-label={`Upravit heslo ${t.source}`}
                    aria-expanded={selected === row.id}
                    onClick={() =>
                      setSelected(selected === row.id ? "" : row.id)
                    }
                  >
                    <Pencil size={14} />
                    Upravit
                  </button>
                </td>
              </tr>
              {selected === row.id ? (
                <tr>
                  <td colSpan={4} className="glossary-edit-cell">
                    <GlossaryEdit
                      key={row.id}
                      row={row}
                      onClose={() => setSelected("")}
                    />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
      {!rows.length && !data.isPending && !data.error ? (
        <p className="empty">
          {data.data?.entries.length
            ? "Žádná odpovídající hesla."
            : "Glosář zatím neobsahuje hesla. Správce je nahraje spolu s exportem projektu."}
        </p>
      ) : null}
    </main>
  );
}
function GlossaryEdit({ row, onClose }: { row: Unit; onClose: () => void }) {
  const user = useSession().data!.member!;
  const qc = useQueryClient(),
    navigate = useNavigate();
  const key = `ember.glossary-draft.v1.${user.id}.${row.id}`;
  type Draft = {
    before: string[];
    after: string[];
    revision: string;
    requestId: string;
  };
  const fresh = (): Draft => ({
    before: row.value,
    after: row.value,
    revision: row.revision,
    requestId: crypto.randomUUID(),
  });
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const d = JSON.parse(localStorage.getItem(key) || "null");
      if (
        d &&
        typeof d.revision === "string" &&
        typeof d.requestId === "string" &&
        [d.before, d.after].every(
          (a) =>
            Array.isArray(a) &&
            a.length === 6 &&
            a.every((v) => typeof v === "string"),
        )
      )
        return d;
    } catch {
      /* Corrupt local storage cannot replace server data. */
    }
    return fresh();
  });
  const [storageError, setStorageError] = useState("");
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(draft));
      setStorageError("");
    } catch {
      setStorageError(
        "Koncept se neuložil do prohlížeče. Před odchodem uložte návrh na server.",
      );
    }
  }, [key, draft]);
  const save = useMutation({
    mutationFn: () =>
      api<{ id: string }>("proposals/save", {
        requestId: draft.requestId,
        title: `Glosář: ${row.label}`.slice(0, 200),
        changes: [
          {
            unitId: row.id,
            baseRevision: draft.revision,
            before: draft.before,
            after: draft.after,
          },
        ],
      }),
    onSuccess: (r) => {
      try {
        localStorage.removeItem(key);
      } catch {}
      qc.invalidateQueries({ queryKey: ["proposals"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      navigate({ to: "/navrhy", search: { id: r.id } });
    },
  });
  const stale = draft.revision !== row.revision;
  return (
    <form
      className="glossary-edit"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="section-heading">
        <h2>{row.label}</h2>
        <Help>
          Originál je identita hesla. Alternativní názvy jsou další podoby
          originálu, ne české skloňované tvary. Český název pište v základním
          tvaru. Uložení návrhu ještě nemění společný glosář.
        </Help>
      </div>
      {stale ? (
        <div className="notice warning">
          <p>
            Heslo se mezitím změnilo. Váš koncept zůstal zachovaný; porovnejte
            ho s aktuálními hodnotami.
          </p>
          <dl>
            {row.value.map((v, i) => (
              <Fragment key={i}>
                <dt>
                  {
                    [
                      "Český název",
                      "Kategorie",
                      "Použití",
                      "Poznámka",
                      "Alternativní názvy",
                      "Stav",
                    ][i]
                  }
                </dt>
                <dd>{v || "—"}</dd>
              </Fragment>
            ))}
          </dl>
          <button
            type="button"
            onClick={() =>
              setDraft({
                ...draft,
                before: row.value,
                revision: row.revision,
                requestId: crypto.randomUUID(),
              })
            }
          >
            Porovnáno, použít aktuální základ
          </button>
        </div>
      ) : null}
      <GlossaryFields
        values={draft.after}
        disabled={save.isPending}
        onChange={(after) =>
          setDraft({ ...draft, after, requestId: crypto.randomUUID() })
        }
      />
      <Notice error={storageError || save.error} />
      <div className="glossary-edit-footer">
        <div className="actions">
          <button className="primary" disabled={save.isPending || stale}>
            {save.isPending ? "Ukládám…" : "Uložit návrh"}
          </button>
          <button type="button" disabled={save.isPending} onClick={onClose}>
            Zavřít
          </button>
        </div>
        <Link className="text-link" to="/editor" search={{ q: row.label }}>
          Výskyty originálu
        </Link>
        <Link className="text-link" to="/editor" search={{ q: row.value[0] }}>
          Výskyty překladu
        </Link>
      </div>
      <small className="muted">
        Rozpracovaná oprava zůstává v tomto prohlížeči. Schválení a sloučení
        proběhne v návrzích.
      </small>
    </form>
  );
}
