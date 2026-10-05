/** Reviewed literal section headings from Ember 0.6.2. Keep presentation
 * localization separate from stored prose, section IDs and gameplay data. */
const EMBER_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "At a Glance": "AtAGlance", "Setting the Scene": "SettingTheScene", "Event Details": "EventDetails", "Journal Summary": "JournalSummary",
  "Event Outcomes": "EventOutcomes", "Secret Lore": "SecretLore", "Gamemaster Information": "Gamemaster", "Ancestry Details": "AncestryDetails",
  "Culture Details": "CultureDetails", "Biome Details": "BiomeDetails", "Location Details": "LocationDetails", "Quest Details": "QuestDetails",
  "Biomes": "Biomes", "Locations": "Locations", "Notable Inhabitants": "NotableInhabitants", "Events": "Events", "Event Summary": "EventSummary",
  "Related Locations": "RelatedLocations", "Involved Locations": "InvolvedLocations",
});

export function localizeEmberSectionHeading(header: string): string {
  const key = Object.hasOwn(EMBER_HEADERS, header) ? `FOUNDRY_TRANSLATE.Reader.Section.${EMBER_HEADERS[header]}` : header;
  return game.i18n.localize(key);
}

/** Change only known literal headers on fresh render records. Unknown labels
 * may already be localized by a system schema and must pass through unchanged. */
export function localizeEmberSectionRecords(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map(section => {
    if (!section || typeof section !== "object" || typeof section.header !== "string"
      || !Object.hasOwn(EMBER_HEADERS, section.header)) return section;
    const header = localizeEmberSectionHeading(section.header);
    return header === section.header ? section : { ...section, header };
  });
}
