# Foundry Translate 0.25.0 — stručný návod

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

## Kontrola a opravy překladu

Otevřete **Překlad dobrodružství → Editor překladů**. Vyberte dokument
a vlevo jeho oddíl nebo stránku. Tabulka ukazuje originál vedle překladu;
podporuje deníky, postavy, předměty, texty scén i aktivních efektů.

1. Opravte text v pravém sloupci a stiskněte **Uložit opravu**.
2. Po porovnání významu s originálem stiskněte **Ověřit**.
3. Přepněte na **Pouze neověřené**, pokud chcete pokračovat zbývajícími bloky.

Formátované úseky odstavce mají samostatná pole, aby se neztratilo zvýraznění
nebo formátování. Značky jako `⟦1⟧` chrání odkazy a herní příkazy. Popisek
odkazu upravíte v samostatném poli pod textem; prázdný popisek použije název
propojeného dokumentu. UUID a herní pravidla tím neměníte.

Ověření platí pro konkrétní uložený text a původní kontext. Při změně překladu
nebo zdroje se již nezobrazuje jako platné; ověření můžete také ručně zrušit.
Jméno kontrolujícího a čas uvidíte po najetí na značku. Nepřeložené stránky
rozpracovaného deníku nelze ověřovat. Upozornění automatických kontrol nejsou
totéž co ruční ověření významu.

Rozepsané opravy zůstávají při přepínání oddílů. Před zavřením, přepnutím
dokumentu či novým načtením je uložte nebo zahoďte příslušným tlačítkem.
Pokud dokument mezitím upravil někdo jiný, editor odmítne přepis a ponechá
rozepsaný text v okně ke zkopírování. Současné opravy více GM ve stejném
dokumentu si koordinujte; Foundry nenabízí atomický zámek mezi klienty.

Před opravami pozastavte překlad. Od verze **0.26.0** se opravy uložené tímto
editorem označí jako **Oprava chráněná při navázání**. Při pokračování nebo
novém spuštění se dopřeloží zbývající stránky; opravené texty, název, kategorie,
ověření a historie zůstanou zachované. Podmínkou je stejný originál, glosář a
nastavení překladače. Změny mimo sledované opravy (také opravy ze starších verzí)
nadále blokují automatické navázání. Uložení další opravy je samo neodsouhlasí.
Ochrana neznamená ověření významu. Hotové stránky se znovu nepřekládají;
uvnitř rozpracované stránky zatím nelze opravovat jednotlivé hotové věty.
Změněný zdroj, nesoulad struktury nebo zamčené kompendium ukládání zablokuje.
Originální dobrodružství zůstává beze změn.

Uložené opravy přenese JSON export překladů. Značky ručního ověření jsou
lokální a do jiného světa se nepřenášejí; tam je potřeba text zkontrolovat znovu.

## Hledání a hromadné opravy (0.25.0)

V editoru otevřete **Hledat a nahradit**. Vyhledávání projde uložené překlady
zvoleného jazyka, včetně názvů dokumentů, tokenů, odstavců a popisků UUID odkazů.
Lze hledat i v originálu, omezit typ dokumentu nebo zobrazit jen neověřené úseky.
**I podobné zápisy** najde část překlepů a skloňovaných podob; procento vyjadřuje
podobnost zápisu, nikoli jazykovou správnost. Pro aktuální změny z jiných oken
použijte **Znovu načíst překlady**.

1. Zadejte například `Agraband Rychlý` a klikněte na **Vyhledat**.
2. U nalezených podob vyberte výskyty a napište pro každou vlastní náhradu.
   `Agraband Rychlý` a `Agrabandem Rychlým` mají samostatné náhrady.
3. Vpravo lze jednotlivé výskyty vyřadit. **Otevřít oddíl** přeskočí do jejich
   původního kontextu v editoru.
4. **Připravit náhled vybraných oprav** ukáže původní a nové znění odstavců.
5. Teprve **Uložit zobrazené změny** zapíše opravy a zruší ověření dotčených úseků.

Náhrady se týkají pouze vybraných výskytů. Neprovádí se automatické skloňování
náhrad. Hromadná oprava nemění glosář: nové schválené jméno zapište také
do glosáře, aby jej používaly budoucí překlady. Text rozdělený různým formátováním se nabídne k ruční opravě v oddílu.
Kód, herní příkazy, UUID a cílové adresy zůstávají chráněné. Nepřeložené části
rozpracovaných deníků se neprohledávají jako hotový překlad.

