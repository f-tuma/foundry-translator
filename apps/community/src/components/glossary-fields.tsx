export const glossaryLabels = [
  "Český název",
  "Kategorie",
  "Použití",
  "Poznámka",
  "Alternativní názvy originálu",
  "Stav hesla",
];
export const categories: Record<string, string> = {
  character: "Postava",
  location: "Místo",
  faction: "Frakce",
  deity: "Božstvo",
  item: "Předmět",
  lore: "Reálie",
  term: "Herní pojem",
};
export function glossaryValue(value: string, index: number) {
  if (index === 1) return categories[value] || value;
  if (index === 2) return value === "inflect" ? "Lze skloňovat" : "Přesný tvar";
  if (index === 5) return value === "on" ? "Zapnuto" : "Vypnuto";
  return value || "—";
}
export function GlossaryFields({
  values,
  onChange,
  disabled = false,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
}) {
  const set = (index: number, value: string) =>
    onChange(values.map((v, i) => (i === index ? value : v)));
  return (
    <fieldset className="glossary-fields" disabled={disabled}>
      <label>
        Český název
        <input
          required
          maxLength={240}
          value={values[0]}
          onChange={(e) => set(0, e.target.value)}
        />
      </label>
      <label>
        Kategorie
        <select value={values[1]} onChange={(e) => set(1, e.target.value)}>
          {Object.entries(categories).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Použití
        <select value={values[2]} onChange={(e) => set(2, e.target.value)}>
          <option value="inflect">Lze skloňovat</option>
          <option value="fixed">Přesný tvar</option>
        </select>
      </label>
      <label>
        Stav hesla
        <select value={values[5]} onChange={(e) => set(5, e.target.value)}>
          <option value="on">Zapnuto</option>
          <option value="off">Vypnuto</option>
        </select>
      </label>
      <label>
        Alternativní názvy originálu
        <textarea
          rows={3}
          maxLength={24100}
          placeholder="Každý název na samostatný řádek"
          value={values[4]}
          onChange={(e) => set(4, e.target.value)}
        />
      </label>
      <label>
        Poznámka
        <textarea
          rows={3}
          maxLength={2000}
          value={values[3]}
          onChange={(e) => set(3, e.target.value)}
        />
      </label>
    </fieldset>
  );
}
