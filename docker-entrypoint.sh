#!/bin/sh
# Make sure the data folder is writable, then run the app as an unprivileged user.
set -e
DATA_DIR="${DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  PUID="${PUID:-1000}"
  PGID="${PGID:-1000}"
  mkdir -p "$DATA_DIR"
  chown -R "$PUID:$PGID" "$DATA_DIR"
  exec su-exec "$PUID:$PGID" "$@"
fi
exec "$@"
