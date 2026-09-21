# Foundry Translate 0.18.0 — stručný návod

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

Pro první test doporučujeme stažený `hy-mt2-7b` (Tencent Hy-MT2 7B Q8_0).
Jeho zvláštní překladové zadání modul vybere automaticky. Srovnání na jednom
skutečném Ember questu: přibližně 38 sekund, bez porušení ochranných značek.
Čeština byla lepší než u testované Gemmy, ale stále vyžadovala místy úpravy.
Menší kvantizace nebo slabší počítač mohou výsledek i rychlost změnit.
Samostatný test skloňování 21. 9. 2026 našel u Hy-MT2 i Qwen3.8 chyby v pádech;
nové skloňování ve verzi 0.18.0 proto zatím není uvolněné k běžnému použití.
Qwen3.8 používá nativní API LM Studio s vypnutým reasoningem, aby samotné
přemýšlení modelu nevyčerpalo čas pro překlad.

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
tvarů, nikoli úplný český morfologický slovník. Neobvyklý tvar může odmítnout;
neúspěšný opakovaný překlad se zobrazí mezi problémy překladu. Výsledek je potřeba
jazykově zkontrolovat, zejména nepravidelná fantasy jména.

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
