import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { api, ApiError, useSession } from "../api";
import type { Account, Session } from "../shared";
import { Help, Notice } from "./shell";

export function AccountPage() {
  const session = useSession();
  if (!session.data)
    return (
      <main className="gate">
        <h1>Můj účet</h1>
        {session.isPending ? (
          <p>Načítám účet…</p>
        ) : (
          <>
            <Notice error={session.error} />
            <a
              className="button primary"
              href="/weblate/accounts/login/?next=/ucet"
            >
              Přihlásit se
            </a>
          </>
        )}
      </main>
    );
  return <AccountForm key={session.data.account.id} session={session.data} />;
}

function AccountForm({ session }: { session: Session }) {
  const client = useQueryClient();
  const [saved, setSaved] = useState(session.account);
  const [draft, setDraft] = useState(session.account);
  const mutation = useMutation({
    mutationFn: () =>
      api<{ account: Account }>("account", {
        revision: saved.revision,
        username: draft.username,
        full_name: draft.full_name,
        email: draft.email,
      }),
    onSuccess: ({ account }) => {
      setSaved(account);
      setDraft(account);
      client.setQueryData<Session>(
        ["session"],
        (current) =>
          current && {
            ...current,
            account,
            member: current.member && {
              ...current.member,
              name: account.name,
              email: account.email,
            },
          },
      );
    },
  });
  const fieldErrors =
    mutation.error instanceof ApiError
      ? (mutation.error.details as
          Record<string, { message: string }[]> | undefined)
      : undefined;
  const changed = ["username", "full_name", "email"].some(
    (key) => draft[key as keyof Account] !== saved[key as keyof Account],
  );
  const change = (key: "username" | "full_name" | "email", value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    mutation.reset();
  };
  const error = (key: string) =>
    fieldErrors?.[key]?.map((e) => e.message).join(" ");
  return (
    <main className="page account-page">
      <header className="page-heading">
        <p className="eyebrow">Redakce / Účet</p>
        <h1>Můj účet</h1>
        <p className="muted">Jak vás ostatní znají a jak se přihlašujete.</p>
      </header>
      <section className="account-section" aria-labelledby="profile-heading">
        <div className="account-section-intro">
          <h2 id="profile-heading">Profil</h2>
          <p className="muted">
            Jméno se zobrazuje u vašich návrhů a v historii změn.
          </p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <fieldset disabled={mutation.isPending}>
            <label>
              Zobrazované jméno
              <input
                autoComplete="name"
                value={draft.full_name}
                onChange={(e) => change("full_name", e.target.value)}
                aria-invalid={!!error("full_name")}
                aria-describedby="name-error"
              />
            </label>
            <small className="field-error" id="name-error">
              {error("full_name")}
            </small>
            <label>
              Uživatelské jméno
              <input
                autoComplete="username"
                required
                value={draft.username}
                onChange={(e) => change("username", e.target.value)}
                aria-invalid={!!error("username")}
                aria-describedby="username-error"
              />
            </label>
            <small className="field-error" id="username-error">
              {error("username")}
            </small>
            <label>
              E-mail
              <select
                value={draft.email}
                onChange={(e) => change("email", e.target.value)}
                aria-invalid={!!error("email")}
                aria-describedby="email-error"
              >
                {saved.emails.map((email) => (
                  <option key={email}>{email}</option>
                ))}
              </select>
            </label>
            <small className="field-error" id="email-error">
              {error("email")}
            </small>
            <div className="account-inline">
              <span className="muted">Pouze ověřené adresy</span>
              <Help>
                Novou adresu nejprve ověřte odkazem zaslaným na e-mail. Potom ji
                můžete vybrat jako hlavní adresu účtu.
              </Help>
            </div>
            <Notice error={mutation.error} />
            <div className="account-form-actions">
              <button
                type="submit"
                className="primary"
                disabled={!changed || mutation.isPending}
              >
                {mutation.isPending ? "Ukládám…" : "Uložit profil"}
              </button>
              <span role="status">
                {mutation.isSuccess && !changed ? "Profil uložen." : ""}
              </span>
            </div>
          </fieldset>
        </form>
      </section>
      <section className="account-section" aria-labelledby="security-heading">
        <div className="account-section-intro">
          <h2 id="security-heading">Přihlášení a zabezpečení</h2>
        </div>
        <div className="account-settings-list">
          <div>
            <span>Heslo</span>
            <a className="button quiet" href="/weblate/accounts/password/">
              {saved.hasPassword ? "Změnit heslo" : "Nastavit heslo"}
            </a>
          </div>
          <div>
            <span className="account-security-state">
              <ShieldCheck size={18} />
              Dvoufázové přihlášení{" "}
              <small>{saved.hasSecondFactor ? "Zapnuté" : "Nenastavené"}</small>
            </span>
            <a className="button quiet" href="/weblate/accounts/profile/">
              Spravovat zabezpečení
            </a>
          </div>
          <div>
            <span>E-mailová adresa</span>
            <form
              method="post"
              action="/weblate/accounts/login/email/?next=/ucet"
            >
              <input
                type="hidden"
                name="csrfmiddlewaretoken"
                value={session.csrf}
              />
              <button type="submit" className="quiet">
                Ověřit novou adresu
              </button>
            </form>
          </div>
        </div>
      </section>
      <section className="account-section" aria-labelledby="membership-heading">
        <div className="account-section-intro">
          <h2 id="membership-heading">Přístup do redakce</h2>
        </div>
        <div>
          <p>
            {session.member
              ? {
                  admin: "Správce",
                  reviewer: "Reviewer",
                  translator: "Překladatel",
                }[session.member.role]
              : session.accessMessage || "Čeká na schválení správce."}
          </p>
          <small>Oprávnění a pozvánky spravuje administrátor projektu.</small>
          {session.member?.role === "admin" && (
            <p className="account-admin">
              <a href="/weblate/access/ember-cs/">
                Správa členů a pozvánek <ArrowUpRight size={14} />
              </a>
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