Před zápisem se zkontrolují všechny vybrané dokumenty. Ukládá se po jednom;
při konfliktu nebo chybě se další zápisy zastaví. **Zastavit po aktuálním dokumentu**
dokončí probíhající zápis. Při přerušeném spojení ověřte výsledek v historii.
Rozpracované ruční opravy v okně se neukládají samy.

## Historie a vrácení oprav

**Historie oprav** obsahuje změny uložené editorem od verze 0.25.0: původní
znění, opravené znění, čas a jméno GM. **Vrátit opravu** nejprve zobrazí obsah
zásahu a vyžádá potvrzení v okně. Vrací se jeden dokument; nesouvisející
pozdější opravy zůstávají zachované. Pokud se změnil některý dotčený úsek nebo
originál, editor vrácení odmítne. Vrácené úseky je nutné znovu ověřit.

Záznam historie se ukládá společně s opravou a přežije obnovení prohlížeče.
Je součástí metadat kopie a má stejná přístupová práva. Export historie JSON
slouží jako čitelný záznam, není určen k importu překladů. Historie nezachytává
změny provedené mimo editor a nenahrazuje zálohu světa.

## Otevření z dokumentu a úpravy rozhraní

Ikona pera **Upravit překlad** v záhlaví deníku, postavy, předmětu, scény
nebo efektu otevře příslušný překlad. U deníku zachová aktuální stránku.
Je dostupná i na originálu, pokud k němu existuje jednoznačný překlad.

V části **Rozhraní** vyberte **Foundry**, **Ember** nebo **Crucible**. Hledejte
podle originálu, češtiny nebo klíče; případně zapněte podobné zápisy. Opravy se
ukládají a ověřují samostatně. Proměnné jako `{name}`, značky HTML a adresy
musí zůstat zachované. **Obnovit z modulu** ukáže náhled výchozího textu.

Vlastní opravy jsou uložené v nastavení světa a aktualizace modulu je nesmaže.
Projeví se u každého klienta po příštím obnovení jeho stránky; editor nikoho
automaticky neodpojí. Nevztahují se na Setup před spuštěním světa. Pokud nová
verze Foundry či systému změní originál, zastaralá oprava se dočasně nepoužije.

**Export oprav JSON** a **Import oprav JSON** přenášejí pouze vlastní změny
rozhraní. Import nejprve ukáže rozdíly, nekompatibilní klíče vynechá a vyžádá
samostatné uložení. Přenesené opravy se automaticky neoznačí za ověřené.

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

Jiné cílové jazyky použijí pevný tvar a při spuštění překladu
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

Přeložené postavy, předměty a deníky mají název bez jazykové přípony.
Jazyk a vazba na originál zůstávají uložené v metadatech. Názvy obsažené
v glosáři převezmou schválený základní tvar přímo, bez dotazu na model.
Překládají se také jména jejich vložených předmětů a názvy prototypů tokenů.
Tyto názvy jsou součástí exportu a importu překladů.

Odkazy bez vlastního popisku dostanou název podle hesla se shodným zdrojovým UUID
v glosáři. Ve větě se může skloňovat; samostatný název zůstává v základním tvaru.
Již zadané popisky se překládají běžnou cestou. Crucible zachová český popisek
i na vložených kartách postav a předmětů. Cíl odkazu, ID a herní hodnoty se nemění.

Starší uložené překlady je pro doplnění názvů potřeba přeložit znovu. Modul pozná
starou verzi překladového postupu; ručně upravené kopie nadále chrání před přepsáním.

## Okolní kontext a kontrola kvality (0.21.0)

Připojení nyní používá pouze OpenAI kompatibilní API. Adresa a ID modelu pro
LM Studio zůstávají stejné; Google API a překlad v prohlížeči nejsou v nabídce.
Při přechodu ze starého poskytovatele nastavte adresu a model a otestujte spojení.

Model dostává kromě překládaného odstavce také krátké okolní úryvky z originálu
a názvy dokumentu a stránky. Pomáhá to rozlišit význam slov a rod mluvčího.
Okolní kontext se nepřidává do výstupu a nesmí přebít schválený glosář.
APEX překládá tyto pasáže odděleně, aby nemíchal mluvčí a význam slov mezi nimi.
Věty uvnitř jednoho odstavce zůstávají společně.

