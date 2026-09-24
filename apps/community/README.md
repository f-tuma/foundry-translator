# Ember community editor

Soukromá redakce českého Emberu s veřejnými vydáními pro Foundry Translate.
TanStack Start/React tvoří editor. **Weblate spravuje účty, přihlášení, pozvánky,
oprávnění, aktuální překlady a jejich historii. Better Auth se nepoužívá.**

## Nasazení v Dokploy

1. Vytvořte službu Docker Compose z tohoto repozitáře. Cesta k souboru:
   `compose.community.yml`; build context musí zůstat kořen repozitáře.
2. Do Environment vložte hodnoty podle `apps/community/.env.example`.
   Nastavte skutečný SMTP server pro pozvánky a obnovu hesla. Doména je bez
   `https://`; hesla generujte samostatně. Údaje nepatří do Gitu.
3. Doménu s HTTPS připojte ke službě **gateway**, port **8080**. Ostatní služby
   nemají veřejné porty. `COMMUNITY_SCHEME=https` a `COMMUNITY_HTTPS=1` ponechte
   pro TLS ukončené na proxy Dokploy. Backend dostává schéma z nastavení gateway,
   nikoliv z libovolné hlavičky návštěvníka.
4. Deploy. První spuštění Weblate vytvoří schéma databáze, účet správce a
   soukromý projekt `ember-cs`. Počkejte, až bude kontejner Weblate healthy.
5. Otevřete `/editor` a přihlaste se nativním účtem Weblate. V menu účtu otevřete
   **Členové a pozvánky**. Překladatelé potřebují tým s rolí **Translate**,
   kontroloři **Review strings**, správci **Administration**.
   Weblate musí mít pro projekt zapnuté translation reviews (výchozí nastavení).

Samotná registrace účtu **neuděluje přístup k projektu**. Správce musí účet pozvat
nebo přidat do týmu. Přístup k projektu musí zůstat Private. Po odebrání členství
API znovu ověří oprávnění; lokálně rozepsané koncepty mohou zůstat v prohlížeči
původního člena. Weblate spravuje i nastavení MFA, reset hesla a délku relace.

Lokální spuštění použije stejný Compose; přidejte vlastní override s portem
`127.0.0.1:3101:8080` pro gateway a nastavte `COMMUNITY_HOST=localhost:3101`,
`COMMUNITY_SCHEME=http`, `COMMUNITY_HTTPS=0`. Produkční SMTP lze při testu nahradit
lokálním Mailpit. Nikdy nenastavujte testovací HTTP profil na veřejné doméně.

## Práce s překladem

1. Ve Foundry exportujte pracovní projekt editoru (`foundry-translate-editorial`)
   nebo balíček překladu (`foundry-translate-bundle`). Správce ho nahraje přes
   **Nahrát export**, zkontroluje náhled a potvrdí import.
2. Import vytvoří nativní komponentu Weblate pro každý dokument. Na prvotní
   zpracování Git souborů může být potřeba chvíli počkat. Stejný import je bezpečné
   zopakovat. Jiný export již existujícího dokumentu se odmítne; nepřepíše opravy.
3. Editor zobrazuje originál a český text po oddílech, chrání Foundry příkazy,
   umožňuje měnit popisky odkazů, hledat napříč dokumenty a ukládá koncept v
   prohlížeči. **Uložit návrh** uloží koncept na server. **Odeslat ke kontrole**
   jej předá reviewerovi. Nezměněný text lze také zahrnout ke kontrole.
4. Jiný člen s rolí Review strings porovná změny, přidá komentář a schválí
   konkrétní revizi. **Sloučit opravy** znovu ověří texty i oprávnění a zapíše
   celou sadu do nativních Weblate Units. Autor nemůže schválit vlastní návrh.
5. Při souběžné změně se zobrazí společný základ, aktuální překlad a návrh.
   Autor musí výslovně porovnat novou verzi; převzetí nového základu zruší
   schválení. Změněný návrh musí znovu projít kontrolou. Žádné tiché přepsání.
6. Správce vytvoří vydání. JSON je neměnný snapshot aktuálně sloučených textů;
   obsahuje i zatím neověřené výchozí překlady, jasně bez ověření. Veřejný seznam
   uvádí počet ověřených oddílů. Návrhy, diskuse, původní textová pole a soukromé
   poznámky glosáře se neexportují. Vydání nelze přepsat stejným označením.
7. Ve Foundry Translate otevřete **Import projektu**. Veřejný formát
   `foundry-translate-community` načte originály z instalace, ověří SHA-256 a
   povolená pole a připraví běžný náhled importu. Značka komunitního ověření je
   importované tvrzení, nikoliv kontrola provedená lokálním uživatelem.

## Rozsah první verze

- Jeden český projekt Ember/Crucible. Úpravy dokumentů, návrhy, diskuse, kontrola,
  atomické slučování, zamčená historie vydání a veřejné stahování.
- Glosář z importu je zatím referenční a pouze ke čtení; pomáhá při opravách textů.
- UI overrides Foundry/Ember/Crucible z pracovního exportu se při importu výslovně
  vynechávají. Dosavadní lokální editor ve Foundry je nadále podporuje.
- Mapování dokumentů používá přesná UUID a shodné zdrojové texty. Upřednostněte
  originály z compendia; export založený na world UUID bude vyžadovat stejná UUID
  v cílovém světě. Nesoulad blokuje import, aplikace identitu neodhaduje.
- Jiná verze původního exportu nebo glosáře vyžaduje samostatný postup migrace.
  První verze záměrně odmítne přepsat rozpracovanou redakci.
- Hledání je bez rozlišení velikosti písmen, přes text. Fuzzy hromadné nahrazování
  z lokálního Foundry editoru zatím není součástí webové redakce.
- Přímé nativní úpravy ve Weblate jsou možné podle rolí. Způsobí konflikt se
  starými návrhy; export i Foundry import znovu kontrolují příkazy a strukturu.

## Aktualizace a zálohy

Zálohujte **PostgreSQL i svazek `weblate-data`**, který obsahuje lokální Git
repozitáře a Django secret. Snapshot pouze jednoho z nich není úplná záloha.
Pro konzistentní souborovou zálohu zastavte zapisující studio/Weblate; databázový
export udělejte přes `pg_dump`. Zálohy obsahují soukromé originály a účty.

Weblate je připnutý na image 2026.9.1.2 i digest. Rozšíření používá jeho interní
Python API a musí se před upgradem Weblate znovu integračně otestovat. Nedělejte
samostatnou automatickou aktualizaci image. Veřejná vydání mají SHA-256/ETag;
nejde o kryptografický podpis autora. Foundry obsah znovu validuje.

## Vývoj a testy

```sh
npm ci
npm run check
cd apps/community
npm ci
npm run check
npm run build:engine
```

Weblate integrační testy používají vlastní testovací databázi a dočasné Git
repozitáře; spouštějte je na vývojové Compose sestavě:

```sh
docker compose -f compose.community.yml exec weblate /app/venv/bin/python -c \
  'import django; django.setup(); from django.core.management import call_command; call_command("test", "ember_bridge", interactive=False)'
```

Testují soukromý přístup, odebrání členství, CSRF, role, opakování požadavků,
konflikt po nativní úpravě, rollback při selhání druhé jednotky a neměnná veřejná
vydání. TypeScript testy ověřují společný textový adaptér, ochranu příkazů,
zdrojové hashe, komunitní formát a zpětné načtení ve Foundry.
