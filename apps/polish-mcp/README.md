# Korektura přímo ve Foundry přes MCP

Od **Foundry Translate 0.32.0 / MCP 0.3.0** agent čte a opravuje překlady
přímo v otevřeném světě. Není potřeba Docker, klon repozitáře, sestavování,
ruční spuštění služby ani export/import.

## Připojení

1. Na počítači, kde používáš prohlížeč s Foundry, musí být **Node.js 22.12+**
   dostupný jako `node`. MCP klient musí podporovat spouštění lokálních STDIO serverů.
   Foundry samotné může běžet na vzdáleném serveru.
2. Ve Foundry jako GM otevři **Překlady dobrodružství → Korektura přes MCP**.
   Klíč se vytvoří automaticky. Klikni **Uložit a povolit přístup**.
3. Klikni **Zkopírovat MCP JSON** a vlož konfiguraci do svého MCP klienta.
   Klient most automaticky spustí. Při prvním spuštění stáhne konkrétní vydání
   `foundry-polish.cjs` z GitHubu a ověří jeho SHA-256; další spuštění používá
   znovu ověřenou soukromou místní kopii. Node spouští přímo, bez shellu či npm instalace.
4. Foundry se připojí automaticky; případně povol prohlížeči přístup k místní síti.
   Nech GM kartu světa otevřenou. `live_connection` ukáže spojení a `live_status`
   musí potvrdit správný svět a jazyk před první opravou.
5. Asistent načte `live_get_context`, zkontroluje návrh přes
   `live_validate_correction` a uloží jej přes `live_save_correction`.
   Výsledek a případné chyby dostane okamžitě.

JSON obsahuje přístupový klíč v `env.FOUNDRY_MCP_API_KEY`. Konfiguraci nesdílej.
Klíč se ukládá do klientských předvoleb tvého Foundry prohlížeče a do konfigurace
MCP klienta; nástroje jej nevracejí. Přístup je vázaný na přesný původ Foundry,
ID světa, účet GM a jazyk. Port 3112 používá pouze tento místní most, nikoliv
LM Studio. V pokročilém nastavení lze zvolit jiný neprivilegovaný port na 127.0.0.1.
Stejný JSON neumožní propojení jiného světa či GM. Kopíruj jej znovu po změně
jazyka, světa, účtu, klíče, portu nebo aktualizaci verze modulu a restartuj MCP.

Klient musí běžet na stejném počítači jako prohlížeč. Vzdálené či čistě webové
MCP klienty bez místního STDIO procesu tato varianta nepodporuje.
MCP samo nespouští model ani nevyžaduje LM Studio. Obsah vrácený nástroji dostane
model připojeného klienta; místní most neznamená automaticky místní inferenci.

## Obnovení spojení a vypnutí

Uložený a povolený přístup se obnoví při načtení stejného světa stejným GM
ve stejném jazyce. Když klient neběží, Foundry čeká a zkouší spojení každých
5 sekund. Nesprávný klíč či změna rozsahu další pokusy zastaví. Druhá GM karta
nemůže převzít aktivní relaci; ta bez kontaktu vyprší po 60 sekundách.

**Vypnout přístup** zastaví spojení i automatické navazování. Nástroj
`live_disconnect` odpojí a zablokuje přístup do restartu MCP procesu; potom
znovu povol přístup v menu Foundry.
Nový klíč vyžaduje uložení přístupu, nový JSON a restart klienta.
Zavření okna s návodem neodpojuje; zavření celé GM karty znemožní další práci.

## Opravy, historie a bezpečné opakování

Agent zapisuje jen existující přeložený text, s důvodem a historií. V
**Editoru překladů → Historie oprav** lze změnu vrátit; již otevřený editor
obnov tlačítkem **Načíst znovu**. Ověření zůstává samostatný ruční krok.
Originály, makra, herní mechaniky a glosář nejsou přes MCP zapisovatelné.
Kontext zahrnuje originál, okolní odstavce, glosář a související dostupné dokumenty.
Odkazy lze přesouvat uvnitř odstavce, jejich cíle a chráněné části zůstanou zachované.

Překlad musí být dokončený nebo pozastavený před korekturou. Změněné UUID,
parametry příkazů, HTML struktura či číselné hodnoty se běžně odmítnou. Každá oprava
má `operationId`. Po ztracené odpovědi nejprve zkontroluj `live_list_history`:
zápis mohl být dokončen. Most zápisy automaticky neopakuje. Ruční opakování se
stejným ID a přesně stejnými argumenty nevytvoří další změnu. Konflikt vyžaduje
nové načtení kontextu; nelze slepě použít starou revizi.

