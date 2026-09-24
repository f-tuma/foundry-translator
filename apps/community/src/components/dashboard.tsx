import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, RefreshCw } from "lucide-react";
import { api, useSession } from "../api";
import type { Proposal, Release } from "../shared";
import { Help, Notice } from "./shell";
interface Overview {
  at: string;
  totals: { units: number; reviewed: number; unknown: number };
  documents: {
    id: string;
    title: string;
    units: number;
    reviewed: number;
    unknown: number;
    open_proposals: number;
    updated_at: string | null;
  }[];
  glossary: { total: number; reviewed: number; open_proposals: number };
  proposals: Record<Proposal["status"], number>;
  work: {
    id: string;
    title: string;
    status: Proposal["status"];
    author_name: string;
    mine: boolean;
    updated_at: string;
    units: number;
  }[];
  activity: {
    action: string;
    id: string;
    title: string;
    author: string;
    at: string;
  }[];
  latest_release: Release | null;
}
const number = (v: number) => v.toLocaleString("cs-CZ");
const date = (v: string) =>
  new Date(v).toLocaleString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const status: Record<Proposal["status"], string> = {
  draft: "Koncept",
  submitted: "Ke schválení",
  approved: "Čeká na sloučení",
  merged: "Sloučeno",
  rejected: "Zamítnuto",
};
const events: Record<string, string> = {
  "proposal.save": "Návrh uložen",
  "proposal.submit": "Předáno ke kontrole",
  "proposal.approve": "Návrh schválen",
  "proposal.merge": "Opravy sloučeny",
  "proposal.reject": "Návrh zamítnut",
  "proposal.rebase": "Základ návrhu aktualizován",
};
function Progress({
  value,
  total,
  label,
}: {
  value: number;
  total: number;
  label: string;
}) {
  return <progress aria-label={label} max={Math.max(1, total)} value={value} />;
}
export function Dashboard() {
  const member = useSession().data!.member!;
  const query = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<Overview>("dashboard"),
    refetchInterval: 30000,
  });
  const d = query.data;
  const percent =
    d && d.totals.units
      ? Math.floor((100 * d.totals.reviewed) / d.totals.units)
      : 0;
  return (
    <main className="page dashboard">
      <div className="section-heading">
        <div>
          <h1>Přehled redakce</h1>
          <p className="muted">Český Ember, krok za krokem.</p>
        </div>
        <div className="actions">
          <button
            className="icon-button"
            aria-label="Obnovit přehled"
            disabled={query.isFetching}
            onClick={() => query.refetch()}
          >
            <RefreshCw size={18} />
          </button>
          <Link className="button primary" to="/editor">
            Otevřít editor <ArrowRight size={17} />
          </Link>
        </div>
      </div>
      <Notice error={query.error} />
      {query.isPending ? (
        <p role="status">Načítám stav redakce…</p>
      ) : !d ? null : (
        <>
          <section className="overview-band" aria-label="Stav překladu">
            <div className="overview-progress">
              <h2>
                Ověření textů{" "}
                <Help>
                  Počítáme oddíly aktuálního překladu. Oddíl je ověřený, až když
                  jsou ověřené všechny jeho části. Schválený návrh začne ověření
                  ovlivňovat až po sloučení. Glosář se počítá samostatně.
                </Help>
              </h2>
              <div>
                <strong>
                  {number(d.totals.reviewed)} / {number(d.totals.units)}
                </strong>
                <span>oddílů ověřeno</span>
              </div>
              <div className="progress-line">
                <Progress
                  value={d.totals.reviewed}
                  total={d.totals.units}
                  label="Ověřené oddíly"
                />
                <span>{percent} %</span>
              </div>
            </div>
            <Link
              className="overview-stat"
              to="/editor"
              search={{ state: "pending", all: true }}
            >
              <strong>
                {number(d.totals.units - d.totals.reviewed - d.totals.unknown)}
              </strong>
              <span>Čeká na kontrolu</span>
            </Link>
            <Link
              className="overview-stat"
              to="/navrhy"
              search={{ state: "submitted" }}
            >
              <strong>{number(d.proposals.submitted)}</strong>
              <span>Návrhy ke schválení</span>
            </Link>
            <Link
              className="overview-stat"
              to="/navrhy"
              search={{ state: "approved" }}
            >
              <strong>{number(d.proposals.approved)}</strong>
              <span>Schválené návrhy</span>
            </Link>
          </section>
          {d.totals.unknown ? (
            <p className="notice warning">
              U {number(d.totals.unknown)} oddílů zatím nelze ověřit stav.
              Probíhá import nebo se změnilo mapování originálu; nezapočítávají
              se jako ověřené ani jako připravené ke kontrole.
            </p>
          ) : null}
          <div className="overview-layout">
            <div>
              <section>
                <div className="section-heading">
                  <h2>
                    Dokumenty{" "}
                    <Help>
                      Otevřete dokument a pokračujte v kontrole. Počty zahrnují
                      jen dokumenty, ke kterým máte přístup. Rozpracované
                      koncepty v cizích prohlížečích nejsou součástí přehledu.
                    </Help>
                  </h2>
                </div>
                {d.documents.length ? (
                  <div className="overview-documents">
                    <div className="overview-document-head">
                      <span>Dokument</span>
                      <span>Ověřeno</span>
                      <span>Otevřené návrhy</span>
                      <span />
                    </div>
                    {d.documents.map((doc) => (
                      <Link
                        className="overview-document"
                        key={doc.id}
                        to="/editor"
                        search={{ book: doc.id }}
                      >
                        <div>
                          <h3>{doc.title}</h3>
                          <small>
                            Oddíly: {number(doc.units)}
                            {doc.unknown ? " · Stav vyžaduje kontrolu" : ""}
                          </small>
                        </div>
                        <div className="document-progress">
                          <Progress
                            value={doc.reviewed}
                            total={doc.units}
                            label={`${doc.title}: ověřené oddíly`}
                          />
                          <span>
                            {number(doc.reviewed)} / {number(doc.units)}
                          </span>
                        </div>
                        <span className="document-proposals">
                          <span>Otevřené návrhy: </span>
                          {doc.open_proposals}
                        </span>
                        <ArrowRight size={17} />
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="empty">
                    <h3>Prostor pro první překlad.</h3>
                    <p>
                      {member.role === "admin"
                        ? "Nahrajte export z Foundry a můžete začít společně kontrolovat."
                        : "Jakmile správce nahraje export, objeví se tu dokumenty ke kontrole."}
                    </p>
                    {member.role === "admin" ? (
                      <Link to="/import" className="button">
                        Nahrát export
                      </Link>
                    ) : null}
                  </div>
                )}
                <Link className="overview-glossary" to="/glosar">
                  <div>
                    <h3>Společný glosář</h3>
                    <small>
                      Hesla: {number(d.glossary.total)} · ověřeno:{" "}
                      {number(d.glossary.reviewed)}
                      {d.glossary.open_proposals
                        ? ` · otevřené návrhy: ${d.glossary.open_proposals}`
                        : ""}
                    </small>
                  </div>
                  <span>
                    Upravit glosář <ArrowRight size={16} />
                  </span>
                </Link>
              </section>
              <section className="overview-work">
                <div className="section-heading">
                  <h2>Na čem se pracuje</h2>
                  <Link to="/navrhy" className="text-link">
                    Všechny návrhy <ArrowRight size={15} />
                  </Link>
                </div>
                {d.work.length ? (
                  d.work.map((p) => (
                    <Link
                      key={p.id}
                      to="/navrhy"
                      search={{ id: p.id }}
                      className="overview-work-row"
                    >
                      <div>
                        <h3>{p.title}</h3>
                        <small>
                          {p.author_name}
                          {p.mine ? " · váš návrh" : ""} · {date(p.updated_at)}
                        </small>
                      </div>
                      <span
                        className={
                          p.status === "approved" ? "verified-label" : "muted"
                        }
                      >
                        {status[p.status]}
                      </span>
                    </Link>
                  ))
                ) : (
                  <p className="muted">
                    Žádné otevřené návrhy. Novou opravu můžete připravit v
                    editoru nebo glosáři.
                  </p>
                )}
              </section>
            </div>
            <aside className="overview-rail" aria-label="Aktivita redakce">
              <section>
                <h2>Poslední změny</h2>
                {d.activity.length ? (
                  <ol className="overview-activity">
                    {d.activity.map((e, i) => (
                      <li key={`${e.id}-${e.at}-${i}`}>
                        <strong>
                          {events[e.action] || "Návrh aktualizován"}
                        </strong>
                        <Link to="/navrhy" search={{ id: e.id }}>
                          {e.title}
                        </Link>
                        <small>
                          {e.author} · {date(e.at)}
                        </small>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="muted">Zatím žádné změny návrhů.</p>
                )}
              </section>
              <section className="overview-release">
                <h2>Poslední vydání</h2>
                {d.latest_release ? (
                  <>
                    <h3>{d.latest_release.title}</h3>
                    <p className="muted">
                      {new Date(d.latest_release.created_at).toLocaleDateString(
                        "cs-CZ",
                      )}
                    </p>
                  </>
                ) : (
                  <p className="muted">První vydání připravujeme.</p>
                )}
                <Link to="/vydani" className="text-link">
                  Zobrazit vydání <ArrowRight size={16} />
                </Link>
              </section>
            </aside>
          </div>
          <p className="overview-updated muted">
            Stav k {date(d.at)} · přehled se průběžně obnovuje.
          </p>
        </>
      )}
    </main>
  );
}
