# Foundry Translate 0.15.0 — stručný návod

## První spuštění

V seznamu deníků otevřete **Překlad dobrodružství** (v anglickém Foundry
**Adventure translation**). Totéž okno najdete v nastavení modulu.

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
