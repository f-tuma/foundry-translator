import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ArrowRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { api, BRIDGE, useSession } from "../api";
import { Shell, Notice, Help } from "./shell";
import type { Release } from "../shared";
export function Releases() {
  const releases = useQuery({
    queryKey: ["releases"],
    queryFn: () => api<{ releases: Release[] }>("releases"),
  });
  const member = useSession().data?.member;
  const qc = useQueryClient();
  const [form, setForm] = useState(false),
    [id, setId] = useState(""),
    [title, setTitle] = useState(""),
    [notes, setNotes] = useState("");
  const publish = useMutation({
    mutationFn: () => api("publish", { id, title, notes }),
    onSuccess: () => {
      setForm(false);
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["releases"] });
    },
  });
  return (
    <Shell>
      <main className="public-page">
        <section className="public-intro">
          <h1>
            Ember.
            <br />
            <em>Společně, česky.</em>
          </h1>
          <div>
            <p>Komunitní překlad, který roste s každou pečlivou opravou.</p>
            <p>
              Stáhněte si vydání a importujte ho do Foundry Translate.
              Originální obsah Emberu zůstává ve vašem světě.
            </p>
            <Link className="text-link" to="/prehled">
              Vstoupit do redakce <ArrowRight size={17} />
            </Link>
          </div>
        </section>
        <section className="release-list">
          <div className="section-heading">
            <h2>Vydání ke stažení</h2>
            {member?.role === "admin" ? (
              <button onClick={() => setForm(!form)}>Připravit vydání</button>
            ) : null}
          </div>
          <Notice error={releases.error} />
          {form ? (
            <form
              className="publish-form"
              onSubmit={(e) => {
                e.preventDefault();
                publish.mutate();
              }}
            >
              <h3>
                Nové veřejné vydání{" "}
                <Help>
                  Publikuje aktuální sloučené překlady. Rozpracované návrhy ani
                  originály se nestahují. Neschválené výchozí překlady budou
                  zahrnuté bez označení ověřeno.
                </Help>
              </h3>
              <label>
                Označení
                <input
                  required
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  placeholder="2026.09.1"
                  pattern="[a-z0-9][a-z0-9._\-]{0,79}"
                />
              </label>
              <label>
                Název
                <input
                  required
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                Co se změnilo
                <textarea
                  value={notes}
                  maxLength={8000}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <Notice error={publish.error} />
              <button className="primary" disabled={publish.isPending}>
                Zveřejnit vydání
              </button>
            </form>
          ) : null}
          {releases.isPending ? (
            <p>Načítám vydání…</p>
          ) : releases.data?.releases.length ? (
            releases.data.releases.map((r, i) => (
              <article className="release-row" key={r.id}>
                <div className="release-number">
                  {r.id}
                  <small>
                    {new Date(r.created_at).toLocaleDateString("cs-CZ")}
                  </small>
                </div>
                <div>
                  <h3>{r.title}</h3>
                  <p className="pre-line">{r.notes}</p>
                  <small>
                    Dokumenty: {r.document_count} · Ověřené oddíly:{" "}
                    {r.reviewed_count} / {r.unit_count}
                  </small>
                </div>
                <a
                  className={`button ${i === 0 ? "primary" : ""}`}
                  href={`${BRIDGE}/download/${encodeURIComponent(r.id)}`}
                >
                  <Download size={16} />
                  Stáhnout JSON
                </a>
              </article>
            ))
          ) : (
            <div className="empty">
              <h3>První vydání připravujeme.</h3>
              <p>Jakmile redakce zveřejní překlad, najdete ho tady.</p>
            </div>
          )}
        </section>
        <footer className="public-footer">
          <span>Komunitní projekt · Foundry Translate</span>
          <a
            href="https://github.com/f-tuma/foundry-translator"
            target="_blank"
            rel="noreferrer"
          >
            Zdrojový kód
          </a>
        </footer>
      </main>
    </Shell>
  );
}
