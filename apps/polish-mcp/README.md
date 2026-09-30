# Kontextová korektura přes MCP

Lokální MCP poskytuje asistentovi existující překlady, anglické originály,
okolní odstavce, glosář a dostupné související dokumenty. Asistent navrhne drobné
opravy se zdůvodněním. Vybrané návrhy lze importovat zpět do Foundry.

MCP samo nespouští model. Použiješ model v připojeném MCP klientu, například
v Codexu. Server nepotřebuje API klíč, LM Studio ani otevřený síťový port.
Text vrácený nástroji dostává připojený model; lokální MCP tedy samo o sobě
neznamená, že inference probíhá lokálně.

## Spuštění

Vyžaduje Node.js 22.12+ a tento repozitář. Z kořene repozitáře:

```sh
npm ci
npm --prefix apps/polish-mcp ci
npm --prefix apps/polish-mcp run build
node apps/polish-mcp/dist/index.cjs --workspace /absolutni/cesta/korektury
```

Proces komunikuje přes stdio, takže obvykle jej spouští přímo MCP klient.
Server vytvoří pouze `input/`, `sessions/` a `output/` ve zvolené složce.
Příkaz pro registraci do Codexu (nahraď obě absolutní cesty):

```sh
codex mcp add foundry-polish -- node /cesta/foundry-translator/apps/polish-mcp/dist/index.cjs --workspace /cesta/korektury
codex mcp get foundry-polish
```

Pro jiného klienta použij stejný příkaz `node` a argumenty jako stdio server.
[Oficiální konfigurace MCP v Codexu](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Práce s překladem

1. V **Foundry Translate → Editor překladu → Projekt** exportuj aktuální pracovní
   soubor JSON. Podporován je i soukromý balíček překladů; pracovní soubor navíc
   zachová poznámky a platná ověření u nezměněných odstavců.
2. Vlož export do `input/` zvoleného pracovního adresáře. Pro související kontext
   exportuj i propojené dokumenty, ne pouze jednu knihu. Původní soubor zůstane beze změny.
3. Připojenému asistentovi zadej například:

   > Použij foundry-polish. Otevři export, načti glosář a projdi nejprve deset
   > odstavců Příručky Vypravěče. Navrhni jen opravy gramatiky, významových chyb
   > a nepřirozených formulací. U každé dohledávej okolní kontext a související
   > postavy. Ponech schválené názvosloví. Ukaž mi návrhy s důvody; zatím nic neimportuj.

4. Asistent používá `get_context` před úpravou, `search_passages` pro další
   výskyty a `propose_correction` pro uložení neověřeného návrhu. Není nutné opravovat
   každý odstavec. Návrhy se průběžně ukládají; znovuotevření stejného exportu je obnoví.
5. Po výběru návrhů zavolá `export_corrections` s jejich konkrétními ID.
   Každý výstup vznikne v nové složce v `output/`:
   - `review.html`: původní angličtina, současná čeština, návrh, důvod a upozornění;
   - `suggestions.json`: audit změn včetně textu před úpravou;
   - `corrections.json`: pracovní soubor pro import v editoru Foundry.
6. Ve **Foundry Translate 0.30.0+** otevři **Editor překladu → Projekt → Import**,
   porovnej náhled a zvol dokumenty. Potvrzení „ověřeno“ proveď samostatně.

## Co se kontroluje

- Každý odkaz a herní příkaz zůstane přítomen se stejným cílem, parametry a počtem.
  Markery lze ve větě přesouvat, včetně přesunu mezi částmi s odlišným formátováním.
  Texty odkazů UUID a Embed lze upravovat zvlášť. HTML struktura zůstává stejná.
- Již přítomné pevné názvy `EXACT` se nesmějí ztratit ani změnit. `INFLECT` dovoluje
  skloňování se shodou celé věty. Glosář je přes MCP jen ke čtení.
- Změny čísel a výrazné změny délky dostanou upozornění. Význam a správnost
  skloňování posuzuje model a člověk; tyto kontroly nejsou důkazem správného překladu.
- Návrhy se vážou k přesné revizi exportu. Současně otevřený druhý klient nesmí
  přepsat novější uložené návrhy; při konfliktu znovu otevři export.
- Import v2 porovná otisky všech nesených polí s aktuálním překladem, včetně polí,
  která AI neměnila. Jakákoli novější odlišná oprava import dokumentu zablokuje.
  Již aplikovaný výsledek je povolen, takže opakování nevytváří další změny.
- Starší Foundry Translate odmítne formát v2. Nepřepisuj číslo verze souboru ani
  neodstraňuj kontrolní otisky. Při konfliktu exportuj aktuální projekt a návrh znovu zkontroluj.
- Změněný text nepřevezme původní lidské ověření. Import zachová historii editoru
  a používá jeho běžné kontroly; nejde o transakci přes celý svět.

## Rozsah a omezení

První verze upravuje pouze text dokumentů. UI překlady jsou z korekturního výstupu
vynechány a glosář se nepřejmenovává. Veřejná komunitní vydání neobsahují anglické
originály, proto jako vstup nestačí. Korekturní výstup importuj ve Foundry;
komunitní editor jej odmítá, aby neobešel kontrolu mezitím změněného překladu.

Kontext je omezen obsahem exportu. Nedostupné dokumenty jsou označené a MCP je
nestahuje z internetu. Vyhledávání je doslovné bez rozlišení velikosti písmen.
Dlouhé okolní odstavce jsou v přehledu zkrácené, jejich úplný text lze vyžádat přes
`get_context`. Samotný odstavec má limit 60 000 znaků. Přesuny mezi odstavci a
změny HTML struktury jsou mimo rozsah.

Celé soukromé exporty ani audit nesdílej jako veřejné vydání; obsahují původní
texty. MCP otevře jen běžné JSON soubory v určeném `input/`, odmítá průchod mimo
složku a symbolické odkazy. Stav a výstupy mají oprávnění pouze pro vlastníka.
Po pádu při ukládání může zůstat soubor `sessions/*.lock`: teprve po zavření všech
klientů jej lze odstranit a export znovu otevřít. Při poškození stavu se návrhy
automaticky nemažou.

## Vývoj a ověření

```sh
npm --prefix apps/polish-mcp run check
```

Testy ověřují i skutečnou inicializaci MCP a celý tok přes stdio klienta.
Sandbox musí povolovat lokální podproces Node. Nástroje jsou postavené na
[oficiálním MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
a sdílejí validátory formátu a odkazů s modulem Foundry.
