# Foundry Translate 0.19.1 — stručný návod

## České rozhraní

V **Nastavení hry → Preferovaný jazyk** vyber **Čeština**, ulož nastavení a
obnov stránku. Přeložené rozhraní Foundry, Crucible a Emberu funguje i bez
LM Studia. Jazyk rozhraní a cílový jazyk překladače jsou dvě samostatné volby.
Obsah deníků, jména dokumentů a texty dalších modulů se tím automaticky nemění.


## První spuštění

V seznamu deníků otevřete **Překlad dobrodružství** (v anglickém Foundry
**Adventure translation**). Totéž okno otevře tlačítko s ikonou překladu v levé
kategorii **Journal Notes** nebo položka v nastavení modulu.

Od verze 0.16.1 mají skript i CSS adresu svázanou s verzí, takže aktualizace
načte nové rozhraní bez ručního mazání cache.

V **Překladač a jazyk** vyberte OpenAI-compatible / LM Studio, adresu
`http://127.0.0.1:1234/v1`, přesné ID modelu ze serveru a češtinu. LM Studio
musí mít spuštěný server a povolené CORS. Použijte **Otestovat připojení** a
uložte nastavení. Adresa a model jsou nastavením tohoto prohlížeče.

Pro tento překlad je vybraný **Hy-MT2 30B-A3B APEX**. Na našem serveru má
ID `hy-mt2-30b-a3b-apex`. Není potřeba další server ani XGrammar: LM Studio
vynucuje JSON strukturu při generování. Modul předává souvislé věty, schválený
glosář a kontext světa; názvy a odkazy následně kontroluje a obnovuje kód.

Menší alternativou zůstává Hy-MT2 7B. Rychlost závisí na počítači a kvantizaci.
Překlad není automatická jazyková korektura: drobná chybná koncovka může projít.
Před vyprávěním zkontrolujte význam a seznam problémů. Výsledky zkoušek jsou
v [ověření APEX](benchmarks/apex-release-2026-09-21.md).

## Jedno kliknutí při čtení

Otevřete stránku původního deníku a stiskněte **Přeložit tuto stránku**.
Vznikne uložená kopie a otevře se stejná stránka. **Zobrazit originál** vás
vrátí zpět. Původní dobrodružství se neupravuje.

Jedna stránka nespustí překlad celé knihy, na kterou odkazuje. Již hotové
překlady se využijí pro odkazy. Pro přípravu celé knihy včetně navázaných
postav a předmětů použijte překlad celého deníku. Průběh i bezpečné zrušení
najdete v přehledu překladů.

Při změně glosáře nebo modelu se nově přeloží vybraná stránka, ostatní
přeložené stránky zůstanou čitelné. Pokud se změnila samotná zdrojová kniha,
modul vyžádá obnovu celého deníku, aby nepřepsal zbývající překlady zdrojem.

## Vlastní jména a běžné pojmy

Glosář se před překladem doplní z postav, scén a typovaných stránek Emberu.
Postavy, místa, frakce, božstva a kulturní názvy dostanou ochranu. Šablony
stvoření, které Ember výslovně označuje jako běžná stvoření, se vedou jako
nechráněné pojmy. U neoznačených postav zůstává konzervativní ochrana jména.

V glosáři lze hledat a filtrovat kategorie. Rozbalení položky nabízí:

- pevný výstupní název nebo překlad;
- alternativní zápisy oddělené středníkem;
- kategorii;
- použití názvu: **Pevný tvar**, **Povolit skloňování**, nebo **Nepoužívat**.

**Pevný tvar** vždy vloží přesný uložený název. **Povolit skloňování** dovolí
modelu použít název v odpovídajícím pádu, například `Starý Carinth` →
`do Starého Carinthu`. Funguje pro češtinu přes OpenAI-compatible / LM Studio.
Model dostane český název přímo v kontextu věty. Modul kontroluje zachování
slovního základu, počtu slov a ochranných značek. Jde o konzervativní kontrolu
tvarů, nikoli úplný český morfologický slovník. Neobvyklý tvar může odmítnout.
Po neúspěšných pokusech zkusí přeložit větu s přesnými schválenými tvary názvů.
Takový úsek označí ke kontrole gramatiky a neuloží do mezipaměti. Teprve pokud
neprojde ani tento pokus, ponechá původní úsek se schválenými názvy a uvede
problém. Výsledek je potřeba jazykově zkontrolovat, zejména fantasy jména.

Chrome, Google a jiné cílové jazyky použijí pevný tvar a při spuštění překladu
na to upozorní. **Nepoužívat** znamená, že se heslo vůbec nepředá překladači,
ani jako doporučení. Starší hesla bez uvedeného režimu zůstávají pevná.

Ručně nastavené hodnoty mají přednost při další synchronizaci. Vypnutí
položku nesmaže; pouze dovolí běžný překlad. Rozlišování velikosti písmen
je přesné, takže odlišný zápis patří mezi alternativy.

