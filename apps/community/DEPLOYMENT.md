# Nasazení komunitní redakce

## Dokploy

1. Založte **Docker Compose** projekt z tohoto repozitáře (ne Swarm Stack).
   Compose path: `compose.community.yml`, build context: kořen repozitáře.
2. Environment vyplňte podle kořenového `.env.example`. Nastavte vlastní doménu,
   dva rozdílné náhodné heslové řetězce a skutečné SMTP. `COMMUNITY_HOST` je jen
   hostname, bez protokolu a lomítka. Pro produkci ponechte HTTPS hodnoty.
3. V Domains přidejte doménu pro službu **gateway**, container port **8080**,
   HTTPS a přesměrování HTTP na HTTPS. Nevystavujte studio, Weblate, Redis ani DB.
4. Deploy a ověřte healthy stav všech pěti služeb. První start může několik
   minut připravovat databázi. Konfigurace proxy je součástí image; nejsou potřeba
   bind mounty ze checkoutu, které by další deploy mohl zneplatnit.
5. Přihlaste se správcem, zapněte mu MFA a v **Správa členů a pozvánek** pozvěte
   překladatele a samostatného kontrolora. Projekt `ember-cs` musí zůstat Private.
6. Ověřte skutečné doručení pozvánky a obnovy hesla přes SMTP. Proveďte malý import,
   návrh → schválení jiným účtem → sloučení → vydání → stažení bez přihlášení.
   Ve Foundry otevřete náhled importu se stejnými originály.

Před importem velkého Emberu doporučujeme alespoň 4 GB RAM, 2 CPU a SSD; při
současném Docker buildu je vhodná další paměť. Každý dokument vytváří komponentu
Weblate. Sledování zdraví neprovádí samo obnovu po ztrátě dat.

Kontrola na produkčním kontejneru (testuje i odeslání administrátorského e-mailu):

```sh
docker compose -f compose.community.yml exec -T weblate /app/venv/bin/python -c \
  'import django; django.setup(); from django.core.management import call_command; call_command("check", deploy=True)'
```

Lokální HTTP test může hlásit chybějící secure cookies/HSTS; produkce musí mít
secure cookies a HTTPS redirect. Informační hlášení o externím sběru chyb nebo
nativní záloze Weblate nezaměňujte za chybu aplikace. Záloha níže pokrývá celý
stack, i když Weblate neví o externím plánu zálohování.

## Záloha

Záloha obsahuje soukromé texty, účty a Django secret. Ukládejte ji mimo checkout,
s omezenými právy, šifrovaně i mimo tento server. Uchovávejte také Environment
z Dokploy v bezpečném správci hesel; skript ho záměrně nevypisuje ani neexportuje.

Skript krátce zastaví zápisy a po úspěchu i při chybě se pokusí znovu spustit
služby. Zachová databázi, Git repozitáře i frontu Redis ze stejného okamžiku.
Spouštějte z checkoutu nasazeného projektu a se **stejným Compose project name**,
které používá Dokploy (zjistíte z labels kontejnerů). Cílová složka musí být nová.

```sh
bash scripts/community-backup.sh /srv/backups/ember/2026-09-25 \
  --env-file .env -p YOUR_COMPOSE_PROJECT -f compose.community.yml
```

Úspěšná záloha má `COMPLETE` a `SHA256SUMS`; po každém běhu ověřte stav služeb.
Plánovanou úlohu v Dokploy nastavte na čas mimo redakční práci. Samostatné živé
snapshoty jednotlivých volumes nejsou náhradou za tento konzistentní celek.

## Obnova do nové sestavy

Nejdříve obnovu vyzkoušejte bokem, na privátní testovací doméně. Použijte **nový
Compose project name a prázdné volumes**, přesnou revizi z `revision.txt` a stejné
verze images z `images.txt`. Původní sestavu ani její volumes nemažte. Staré image
uchovávejte v registry/cache; soubor s jejich ID není kopií image.

Následující příklad spouštějte v Bash z odpovídajícího checkoutu. `restore.env`
musí obsahovat správné DB heslo a testovací hostname/SMTP. Při obnově pro test
neposílejte pozvánky reálným členům. Doménu na tuto sestavu směrujte až po kontrole.

```sh
set -e
backup=/srv/backups/ember/2026-09-25
test -f "$backup/COMPLETE"
(cd "$backup" && sha256sum -c SHA256SUMS)
dc=(docker compose --env-file restore.env -p ember-restore -f compose.community.yml)
"${dc[@]}" build
"${dc[@]}" up -d --wait database
# Před obnovou odmítnout databázi, která již obsahuje tabulky.
test "$("${dc[@]}" exec -T database psql -U weblate -d weblate -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")" = 0
"${dc[@]}" exec -T database pg_restore -U weblate -d weblate --exit-on-error --single-transaction < "$backup/database.dump"
for service in weblate redis; do
  volume_path=/restore/weblate
  archive=weblate-data.tar.gz
  if [[ "$service" = redis ]]; then volume_path=/restore/redis; archive=redis-data.tar.gz; fi
  "${dc[@]}" run --rm --no-deps -T --user 0 --entrypoint sh maintenance \
    -c 'test -z "$(ls -A "$1")" && tar -xzf - -C "$1"' sh "$volume_path" < "$backup/$archive"
done
"${dc[@]}" up -d --wait --wait-timeout 300
"${dc[@]}" ps
```

Pomocná služba `maintenance` má vypnutou síť a nezískává přihlašovací údaje.
Její volumes používají `nocopy`, aby obraz Weblate před obnovou nevložil vlastní
výchozí soubory. Selhání ověření zastaví další kroky. Archiv nikdy
nerozbalujte přes existující data. Pokud je potřeba návrat k předchozí verzi,
obnovte celý odpovídající snapshot; samotný downgrade image po migraci nestačí.

Zkontrolujte přihlášení, počty dokumentů/návrhů, text poslední opravy a SHA-256
veřejného JSON před a po obnově. Až pak přepojte doménu. Test opakujte po změně
Weblate/PostgreSQL a průběžně s reálnými zálohami.

Oficiální návody: [Dokploy Compose](https://docs.dokploy.com/docs/core/docker-compose),
[domény](https://docs.dokploy.com/docs/core/docker-compose/domains),
[zálohování Weblate](https://docs.weblate.org/en/latest/admin/backup.html).
