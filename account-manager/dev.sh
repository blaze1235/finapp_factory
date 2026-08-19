#!/bin/bash
# Local dev. Falls back to a local Postgres so the app runs with no Railway
# project attached; set DATABASE_URL yourself to point somewhere else.
cd "$(dirname "$0")"
if [ -z "$DATABASE_URL" ]; then
  export DATABASE_URL=$(railway variables --service Postgres --kv 2>/dev/null | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)
fi
export DATABASE_URL=${DATABASE_URL:-postgres://localhost:5432/am_control}
export SESSION_SECRET=${SESSION_SECRET:-dev-secret-change-me}
export FILES_DIR=${FILES_DIR:-./data/files}
export BACKUP_DIR=${BACKUP_DIR:-./data/backups}
export PORT=${PORT:-3000}
exec node server.js