`live_search_passages` prochází nejvýše 5 dokumentů na požadavek: pokračuj přes
`nextOffset`. Deterministické kontroly nezaručují správnost významu, kterou
posuzuje člověk. Foundry neposkytuje serverové compare-and-swap; souběžný zápis
jiného GM ve stejném okamžiku nelze plně vyloučit. Používej jednoho zapisujícího GM.

### Rekonstrukce poškozených odkazů od 0.33.9 / MCP 0.3.8

Starší překlad může několik odkazů na různé schopnosti zkrátit na stejnou
postavu nebo přeložit samotný příkaz. Pak nelze bezpečně poznat původní cíle
podle českých popisků ani pořadí. `live_prepare_reference_rebuild` vytvoří plán
pro celé poškozené textové pole: úplný originál, současný překlad, přesně vybrané
části k rekonstrukci a značky odvozené z originálu.

Agent znovu sestaví české věty **jen v těchto částech** a umístí jejich značky.
Ostatní části musí zachovat přesně. Neposílá UUID, příkazy ani nové parametry.
`live_validate_reference_rebuild` ukáže úplné před/po, vazby a dostupnost cílů,
kontrolu čísel i upozornění glosáře. Teprve po kontrole může
`live_apply_reference_rebuild` uložit všechny plánované řádky jedním zápisem.
Obě metody vyžadují čerstvou `revision` a `planHash`; zápis také důvod a
jedinečné `operationId`. Vynechaný řádek, změněný originál, nejednoznačná
provenience nebo poškozené HTML zápis zablokují.

Číselné hodnoty se kontrolují zvlášť v každé dotčené části. Výslovné
`restoreSourceNumbers` musí obnovit čísla téže části originálu; shodný součet
mezi několika odstavci nestačí. Existující přeložené parametry `@Embed` se touto
rekonstrukcí nevracejí do angličtiny; taková nejednoznačná oprava se odmítne.

Aktivní odkazy musí mít dostupný cíl. Ember obsahuje také původní větve pro
jiný herní systém, které při vykreslení odstraňuje. Jen u přesně prokázané
neaktivní větve původního `system-swap` bloku lze zachovat přesný původní odkaz,
i když v tomto světě neexistuje. Náhled tuto výjimku výslovně ukazuje. Pokud
se tentýž cíl používá také mimo neaktivní větev, jeho existence je povinná.
Neznámé větvení ani větev přidaná pouze do překladu tuto výjimku nezískají.
Výjimka je ověřená pro aktivní Ember **0.6.2** a systémy `crucible`/`dnd5e`;
jiná verze modulu nebo systém vyžadují existenci všech obnovovaných cílů.

Zápis zůstává neověřený a má historii a možnost vrácení. Vrácení může obnovit
původní poškození a znovu zablokovat dané pole; přijímá pouze přesný uložený
stav dotčených řádků a nezměněný originál. Po aktualizaci zkopíruj nový MCP JSON
a restartuj klienta. Běžné opravy textu používají stejné přísné kontroly jako
dříve; tento postup není obecné povolení měnit odkazy.

### Atomická obnova identifikátorů od 0.33.4 / MCP 0.3.4

Pokud starý překlad přeložil technický název uvnitř `&Reference[...]`, lze použít
`live_validate_reference_identifiers` a poté `live_restore_reference_identifiers`.
Obě metody přijímají jen `documentId`, `rowId`, čerstvou `revision` a `reason`;
zápis navíc vyžaduje `operationId`. Agent žádný náhradní příkaz ani UUID nezadává.
Modul odvodí přesný původní identifikátor z originálu a v náhledu ukáže všechny
změněné odstavce. Po kontrole je obnoví v jednom zápisu do přeloženého dokumentu.

Povolena je jen jednoznačná záměna jednoho holého `Reference` v každém odstavci
téhož pole. Chybějící příkazy, jinak poškozené UUID, nejednoznačné záměny,
změněné parametry nebo HTML se tím opravit nedají. České věty, popisky, čísla
a umístění odkazů zůstávají zachované. Celé opravené pole musí projít běžnou
validací. Zápis má historii, idempotentní opakování a možnost vrácení, pokud se
jeho dotčené odstavce ani originál nezměnily. Oprava se neoznačí jako ověřená.
Po aktualizaci modulu zkopíruj nový MCP JSON a restartuj MCP klienta.

### Diagnostika a řízené opravy od 0.32.1 / MCP 0.3.1

