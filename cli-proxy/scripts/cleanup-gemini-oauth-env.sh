#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-$SCRIPT_DIR/../.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[cleanup] No .env file found at: $ENV_FILE"
  exit 0
fi

BACKUP_FILE="${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"
cp "$ENV_FILE" "$BACKUP_FILE"

TMP_FILE="$(mktemp "${TMPDIR:-/tmp}/gemini-env-cleanup.XXXXXX")"

awk '
{
  line=$0
  gsub(/^[[:space:]]+/, "", line)
  if (line ~ /^export[[:space:]]+GEMINI_OAUTH_CLIENT_ID[[:space:]]*=/) next
  if (line ~ /^export[[:space:]]+GEMINI_OAUTH_CLIENT_SECRET[[:space:]]*=/) next
  if (line ~ /^GEMINI_OAUTH_CLIENT_ID[[:space:]]*=/) next
  if (line ~ /^GEMINI_OAUTH_CLIENT_SECRET[[:space:]]*=/) next
  print $0
}
' "$ENV_FILE" > "$TMP_FILE"

mv "$TMP_FILE" "$ENV_FILE"

echo "[cleanup] Removed GEMINI_OAUTH_CLIENT_ID / GEMINI_OAUTH_CLIENT_SECRET from: $ENV_FILE"
echo "[cleanup] Backup saved at: $BACKUP_FILE"