Změna kontextu má vlastní klíč mezipaměti. Kopii ze staršího
překladového enginu bezpečná kontrola odmítne přepsat; nový běh vyžaduje
odstranění příslušné staré přeložené kopie, pokud ji už nepotřebujete.
Ručně opravené překlady si nejprve exportujte. Originály se nemění.

Referenční sada rozlišuje zásadní chyby významu (negace, podmínky, čísla,
kdo komu co dělá), glosář, přidání či vynechání informace a menší jazykové chyby.
Automatická kontrola odkazů a JSON sama správnost významu nepotvrzuje.

## Propojení událostí Emberu (0.22.0)

Přeložená stránka události používá stejnou původní událost a její herní stav.
Spuštění, výběr výsledku a dokončení probíhá přes běžné ovládání Emberu.
Opakované otevření překladu nezakládá další událost ani nespouští její herní akce.
Propojení poznáte podle krátké zprávy nad stránkou; vysvětlení je v tooltipu.

Pokud chybí originál, nesouhlasí ID nebo se změnila pravidla události, stránka
zablokuje ovládání a nabídne originál. Pravidla upravujte v originálu. Překlady
zůstávají samostatnými dokumenty; přeložená postava nenahrazuje živou postavu
na scéně a nesynchronizuje její životy. Některá automaticky otevřená okna a
texty generované přímo Emberem mohou stále zobrazit originál.


## Scény a aktivní efekty (0.23.0)

V nastavení scény nebo efektu klikněte na **Přeložit text**. Překlad celého deníku
zahrne také odkazované scény a efekty; u navázaných postav a předmětů najde i
vložené efekty. Překlad jediné stránky nadále zpracovává jen zvolenou stránku.

Překládá se název scény, navigační název, text kreseb a poznámek na mapě, názvy
úrovní a oblastí. U efektů se překládá název a popis. Původní UUID, mapa,
pozice, bonusy, stavy, trvání a spouštěné skripty zůstávají beze změny.

Texty se ukládají do **Foundry Translate — Scene & Effect Text**. Každý dokument
má samostatné stránky pro jednotlivá pole; zde lze opravovat překlad. U krátkých
názvů ponechte jediný obyčejný odstavec. Do popisu nevkládejte nové příkazy ani
neměňte cíle odkazů; kontrola takové úpravy odmítne zobrazit.

Čeština se zobrazí v navigaci, na mapě, v seznamu objektů, na běžných odkazech
na dokumenty a v kartách efektů Crucible. Ve formulářích zůstává původní hodnota,
nad nimi je český náhled pouze pro čtení. U efektu v přeložené kopii postavy či
předmětu se překlad dohledá přes uložené UUID originálu a shodné ID efektu.
Nově vytvořený efekt s jiným UUID vyžaduje vlastní překlad; názvy se nepárují odhadem.
Speciální okna jiných modulů a texty uvnitř obrázků tento postup nepokrývá.

Kompendium je ve výchozím stavu dostupné jen GM, protože obsahuje i skryté
názvy a poznámky. Hráči uvidí překlady jen při odpovídajícím přístupu ke kompendiu;
nepovolujte jim celý obsah, pokud obsahuje tajné informace.

Změní-li se zdrojový text, jeho zastaralý překlad se přestane používat. Opakované
spuštění zachová kompatibilní ruční opravy; změna zdroje, glosáře nebo modelu
blokuje přepsání existujícího záznamu. Pokud chcete takový záznam nahradit,
nejprve si uchovejte potřebné opravy a odstraňte jen příslušný překlad, nikoli scénu.
Záznamy jsou součástí JSON balíčku; formát 3 vyžaduje modul 0.23.0 nebo novější.
Import nevyžaduje AI a nemění herní dokumenty. Makra, hudba a tabulky se nepřekládají.

## Kontrola názvů (0.26.0)

V editoru otevřete **Kontrola názvů → Zkontrolovat názvy**. Kontrola vyhledá
aktivní hesla a jejich aliasy v originálu a porovná odpovídající českou pasáž.
Přednost mají delší názvy, takže „Old Carinth“ nezamění za samostatný „Carinth“.
Prohlíží i popisky odkazů; UUID, příkazy a kód nehodnotí jako překládaný text.

