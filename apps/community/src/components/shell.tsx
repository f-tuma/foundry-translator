import { Link } from "@tanstack/react-router";
import { BookOpen, LogIn, UserRound, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { useSession, message } from "../api";
import { ThemeControl } from "./theme";
export { Help } from "./help";
export function Notice({ error }: { error: unknown }) {
  return error ? (
    <div className="notice error" role="alert">
      {message(error)}
    </div>
  ) : null;
}
export function Shell({
  children,
  privatePage = false,
}: {
  children: ReactNode;
  privatePage?: boolean;
}) {
  const session = useSession();
  const member = session.data?.member;
  return (
    <>
      <header className="site-header">
        <Link to="/" className="wordmark">
          Ember<span>/</span>
          <small>Český překlad</small>
        </Link>
        <nav aria-label="Hlavní navigace">
          <Link to="/editor">Editor</Link>
          <Link to="/navrhy">Návrhy</Link>
          <Link to="/glosar">Glosář</Link>
          <Link to="/vydani">Vydání</Link>
        </nav>
        <div className="header-actions">
          <ThemeControl />
          {member ? (
            <details className="account">
              <summary aria-label={`Účet: ${member.name}`}>
                <UserRound size={17} />
                <span className="account-name">{member.name}</span>
              </summary>
              <div>
                <a href="/weblate/accounts/profile/">
                  Účet ve Weblate <ArrowUpRight size={14} />
                </a>
                {member.role === "admin" ? (
                  <>
                    <a href="/weblate/access/ember-cs/">Členové a pozvánky</a>
                    <Link to="/import">Nahrát export</Link>
                  </>
                ) : null}
                <a href="/weblate/projects/ember-cs/">Otevřít Weblate</a>
                <form method="post" action="/weblate/accounts/logout/">
                  <input
                    type="hidden"
                    name="csrfmiddlewaretoken"
                    value={session.data?.csrf || ""}
                  />
                  <button className="text-button" type="submit">
                    Odhlásit se
                  </button>
                </form>
              </div>
            </details>
          ) : (
            <a
              className="button quiet"
              href="/weblate/accounts/login/?next=/editor"
            >
              <LogIn size={16} />
              Přihlásit se
            </a>
          )}
        </div>
      </header>
      {privatePage && !member ? (
        <main className="gate">
          <BookOpen size={32} />
          <h1>Vítejte v redakci.</h1>
          <p>Společné místo pro pečlivý český překlad Emberu.</p>
          {session.isPending ? (
            <p>Ověřuji přístup…</p>
          ) : (
            <>
              <p>
                {session.error
                  ? message(session.error)
                  : "Vstup pro pozvané překladatele a reviewery."}
              </p>
              <a
                className="button primary"
                href="/weblate/accounts/login/?next=/editor"
              >
                Přihlásit přes Weblate
              </a>
              <Link to="/vydani">Prohlédnout veřejná vydání</Link>
            </>
          )}
        </main>
      ) : (
        children
      )}
    </>
  );
}