Jméno ukryté jen v próze ani unikátní předmět bez spolehlivé značky nemusí
být objeven automaticky. Takové názvy přidejte jednou ručně. Například
frakce uvedená pouze v odstavci nebude bezpečně rozpoznána podle toho, že
začíná velkým písmenem. Pokyn modelu k zachování jmen sám není záruka.

## Společná úprava a import názvů

AI pojmenovávání bylo odstraněno. **Synchronizovat názvy** pouze načte původní
názvy ze světa; nepotřebuje LM Studio. Již uložené překlady zůstávají zachované.
Dřívější AI návrhy jsou označené **ke kontrole**, dokud je ručně neupravíte nebo
neschválíte importem. Překlad samotných příběhů dál používá zvolený překladač.

1. Otevřete **Názvy a pojmy**, synchronizujte názvy a uložte rozepsané opravy.
2. Zvolte **Export / import → Exportovat CSV** pro společné úpravy, nebo
   **Exportovat JSON** pro zálohu. Volitelný kontext přidá krátké úryvky z příběhu.
3. Upravte překlady, kategorie, aliasy a poznámky. Původní názvy ponechte přesně;
   slouží ke spárování s uloženým glosářem.
4. Vyberte soubor. Náhled ukáže původní a příchozí hodnoty. Nové položky jsou
   předvybrané; změny existujících názvů musíte vybrat. Import neschváleného
   názvu je zároveň jeho ručním schválením, i když překlad zůstane stejný.
5. Klikněte na **Uložit vybrané změny**. Otevřený glosář se okamžitě aktualizuje.

Nic se nemaže jen proto, že položka v souboru chybí. Duplicitní názvy, konfliktní
aliasy nebo změny provedené po vytvoření náhledu zápis zastaví. Po zastaralém
náhledu soubor znovu vyberte. Před hromadnými úpravami si můžete uložit původní
JSON jako zálohu a případně jeho změny později importovat stejným postupem.

CSV má povinné sloupce **source, replacement, category**. Volitelné jsou
**aliases, enabled, notes, context, language, mode**. Export používá UTF-8 s BOM,
čárky a uvozovky; import přijme také středníkový oddělovač.
Prázdný překlad znamená zachování originálu. Aliasy jsou JSON seznam, například
`["krátký název","jiný zápis"]`; enabled přijímá `true` nebo `false`.
`mode` přijímá `fixed` nebo `inflect`; prázdná hodnota znamená `fixed`.
`enabled=false` vypíná i heslo s `mode=inflect`. JSON obsahující skloňování má
verzi formátu 2. Starší modul ho odmítne, aby skloňování neztratil bez upozornění.
Kategorie: `character`, `location`, `faction`, `deity`, `item`, `lore`, `term`.
Kontext slouží jen jako podklad a při importu se neukládá. Poznámky se ukládají
a jsou dostupné také v detailu položky. Limit souboru je 5 MB / 20 000 položek.

JSON export lze použít přímo. Tato obrazovka přijme i glosář ze staršího balíčku
překladů, ale neimportuje jeho deníky. Pro opravy existujících názvů používejte
**Export / import** v glosáři; obecný import balíčku nadále zachovává místní volby.

Compendia modulu se při načtení světa zařadí do složky **Foundry Translate**.

## Sdílení bez modelu

**Sdílení a import překladů** exportuje JSON s textovými změnami a glosářem.
Příjemce potřebuje stejný systém a odpovídající zdrojové dobrodružství, ale
nepotřebuje LM Studio ani jiné AI. Soubor obsahuje i původní znění měněných
polí pro kontrolu; může tedy obsahovat příběhové spoilery.

Po výběru JSON se nejprve zobrazí náhled. Import nezmění existující překlady
ani místní volby v glosáři. Chybějící nebo změněné zdroje přeskočí. Současná
verze vyžaduje shodná UUID a obsah; dokumenty se náhodně vytvořenými jinými
ID v jiném světě zatím nepáruje podle názvu.

Export nevkládá API klíče, adresu serveru, obrázky ani celé původní dokumenty.
Položky se změněným zdrojem vynechá a vypíše jejich seznam.

## Názvy přeložených dokumentů a odkazy

Kopie postav a předmětů mají český název a příponu `[CS]`. Názvy obsažené
v glosáři převezmou schválený základní tvar přímo, bez dotazu na model.
Překládají se také jména jejich vložených předmětů a názvy prototypů tokenů.
Tyto názvy jsou součástí exportu a importu překladů.

Odkazy bez vlastního popisku dostanou název podle hesla se shodným zdrojovým UUID
v glosáři. Ve větě se může skloňovat; samostatný název zůstává v základním tvaru.
Již zadané popisky se překládají běžnou cestou. Crucible zachová český popisek
i na vložených kartách postav a předmětů. Cíl odkazu, ID a herní hodnoty se nemění.

Starší uložené překlady je pro doplnění názvů potřeba přeložit znovu. Modul pozná
starou verzi překladového postupu; ručně upravené kopie nadále chrání před přepsáním.
