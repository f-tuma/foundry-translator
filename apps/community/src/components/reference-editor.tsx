import { ChevronRight, LockKeyhole } from "lucide-react";
import {
  maskReviewParts,
  type ReviewTextDraft,
  type ReviewReference,
} from "../../../../src/review/text-plan";
import { referenceDraftError } from "../review-draft";
import { Help, Notice } from "./shell";

function ReferenceFields({
  references,
  onChange,
  label,
}: {
  references: ReviewReference[];
  onChange?: (marker: string, label: string) => void;
  label: string;
}) {
  return references.map((reference) => (
    <label key={reference.marker}>
      <span className="reference-marker">{reference.marker}</span>
      {onChange && reference.editable ? (
        <input
          aria-label={`${label} — popisek ${reference.marker}`}
          placeholder="Automatický název dokumentu"
          value={reference.label}
          onChange={(event) => onChange(reference.marker, event.target.value)}
        />
      ) : (
        <span>
          {reference.label ||
            (reference.editable
              ? "Automatický název dokumentu"
              : "Chráněný příkaz")}
        </span>
      )}
    </label>
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
        Přesun odkazů a úprava popisků{" "}
        <Help>
          Značky jako ⟦1⟧ můžete vyjmout a vložit kamkoli v témže odstavci, i
          mezi jeho textovými poli. Každá musí zůstat právě jednou. Jejich
          pořadí se nekontroluje. Popisky upravíte zde pod textem, cíle odkazů
          zůstanou zachované.
        </Help>
      </div>
      <div className={source ? "reference-columns" : undefined}>
        {source ? (
          <div>
            <h3>Originál</h3>
            <ReferenceFields
              references={original}
              label={`Originál ${label}`}
            />
          </div>
        ) : null}
        <div>
          {source ? <h3>Český překlad</h3> : null}
          <ReferenceFields
            references={references}
            label={label}
            onChange={(marker, value) =>
              onChange({
                ...target,
                references: target.references.map((refs) =>
                  refs.map((ref) =>
                    ref.marker === marker ? { ...ref, label: value } : ref,
                  ),
                ),
              })
            }
          />
        </div>
      </div>
    </details>
  );
}
