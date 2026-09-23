import { t } from "./elements";
export function labelFor(path: string): string {
  const key = ({ name: "Name", "text.content": "Text", "text.markdown": "Text", "prototypeToken.name": "TokenName", description: "Description", navName: "NavigationName",
    "system.description": "Description", "system.subtitle": "Subtitle", "system.details.archetype.description": "Archetype",
    "system.details.taxonomy.description": "Taxonomy", "system.details.biography.appearance": "Appearance",
    "system.details.biography.public": "PublicBiography", "system.details.biography.private": "PrivateBiography" } as Record<string, string>)[path];
  if (key) return t(key);
  const outcome = /^system\.outcomes\.(\d+)\.label$/u.exec(path);
  if (outcome) return t("Outcome").replace("{number}", String(Number(outcome[1]) + 1));
  const final = path.split(".").at(-1) ?? path;
  const known = t(`Field.${final}`);
  if (!known.startsWith("FOUNDRY_TRANSLATE.")) return known;
  const label = final.replace(/([a-z])([A-Z])/gu, "$1 $2");
  return label.charAt(0).toLocaleUpperCase() + label.slice(1);
}