`live_get_context` vrací také `integrityDetails`: chybějící a nadbytečné chráněné
příkazy s počty výskytů a cesty změněné HTML struktury či atributů. Diagnostika
je omezená velikostí; příznak zkrácení neznamená úplný seznam problémů.

Pokud originál obsahuje číslice, které překlad změnil nebo vynechal, lze v náhledu
a zápisu výslovně použít `restoreSourceNumbers: true`. Povolí se pouze oprava,
která vrátí celý soubor číselných hodnot dané pasáže na hodnoty originálu, včetně
počtu opakování. Čísla v chráněných příkazech se tím měnit nesmějí. Kontrola
neposuzuje slovně zapsaná čísla ani jejich přiřazení k významu věty; to stále
musí ověřit agent podle kontextu.

U pole, kde chybějí pouze původní chráněné příkazy, může kontext nabídnout
`referenceRepairEdit`. Obsahuje stávající editovatelný text a přesné chybějící
příkazy z originálu jako nové značky. Agent značky umístí do správné části věty
a použije `restoreSourceReferences: true` v náhledu i zápisu. Značky nelze
vynechat, zdvojit ani změnit jejich cíle. Výsledné celé pole musí odpovídat
struktuře a příkazům originálu; pokud chybí odkazy i v jiné pasáži téhož pole,
jedna oprava nestačí a zápis zůstane zablokovaný.

Od verze modulu 0.32.3 / mostu 0.3.2 lze stejně opravit také jednoznačný odkaz
`@UUID`, který starší překlad zkrátil z vložené schopnosti (`Item`) nebo stránky
(`JournalEntryPage`) na její rodičovský dokument. `referenceRepairEdit.targetChanges`
a náhled `referenceRepair.targetChanges` ukazují původní a obnovený příkaz.
Přidá se pouze přesná přípona z originálu; stávající přeložená kopie rodiče,
kotva a popisek se zachovají. Agent může popisek dále upravit přes `labels`.
`referenceRepairTargets` a náhled uvádějí také dostupnost obnovených cílů.
Jejich existenci most ověří při načtení kontextu, náhledu i novém zápisu.
Pokud dítě chybí nebo není dostupné, návrh se nenabídne a explicitní oprava
vrátí `Live.ReferenceTargetMissing`. Ani odkaz v originálu není zárukou, že
schopnost či stránka existuje. Agent nesmí hádat náhradní cíl.

Oprava se nenabídne, pokud by rodiči odpovídalo více chybějících dětí, stejný
odkaz chyběl opakovaně, odkaz byl v jiném odstavci, rodič byl relativní nebo
se změnil jiný příkaz či HTML. Neobnovuje jiné cíle, vložené efekty ani změněné
parametry pravidel. Celé pole musí po opravě projít původní přísnou validací.

Obě opravy vyžadují aktuální revizi a důvod, ukládají se do stejné historie
a zůstávají neověřené. Lze je vrátit; vrácení obnovy odkazu může znovu zablokovat
původně poškozené pole. Po aktualizaci modulu zkopíruj nový MCP JSON a restartuj
MCP klienta, aby použil odpovídající verzi mostu.

Most poslouchá pouze na 127.0.0.1, ověřuje Host i přesný Origin a API klíč.
Token pro konkrétní relaci je pouze v paměti. Po timeoutu se relace ukončí;
automatické nové spojení neopakuje nejistý zápis. MCP nikdy nepřijímá libovolnou
zapisovací cestu ani JavaScript od agenta.

## Vývoj

```sh
npm ci
npm ci --prefix apps/polish-mcp
npm --prefix apps/polish-mcp run check
npm run check
npm run release:verify
```

Sestavení modulu vytvoří i SHA-256 metadata pro konkrétní vydání mostu. Release
publikuje samostatný `foundry-polish.cjs` a modul používá jeho neměnnou adresu,
nikoliv odkaz na nejnovější verzi. Vývojář může připravený soubor spustit přímo:

```sh
FOUNDRY_MCP_API_KEY="$FOUNDRY_MCP_API_KEY" node apps/polish-mcp/dist/index.cjs \
  --live --origin https://foundry.example.cz --world WORLD --user GM --language cs
```

Testy ověřují skutečný STDIO klient, autentizaci, obnovu spojení, ochranu relace,
stažení s kontrolním součtem a odmítnutí změněného spustitelného souboru.
Starší explicitní CLI exportní režim zůstává interně kompatibilní; ve Foundry MCP
menu není nabídnut. Běžné sdílení překladů a glosáře přes export/import zůstává
součástí editoru pro komunitní práci, nezávisle na MCP.