- **Zůstal původní název**: v českém textu se našel anglický název.
- **Podobný zápis / velikost písmen k revizi**: možný překlep nebo jiná podoba.
- **Odpovídající název nenalezen**: porovnejte celé věty; někdy je v překladu
  správně použité zájmeno nebo volnější formulace.
- **I odpovídající tvary** zobrazí přesné znění, rozpoznané české skloňování
  a ručně schválené tvary. Rozpoznávání je pomůcka, ne jazyková záruka.

**Otevřít oddíl** vede na konkrétní odstavec. **Najít tuto podobu k opravě**
přejde do hromadného hledání; každou náhradu vyberete a zkontrolujete v náhledu.
U hesel se skloňováním můžete potvrdit neobvyklý správný tvar pomocí
**Schválit tvar pro kontrolu**. Tím se nemění překlad, glosář, prompt modelu ani
ověření odstavce. Schválení platí pro tento svět, jazyk a znění hesla; lze je
zrušit v **Ručně schválené tvary**. Po změně základního překladu už neplatí.

Po opravách spusťte kontrolu znovu. Nedostupné dokumenty a nepřeložené úseky
jsou uvedené zvlášť. **Export nálezů JSON** je čitelný protokol pro revizi,
nikoli import překladů. Kontrola nemusí odhalit významové chyby ani jména,
která nejsou rozpoznatelná v původní pasáži.

## Redakční fronta a kontext (od 0.27.0)

V editoru otevřete **Redakční fronta → Načíst frontu**. Fronta zahrnuje úseky
přeložených dokumentů v cílovém jazyce, v pořadí dokumentů a jejich oddílů.
Filtry **Ke kontrole**, **K diskusi**, **Nesedí význam** a **S poznámkou** pomohou
rozdělit práci. Nedostupné úseky (například dosud nepřeložené stránky) se neřadí
do fronty; jejich počet a dokumenty, které se nepodařilo načíst, zůstávají viditelné.
Fronta se aktualizuje tlačítkem **Načíst frontu**. Otevření úseku vždy načte jeho
aktuální obsah.

**Kontext a poznámky** u odstavce zobrazí odpovídající hesla glosáře, odkazy
na originální postavy či místa a sousední odstavce ze stejného textového pole.
V užším okně se panel přesune pod text. Lze jej skrýt a získat více místa pro
korekturu. Delší vysvětlení jsou pod ikonami nápovědy.

Redakční stav a poznámku ukládá samostatné tlačítko **Uložit poznámku**.
Nemění samotný překlad ani příznak ověření. Poznámka zůstane zachována i po
opravě odstavce, ale upozorní na změněný text; po kontrole ji lze znovu uložit.
Stav **Bez připomínky** a prázdná poznámka záznam odstraní. Redakční připomínka
může existovat i u ověřeného úseku: jde o samostatné údaje.

Poznámky jsou sdílená data tohoto světa, nikoli soukromé poznámky uživatele.
Nepřenášejí se exportem překladů. Ukládají se odděleně od přeložených dokumentů,
takže pokračující překlad je nepřepíše. Při změně stejné poznámky jiným editorem
se zastaralé uložení odmítne. Stejně jako u oprav Foundry neposkytuje transakční
zámek proti dvěma zcela současným zápisům. Poznámky jsou uložené ve společném
nastavení světa, proto je při práci více redaktorů neukládejte současně.

- **Ctrl/Cmd+S** uloží opravu vybraného úseku; při psaní v panelu uloží poznámku.
- **Ctrl/Cmd+Enter** samostatně ověří uložený úsek. Rozepsanou opravu neověří
  a již udělené ověření zkratkou neruší.
- **Alt+↓** nebo **Další neověřený úsek** načte aktuální frontu a přejde dál,
  i do následujícího dokumentu. Na konci pokračuje od začátku. Rozepsané opravy
  a poznámky je třeba nejprve uložit nebo zahodit.
- **Pokračovat v kontrole** obnoví naposledy vybraný úsek i po zavření editoru
  nebo obnovení stránky. Pozice je uložená v tomto prohlížeči zvlášť pro svět,
  uživatele a cílový jazyk. Pokud už úsek neexistuje, editor požádá o nový výběr.

Rozepsané změny nejsou automaticky ukládané na disk; editor brání zavření a
upozorní při obnovování stránky. Před ukončením práce je uložte.
