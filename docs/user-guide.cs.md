# Foundry Translate 0.16.1 — stručný návod

## První spuštění

V seznamu deníků otevřete **Překlad dobrodružství** (v anglickém Foundry
**Adventure translation**). Totéž okno otevře tlačítko s ikonou překladu v levé
kategorii **Journal Notes** nebo položka v nastavení modulu.

Pokud po aktualizaci vypadají tlačítka stlačeně nebo chybí nové rozložení,
obnovte stránku bez cache (`Ctrl+Shift+R`). Prohlížeč může držet staré CSS.

V **Překladač a jazyk** vyberte OpenAI-compatible / LM Studio, adresu
`http://127.0.0.1:1234/v1`, přesné ID modelu ze serveru a češtinu. LM Studio
musí mít spuštěný server a povolené CORS. Použijte **Otestovat připojení** a
uložte nastavení. Adresa a model jsou nastavením tohoto prohlížeče.

Pro první test doporučujeme stažený `hy-mt2-7b` (Tencent Hy-MT2 7B Q8_0).
Jeho zvláštní překladové zadání modul vybere automaticky. Srovnání na jednom
skutečném Ember questu: přibližně 38 sekund, bez porušení ochranných značek.
Čeština byla lepší než u testované Gemmy, ale stále vyžadovala místy úpravy.
Menší kvantizace nebo slabší počítač mohou výsledek i rychlost změnit.

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
- zapnutí nebo vypnutí ochrany.

Ručně nastavené hodnoty mají přednost při další synchronizaci. Vypnutí
položku nesmaže; pouze dovolí běžný překlad. Rozlišování velikosti písmen
je přesné, takže odlišný zápis patří mezi alternativy.

Jméno ukryté jen v próze ani unikátní předmět bez spolehlivé značky nemusí
být objeven automaticky. Takové názvy přidejte jednou ručně. Například
frakce uvedená pouze v odstavci nebude bezpečně rozpoznána podle toho, že
začíná velkým písmenem. Pokyn modelu k zachování jmen sám není záruka.

## Volitelné názvy podle kontextu

AI pojmenování je při aktualizaci i nové instalaci vypnuté. Zapněte ho výběrem
**AI s kontextem · nejasné názvy zachovat** a zadejte **Model pro glosář**.

Tyto volby najdete v **Překladač a jazyk** pod poskytovatelem LM Studio.
AI dostane krátký popis a okolní zmínky. Jasně popisné názvy uloží rovnou jako
pevný překlad; nejasné názvy ponechá. Překládat lze i smysluplná jména postav,
příjmení a přídomky, pokud výsledek zní přirozeně a uvěřitelně ve fantasy světě.
Zvolená podoba se uloží do glosáře a dál se používá jednotně. Cílové příklady jsou
„Old Carinth → Starý Carinth“ a „Strayhearth Caravan → Karavana Putujícího Ohniště“.
Nejde o záruku kvality každého názvu. Karavany typu Actor „group“ se nyní řadí
mezi frakce, aby mohly získat popisný překlad.

Model pro glosář běží na stejném serveru jako překladač, ale může být jiný.
ID zatím vyberte výslovně; automatická volba čeká na model s ověřenou češtinou.
Qwen3.5 9B Q4_K_M i Granite 4.2 8B Q4_K_S v místním testu chybovaly ve významu
i gramatice názvů. Ani jeden zatím nedoporučujeme pro automatické ukládání názvů.
Qwen3.8 27B Q4_K_M měl lepší češtinu, ale na nových názvech stále chyboval;
ani ten zatím není automatickou volbou. V místním testu mu zapnuté MTP zrychlilo
generování přibližně 1,7×.
Hy-MT2 může dál
překládat samotné příběhy. S Chrome nebo Google se AI pojmenování nespouští.

Hotová rozhodnutí se při další synchronizaci neopakují. V detailu položky
najdete původ rozhodnutí a vysvětlení pod ikonou ⓘ; ruční změny i importovaný
glosář mají přednost. Synchronizaci lze zastavit a později dokončit. Při chybě
modelu se hotové dávky zachovají a zbývající názvy zůstanou původní.
AI dostává i související už uložené názvy. Celé ustálené jméno má přednost před
překlady jeho jednotlivých částí. Pokud návrh změní nejasnou chráněnou část jména
nebo poruší uloženou volbu, daný název zůstane původní a ostatní se zpracují dál.
V jeho detailu se zobrazí „ochrana jména“ s vysvětlením pod ikonou ⓘ.

Compendia modulu se při načtení světa znovu zařadí do složky **Foundry Translate**.
Přesuny probíhají postupně, aby si jejich souběžné vytváření nepřepsalo nastavení.

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
