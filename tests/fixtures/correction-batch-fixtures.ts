/** Generated fictional fixtures; no captured world prose or glossary definitions. */
import type { GlossaryEntry } from '../../src/glossary/types';
import {TRANSLATIONS_PACK_ID} from '../../src/translation/compendium-translation-repository';
import { planReviewText } from '../../src/review/text-plan';
export const syntheticGlossary778: GlossaryEntry[] = Array.from({length:778},(_,i)=>({
  id:`synthetic-${i}`,source:`FixtureTerm${i}`,replacement:`ZkušebníPojem${i}`,category:'term',aliases:[`FixtureAlias${i}`],
  notes:`Fictional definition ${i}; generated regression fixture.`,mode:i%2===0?'inflect':'fixed',enabled:true,
}));
const missingSpell='Compendium.fixture.spells.Item.syntheticSpell';
const paragraphs=Array.from({length:99},(_,i)=>i===40?
  `<p>Use &amp;reference[poisoned] and &amp;reference[incapacitated] @UUID[${missingSpell}]{Fictional restoration} for 3 rounds.</p>`:
  i===41?'<p>Read @UUID[JournalEntry.syntheticChain]{Chain} and @UUID[JournalEntry.syntheticGuide]{Guide}.</p>':
  `<p>Fictional source paragraph ${i}: this is generated prose for a complete-field test.</p>`);
const translations=Array.from({length:99},(_,i)=>i===40?
  `<p>Použij &amp;reference[otrávený] a &amp;reference[neschopný pohybu] @UUID[${missingSpell}]{Testovací obnova} po 3 kola.</p>`:
  i===41?`<p>Přečti @UUID[Compendium.${TRANSLATIONS_PACK_ID}.JournalEntry.syntheticChainCopy]{Řetězec} a @UUID[Compendium.${TRANSLATIONS_PACK_ID}.JournalEntry.syntheticGuideCopy]{Průvodce}.</p>`:
  `<p>Smyšlený odstavec ${i}: toto je generovaný text pro kontrolu celého pole.</p>`);
const source=paragraphs.join(''),current=translations.join('');
export const synthetic99={raw:{source,current},get units(){return planReviewText(source,'html').units.map(unit=>({unitId:unit.id}))}};
export const synthetic99Repaired={expectedRawAfter:current.replace('&amp;reference[otrávený]','&amp;reference[poisoned]').replace('&amp;reference[neschopný pohybu]','&amp;reference[incapacitated]')};
