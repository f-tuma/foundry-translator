import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { api } from "../api";
import { Help, Notice } from "./shell";
export interface Term {
  source: string;
  replacement: string;
  category: string;
  mode?: string;
  notes?: string;
  aliases: string[];
}
export function useGlossary() {
  return useQuery({
    queryKey: ["glossary"],
    queryFn: () => api<{ entries: Term[] }>("glossary"),
  });
}
export function Glossary() {
  const [search, setSearch] = useState("");
  const data = useGlossary();
  const rows =
    data.data?.entries.filter((t) =>
      `${t.source} ${t.replacement} ${t.aliases.join(" ")}`
        .toLocaleLowerCase("cs")
        .includes(search.toLocaleLowerCase("cs")),
    ) ?? [];
  return (
    <main className="page">
      <div className="section-heading">
        <div>
          <h1>Společný glosář</h1>
          <p className="muted">Jedno jméno. Stejný svět.</p>
        </div>
        <Help>
          Glosář pochází z importovaného projektu. V tomto prvním průchodu je
          referenční: názvy v textech upravujete přes návrhy změn. Změna
          samotného glosáře vyžaduje připravenou migraci projektu.
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
      <table className="glossary-table">
        <thead>
          <tr>
            <th>Originál</th>
            <th>Český název</th>
            <th>Použití</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.source}>
              <td>{t.source}</td>
              <td>{t.replacement}</td>
              <td className="muted">
                {t.mode === "inflect" ? "Lze skloňovat" : "Přesný tvar"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && !data.isPending ? (
        <p className="empty">Žádná odpovídající hesla.</p>
      ) : null}
    </main>
  );
}
