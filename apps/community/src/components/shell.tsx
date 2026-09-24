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
  const account = session.data?.account;
  return (
    <>
      <header className="site-header">
        <Link to="/" className="wordmark">
          Ember<span>/</span>
          <small>Český překlad</small>
        </Link>
        <nav aria-label="Hlavní navigace">
          <Link to="/prehled">Přehled</Link>
          <Link to="/editor">Editor</Link>
          <Link to="/navrhy">Návrhy</Link>
          <Link to="/glosar">Glosář</Link>
          <Link to="/vydani">Vydání</Link>
        </nav>
        <div className="header-actions">
          <ThemeControl />
          {account ? (
            <details className="account">
              <summary aria-label={`Účet: ${account.name}`}>
                <UserRound size={17} />
                <span className="account-name">{account.name}</span>
              </summary>
              <div>
                <Link to="/ucet">Můj účet</Link>
                {member?.role === "admin" ? (
                  <>
                    <Link to="/import">Nahrát export</Link>
                    <a href="/weblate/access/ember-cs/">
                      Správa členů a pozvánek <ArrowUpRight size={14} />
                    </a>
                    <a href="/weblate/projects/ember-cs/">
                      Technická administrace <ArrowUpRight size={14} />
                    </a>
                  </>
                ) : null}
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
              href="/weblate/accounts/login/?next=/prehled"
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
                {session.data?.accessMessage ||
                  (session.error
                    ? message(session.error)
                    : "Vstup pro pozvané překladatele a reviewery.")}
              </p>
              {account ? (
                <Link to="/ucet" className="button primary">
                  Můj účet
                </Link>
              ) : (
                <a
                  className="button primary"
                  href="/weblate/accounts/login/?next=/prehled"
                >
                  Přihlásit se
                </a>
              )}
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
