#!/usr/bin/env bash
# Usage: bash scripts/community-backup.sh /secure/new-backup-dir [Compose options]
# Example options: --env-file .env -p ember -f compose.community.yml
set -Eeuo pipefail
umask 077
if (( $# < 1 )); then
  echo "Usage: $0 NEW_BACKUP_DIR [docker compose options]" >&2
  exit 2
fi
destination=$1
shift
dc=(docker compose "$@")
if [[ -e "$destination" ]]; then
  echo "Backup destination must not already exist." >&2
  exit 2
fi
for service in gateway studio weblate database redis; do
  if [[ -z $("${dc[@]}" ps --status running -q "$service") ]]; then
    echo "Service $service is not running; no services were stopped." >&2
    exit 1
  fi
done
mkdir -m 700 -p -- "$destination"
destination=$(cd -- "$destination" && pwd)
restart=0
cleanup() {
  status=$?
  trap - EXIT
  if (( restart )); then
    "${dc[@]}" up -d --wait --wait-timeout 300 gateway studio weblate redis || status=1
  fi
  if (( status != 0 )); then
    echo "Backup/restart failed. Check service health; an incomplete directory is not a usable backup." >&2
  fi
  exit "$status"
}
trap cleanup EXIT
# Record exact deployed images, without copying container environment/credentials.
for service in gateway studio weblate database redis; do
  container=$("${dc[@]}" ps -q "$service")
  printf '%s ' "$service" >> "$destination/images.txt"
  docker inspect --format '{{.Image}}' "$container" >> "$destination/images.txt"
done
git rev-parse HEAD > "$destination/revision.txt"
restart=1
"${dc[@]}" stop -t 120 gateway studio weblate redis
"${dc[@]}" exec -T database pg_dump -U weblate -d weblate -Fc > "$destination/database.dump"
"${dc[@]}" run --rm --no-deps -T --user 0 --entrypoint tar maintenance \
  -C /restore/weblate -czf - . > "$destination/weblate-data.tar.gz"
"${dc[@]}" run --rm --no-deps -T --user 0 --entrypoint tar maintenance \
  -C /restore/redis -czf - . > "$destination/redis-data.tar.gz"
(
  cd -- "$destination"
  sha256sum database.dump weblate-data.tar.gz redis-data.tar.gz images.txt revision.txt > SHA256SUMS
)
touch "$destination/COMPLETE"
echo "Backup complete: $destination. Restarting services…"
