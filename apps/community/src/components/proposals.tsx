import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { diffWordsWithSpace } from "diff";
import { Check, GitMerge, ArrowLeft, MessageSquare } from "lucide-react";
import { api, useSession } from "../api";
import type { Proposal, Unit, Change } from "../shared";
import { Notice, Help } from "./shell";
import { TextPart } from "./editor";
const states = {
  draft: "Koncept",
  submitted: "Ke kontrole",
  approved: "Schváleno",
  merged: "Sloučeno",
  rejected: "Zamítnuto",
};
function Diff({
  before,
  after,
  side,
}: {
  before: string;
  after: string;
  side: "before" | "after";
}) {
  return (
    <p className="prose diff">
      {diffWordsWithSpace(before, after).map((p, i) =>
        p.added ? (
          side === "after" ? (
            <ins key={i}>{p.value}</ins>
          ) : null
        ) : p.removed ? (
          side === "before" ? (
            <del key={i}>{p.value}</del>
          ) : null
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </p>
  );
}
interface Detail {
  proposal: Proposal;
  rows: Unit[];
  comments: { id: number; body: string; author: string; at: string }[];
}
export function Proposals() {
  // Shell mounts this component only for an admitted member.
  const who = useSession().data!.member!;
  const qc = useQueryClient();
  const [id, setId] = useState(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("id") || ""
      : "",
  );
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState(false);
  const all = useQuery({
    queryKey: ["proposals"],
    queryFn: () => api<{ proposals: Proposal[] }>("proposals"),
  });
  const detail = useQuery({
    queryKey: ["proposal", id],
    queryFn: () => api<Detail>(`proposals/${id}`),
    enabled: !!id,
  });
  const action = useMutation({
    mutationFn: (operation: string) =>
      api("proposals/transition", {
        id,
        revision: detail.data?.proposal.revision,
        action: operation,
        ...(operation === "rebase"
          ? {
              bases: detail.data?.rows.map((r) => ({
                unitId: r.id,
                revision: r.revision,
              })),
            }
          : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proposal", id] });
      qc.invalidateQueries({ queryKey: ["proposals"] });
      qc.invalidateQueries({ queryKey: ["units"] });
    },
  });
  const sendComment = useMutation({
    mutationFn: () => api("comments", { id, body: comment }),
    onSuccess: () => {
      setComment("");
      qc.invalidateQueries({ queryKey: ["proposal", id] });
    },
  });
  const p = detail.data?.proposal;
  const conflicts =
    detail.data?.rows.some((r) =>
      p?.changes.some(
        (c) => c.unitId === r.id && c.baseRevision !== r.revision,
      ),
    ) && p?.status !== "merged";
  const [rebaseConfirm, setRebaseConfirm] = useState(false);
  return (
    <main className="page proposals">
      <div className="section-heading">
        <div>
          {id ? (
            <button
              className="text-button"
              onClick={() => {
                setId("");
                setEditing(false);
                history.replaceState(null, "", "/navrhy");
                action.reset();
              }}
            >
              <ArrowLeft size={16} />
              Všechny návrhy
            </button>
          ) : null}
          <h1>{p?.title || "Společně k lepšímu překladu."}</h1>
          <p className="muted">
            {p
              ? `${p.author_name} · revize ${p.revision}`
              : "Každá oprava má svůj kontext, kontrolu a historii."}
          </p>
        </div>
        {p ? (
          <span className={`state ${p.status}`}>{states[p.status]}</span>
        ) : null}
      </div>
      <Notice error={all.error || detail.error || action.error} />
      {!id ? (
        <div className="proposal-list">
          {all.data?.proposals.map((item) => (
            <button
              className="proposal-list-row"
              key={item.id}
              onClick={() => {
                setId(item.id);
                setEditing(false);
                history.replaceState(null, "", `/navrhy?id=${item.id}`);
                action.reset();
              }}
            >
              <div>
                <h3>{item.title}</h3>
                <small>
                  {item.author_name} · oddíly: {item.changes.length} ·{" "}
                  {new Date(item.updated_at).toLocaleDateString("cs-CZ")}
                </small>
              </div>
              <span className={`state ${item.status}`}>
                {states[item.status]}
              </span>
            </button>
          ))}
          {all.data?.proposals.length === 0 ? (
            <div className="empty">
              <h3>Prostor pro první opravu.</h3>
              <p>V editoru upravte text a odešlete návrh ke kontrole.</p>
            </div>
          ) : null}
        </div>
      ) : !p ? (
        <p>Načítám návrh…</p>
      ) : (
        <>
          {conflicts ? (
            <div className="notice warning">
              <strong>Aktuální překlad se mezitím změnil.</strong>
              <p>
                Porovnejte společný základ, aktuální text a navrženou opravu.
                Sloučení je do vyřešení konfliktu zablokované.
              </p>
              <button onClick={() => detail.refetch()}>
                Obnovit porovnání
              </button>
            </div>
          ) : null}
          {p.author_id === who.id &&
          !["merged", "rejected"].includes(p.status) &&
          !conflicts ? (
            <div className="actions">
              <button onClick={() => setEditing((v) => !v)}>
                {editing ? "Zavřít koncept" : "Upravit návrh"}
              </button>
            </div>
          ) : null}
          {editing ? (
            <EditProposal
              key={p.id}
              proposal={p}
              rows={detail.data!.rows}
              userId={who.id}
              onDone={() => {
                setEditing(false);
                qc.invalidateQueries({ queryKey: ["proposal", id] });
                qc.invalidateQueries({ queryKey: ["proposals"] });
              }}
            />
          ) : null}
          <div className="proposal-changes">
            {p.changes.map((c) => {
              const current = detail.data!.rows.find((r) => r.id === c.unitId);
              const changed =
                current &&
                current.revision !== c.baseRevision &&
                p.status !== "merged";
              return (
                <section key={c.unitId}>
                  <h3>
                    {current?.document_title}{" "}
                    <span className="muted">/ {current?.label}</span>
                  </h3>
                  <div className={`change-columns ${changed ? "three" : ""}`}>
                    <div>
                      <small>SPOLEČNÝ ZÁKLAD</small>
                      <Diff
                        before={c.before.join("\n")}
                        after={c.after.join("\n")}
                        side="before"
                      />
                    </div>
                    {changed ? (
                      <div>
                        <small>AKTUÁLNÍ PŘEKLAD</small>
                        <p className="prose">{current.value.join("\n")}</p>
                      </div>
                    ) : null}
                    <div>
                      <small>NAVRHOVANÁ OPRAVA</small>
                      <Diff
                        before={c.before.join("\n")}
                        after={c.after.join("\n")}
                        side="after"
                      />
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
          <div className="review-actions">
            {p.author_id === who.id &&
            p.status !== "merged" &&
            p.status !== "rejected" ? (
              conflicts ? (
                <>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={rebaseConfirm}
                      onChange={(e) => setRebaseConfirm(e.target.checked)}
                    />
                    Porovnal/a jsem aktuální text a chci ho nahradit navrženými
                    opravami.
                  </label>
                  <button
                    disabled={!rebaseConfirm || action.isPending}
                    onClick={() => action.mutate("rebase")}
                  >
                    Použít opravy jako nový koncept
                  </button>
                </>
              ) : p.status === "draft" ? (
                <button
                  className="primary"
                  disabled={action.isPending}
                  onClick={() => action.mutate("submit")}
                >
                  Odeslat ke kontrole
                </button>
              ) : (
                <p className="muted">Návrh čeká na jiného reviewera.</p>
              )
            ) : null}
            {p.author_id !== who.id &&
            who.role !== "translator" &&
            !conflicts ? (
              <>
                {p.status === "submitted" ? (
                  <button
                    className="primary"
                    disabled={action.isPending}
                    onClick={() => action.mutate("approve")}
                  >
                    <Check size={16} />
                    Schválit tuto verzi
                  </button>
                ) : null}
                {p.status === "approved" ? (
                  <button
                    className="primary"
                    disabled={action.isPending}
                    onClick={() => action.mutate("merge")}
                  >
                    <GitMerge size={16} />
                    Sloučit opravy
                  </button>
                ) : null}
                {["submitted", "approved"].includes(p.status) ? (
                  <button
                    disabled={action.isPending}
                    onClick={() => action.mutate("reject")}
                  >
                    Zamítnout návrh
                  </button>
                ) : null}
              </>
            ) : null}
            {p.approval ? (
              <small>
                Schválil/a {p.approval.userName} · revize {p.approval.revision}
              </small>
            ) : null}
            <Help>
              Schválení platí pro přesnou revizi návrhu. Sloučení znovu
              kontroluje všechny texty a uloží celou sadu v jedné databázové
              transakci.
            </Help>
          </div>
          <section className="discussion">
            <h2>
              <MessageSquare size={21} />
              Diskuse k návrhu
            </h2>
            {detail.data!.comments.map((c) => (
              <article key={c.id}>
                <strong>{c.author}</strong>
                <small>{new Date(c.at).toLocaleString("cs-CZ")}</small>
                <p className="pre-line">{c.body}</p>
              </article>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendComment.mutate();
              }}
            >
              <label>
                Komentář
                <textarea
                  required
                  maxLength={8000}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Vysvětlení opravy, souvislosti nebo otázka pro redakci…"
                />
              </label>
              <Notice error={sendComment.error} />
              <button disabled={sendComment.isPending || !comment.trim()}>
                Přidat komentář
              </button>
            </form>
          </section>
        </>
      )}
    </main>
  );
}

function EditProposal({
  proposal,
  rows,
  userId,
  onDone,
}: {
  proposal: Proposal;
  rows: Unit[];
  userId: string;
  onDone: () => void;
}) {
  type Draft = {
    revision: number;
    title: string;
    changes: Change[];
    requestId: string;
  };
  const storageKey = `ember.proposal-draft.v1.${userId}.${proposal.id}`;
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (
        saved &&
        Number.isSafeInteger(saved.revision) &&
        typeof saved.title === "string" &&
        typeof saved.requestId === "string" &&
        Array.isArray(saved.changes) &&
        saved.changes.length === proposal.changes.length &&
        saved.changes.every(
          (c: Change) =>
            c &&
            typeof c.unitId === "string" &&
            typeof c.baseRevision === "string" &&
            proposal.changes.some((old) => old.unitId === c.unitId) &&
            Array.isArray(c.before) &&
            Array.isArray(c.after) &&
            [...c.before, ...c.after].every((v) => typeof v === "string"),
        )
      )
        return saved;
    } catch {
      /* Ignore malformed browser storage; the server proposal stays intact. */
    }
    return {
      revision: proposal.revision,
      title: proposal.title,
      changes: structuredClone(proposal.changes),
      requestId: crypto.randomUUID(),
    };
  });
  const [storageError, setStorageError] = useState("");
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(draft));
      setStorageError("");
    } catch {
      setStorageError(
        "Koncept se nepodařilo uložit do prohlížeče. Uložte novou revizi před odchodem.",
      );
    }
  }, [draft, storageKey]);
  const save = useMutation({
    mutationFn: () => api("proposals/save", { id: proposal.id, ...draft }),
    onSuccess: () => {
      try {
        localStorage.removeItem(storageKey);
      } catch {}
      onDone();
    },
  });
  return (
    <form
      className="proposal-edit"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h2>Nová revize návrhu</h2>
      <p className="muted">
        Uložením se návrh vrátí do konceptů a zruší se jeho dosavadní schválení.
        Rozpracované úpravy zůstávají v tomto prohlížeči.
      </p>
      <label>
        Název návrhu
        <input
          required
          maxLength={200}
          value={draft.title}
          onChange={(e) =>
            setDraft({
              ...draft,
              title: e.target.value,
              requestId: crypto.randomUUID(),
            })
          }
        />
      </label>
      {draft.revision !== proposal.revision ? (
        <div>
          <Notice error="Na serveru je novější revize. Před uložením porovnejte změny. Koncept nebyl přepsán." />
          <button
            type="button"
            onClick={() =>
              setDraft({
                revision: proposal.revision,
                title: proposal.title,
                changes: structuredClone(proposal.changes),
                requestId: crypto.randomUUID(),
              })
            }
          >
            Zahodit místní koncept a načíst serverovou revizi
          </button>
        </div>
      ) : null}
      {draft.changes.map((c, changeIndex) => (
        <section key={c.unitId}>
          <h3>{rows.find((r) => r.id === c.unitId)?.label}</h3>
          {c.after.map((v, i) => (
            <TextPart
              key={i}
              value={v}
              label={`Oprava oddílu ${changeIndex + 1}.${i + 1}`}
              onChange={(value) =>
                setDraft({
                  ...draft,
                  requestId: crypto.randomUUID(),
                  changes: draft.changes.map((change) =>
                    change.unitId === c.unitId
                      ? {
                          ...change,
                          after: change.after.map((part, j) =>
                            i === j ? value : part,
                          ),
                        }
                      : change,
                  ),
                })
              }
            />
          ))}
        </section>
      ))}
      <Notice error={storageError || save.error} />
      <button
        className="primary"
        disabled={save.isPending || draft.revision !== proposal.revision}
      >
        {save.isPending ? "Ukládám…" : "Uložit novou revizi"}
      </button>
    </form>
  );
}
