import { ChevronRight, LockKeyhole } from "lucide-react";
import {
  maskReviewParts,
  type ReviewTextDraft,
  type ReviewReference,
} from "../../../../src/review/text-plan";
import { referenceDraftError } from "../review-draft";
import { embedTextOptionSignature } from "../../../../src/review/embed-text-options";
import { Help, Notice } from "./shell";

const optionLabel = { readaloud: "Text ke čtení nahlas", caption: "Titulek náhledu", label: "Název vloženého náhledu" } as const;

function ReferenceFields({ references, onChange, onOptionChange, label }: {
  references: ReviewReference[];
  onChange?: (marker: string, label: string) => void;
  onOptionChange?: (marker: string, key: "readaloud" | "caption" | "label", value: string) => void;
  label: string;
}) {
  return references.map((reference) => (
    <div className="reference-field" key={reference.marker}>
      <label>
        <span>Popisek odkazu</span>
        {reference.editable ? (
          <input
            aria-label={`${label} — popisek ${reference.marker}`}
            placeholder="Automatický název dokumentu"
            value={reference.label}
            readOnly={!onChange}
            onChange={onChange ? (event) => onChange(reference.marker, event.target.value) : undefined}
          />
        ) : <span>Chráněný příkaz</span>}
      </label>
      {(reference.options ?? []).map((option) => (
        <label className="reference-option" key={option.key}>
          <span>{optionLabel[option.key]}</span>
          {option.key === "readaloud" ? (
            <textarea
              aria-label={`${label} — ${optionLabel[option.key]} ${reference.marker}`}
              data-reference-option={option.key}
              value={option.value}
              rows={Math.max(2, Math.min(8, Math.ceil(option.value.length / 48)))}
              readOnly={!onOptionChange}
              onChange={onOptionChange ? (event) => onOptionChange(reference.marker, option.key, event.target.value) : undefined}
            />
          ) : (
            <input
              aria-label={`${label} — ${optionLabel[option.key]} ${reference.marker}`}
              data-reference-option={option.key}
              value={option.value}
              readOnly={!onOptionChange}
              onChange={onOptionChange ? (event) => onOptionChange(reference.marker, option.key, event.target.value) : undefined}
            />
          )}
        </label>
      ))}
    </div>
  ));
}

export function TranslationParts({
  draft,
  onChange,
  label,
  showReferences = true,
}: {
  draft: ReviewTextDraft;
  onChange: (draft: ReviewTextDraft) => void;
  label: string;
  showReferences?: boolean;
}) {
  const error = referenceDraftError(draft);
  return (
    <>
      {draft.text.map((text, index) => (
        <textarea
          key={index}
          aria-label={`${label}.${index + 1}`}
          aria-invalid={!!error}
          className="prose-input"
          value={text}
          rows={Math.max(2, Math.min(12, Math.ceil(text.length / 48)))}
          onChange={(event) =>
            onChange({
              ...draft,
              text: draft.text.map((part, i) =>
                i === index ? event.target.value : part,
              ),
            })
          }
        />
      ))}
      <Notice error={error} />
      {showReferences ? (
        <RowReferences target={draft} label={label} onChange={onChange} />
      ) : null}
    </>
  );
}

export function SourceParts({ parts }: { parts: string[] }) {
  return maskReviewParts(parts).text.map((text, i) => (
    <p key={i} className="prose">
      {text}
    </p>
  ));
}

export function RowReferences({
  source,
  target,
  label,
  onChange,
}: {
  source?: string[];
  target: ReviewTextDraft;
  label: string;
  onChange: (draft: ReviewTextDraft) => void;
}) {
  const original = source ? maskReviewParts(source).references.flat() : [];
  const references = target.references.flat();
  // Portable exports normally use canonical targets already. If they do not,
  // or two embeds share an immutable signature, do not guess a source pairing.
  const signature = (ref: ReviewReference) => embedTextOptionSignature(ref.command) ?? ref.command.replace(/\{[^}\r\n]*\}$/u, "");
  const originalGroups = new Map<string, ReviewReference[]>(), targetCounts = new Map<string, number>();
  for (const ref of original) { const key = signature(ref); originalGroups.set(key, [...(originalGroups.get(key) ?? []), ref]); }
  for (const ref of references) { const key = signature(ref); targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1); }
  const count = Math.max(original.length, references.length);
  if (!count) return null;
  return (
    <details className="reference-labels row-references">
      <summary>
        <ChevronRight size={14} className="disclosure-arrow" />
        <LockKeyhole size={12} />
        Odkazy ({count})
      </summary>
      <div className="reference-help">
        Přesun odkazů a úprava vložených textů{" "}
        <Help>
          Značky jako ⟦1⟧ můžete vyjmout a vložit kamkoli v témže odstavci, i
          mezi jeho textovými poli. Každá musí zůstat právě jednou. Jejich
          pořadí se nekontroluje. Popisky upravíte zde pod textem, cíle odkazů
          zůstanou zachované. U vložených náhledů můžete upravit také existující text ke čtení nahlas, titulek a název; nastavení a cíle nelze přidávat ani měnit.
        </Help>
      </div>
      {references.map((reference) => {
        const key = signature(reference), candidates = originalGroups.get(key);
        const sourceReference = candidates?.length === 1 && targetCounts.get(key) === 1 ? candidates[0] : undefined;
        return (
          <section className="reference-entry" key={reference.marker}>
            <strong className="reference-marker">{reference.marker}</strong>
            <div className={source ? "reference-columns" : undefined}>
              {source ? (
                <div>
                  <h3>Originál {sourceReference?.marker}</h3>
                  {sourceReference ? <ReferenceFields references={[sourceReference]} label={`Originál ${label}`} /> : <p>Originál nelze jednoznačně přiřadit.</p>}
                </div>
              ) : null}
              <div>
                {source ? <h3>Český překlad</h3> : null}
                <ReferenceFields
                  references={[reference]}
                  label={label}
                  onChange={(marker, value) => onChange({
                    ...target,
                    references: target.references.map((refs) => refs.map((ref) => ref.marker === marker ? { ...ref, label: value } : ref)),
                  })}
                  onOptionChange={(marker, key, value) => onChange({
                    ...target,
                    references: target.references.map((refs) => refs.map((ref) => ref.marker === marker ? {
                      ...ref, options: ref.options?.map((option) => option.key === key ? { ...option, value } : option),
                    } : ref)),
                  })}
                />
              </div>
            </div>
          </section>
        );
      })}
    </details>
  );
}
