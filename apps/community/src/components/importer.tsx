import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Check } from "lucide-react";
import { api, useSession, message } from "../api";
import { Help, Notice } from "./shell";
interface Preview {
  digest: string;
  documents: number;
  newDocuments: number;
  conflicts: string[];
  glossary: number;
  skippedUi: number;
  importedReviews: number;
}
export function Importer() {
  const [json, setJson] = useState(""),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [result, setResult] = useState("");
  const member = useSession().data?.member;
  const qc = useQueryClient();
  const preview = useMutation({
    mutationFn: (value: string) =>
      api<Preview>("import/preview", { json: value }),
  });
  const apply = useMutation({
    mutationFn: () =>
      api<{ imported: number }>("import/commit", {
        json,
        digest: preview.data?.digest,
      }),
    onSuccess: (r) => {
      setResult(
        `Počet přijatých dokumentů: ${r.imported}. Nyní se připravují jejich oddíly.`,
      );
      preview.reset();
      qc.invalidateQueries({ queryKey: ["books"] });
      qc.invalidateQueries({ queryKey: ["glossary"] });
    },
  });
  if (member?.role !== "admin")
    return (
      <main className="page">
        <p>Exporty nahrává správce projektu.</p>
      </main>
    );
  return (
    <main className="page narrow">
      <h1>Nahrát export</h1>
      <p className="muted">
        Pracovní soubor z editoru Foundry Translate nebo překladový balíček
        JSON.
      </p>
      <label className="upload">
        <Upload size={30} />
        <strong>{name || "Vyberte soubor z Foundry"}</strong>
        <span>JSON · nejvýše 25 MB</span>
        <input
          aria-label="Soubor exportu"
          type="file"
          accept=".json,application/json"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setError("");
            setResult("");
            preview.reset();
            if (f.size > 25 * 1024 * 1024) {
              setError("Soubor je příliš velký.");
              return;
            }
            try {
              const value = await f.text();
              setJson(value);
              setName(f.name);
              preview.mutate(value);
            } catch (err) {
              setError(message(err));
            }
          }}
        />
      </label>
      <Notice error={error || preview.error || apply.error} />
      {preview.isPending ? <p>Kontroluji strukturu a původní odkazy…</p> : null}
      {result ? (
        <p className="notice success">
          <Check size={16} />
          {result}
        </p>
      ) : null}
      {preview.data ? (
        <section className="import-preview">
          <h2>Náhled importu</h2>
          <dl>
            <dt>Dokumenty v souboru</dt>
            <dd>{preview.data.documents}</dd>
            <dt>Nové dokumenty</dt>
            <dd>{preview.data.newDocuments}</dd>
            <dt>Hesla glosáře</dt>
            <dd>{preview.data.glossary}</dd>
          </dl>
          <p>
            Existující redakční úpravy se nepřepisují.{" "}
            <Help>
              Shodný dokument lze importovat opakovaně. Odlišný originál nebo
              export stejného dokumentu vyžaduje samostatné řešení konfliktu.
            </Help>
          </p>
          {preview.data.importedReviews ? (
            <p className="notice">
              Původní ověření ({preview.data.importedReviews}) slouží jako
              součást pracovního exportu; v komunitní redakci začne obsah bez
              nového schválení.
            </p>
          ) : null}
          {preview.data.skippedUi ? (
            <p className="notice">
              Úpravy rozhraní ({preview.data.skippedUi}) tento první import
              ještě nezahrnuje.
            </p>
          ) : null}
          {preview.data.conflicts.length ? (
            <Notice
              error={`Odlišné existující dokumenty: ${preview.data.conflicts.join(", ")}`}
            />
          ) : (
            <button
              className="primary"
              disabled={apply.isPending}
              onClick={() => apply.mutate()}
            >
              {apply.isPending
                ? "Importuji…"
                : "Importovat do soukromé redakce"}
            </button>
          )}
        </section>
      ) : null}
    </main>
  );
}
