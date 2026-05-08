#!/usr/bin/env bash
# Generate Mosquitto credentials for the dev `backend-bridge` account and
# wire the ACL file from the committed example. Idempotent — run once after
# first clone, or after `git clean` blew away the gitignored files.
#
# Override the password with MQTT_BRIDGE_PASSWORD=… before running.

set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASSWD="$DIR/passwd"
ACL="$DIR/acl"
if [[ -n "${MQTT_BRIDGE_PASSWORD:-}" ]]; then
  PASSWORD="$MQTT_BRIDGE_PASSWORD"
  PASSWORD_SOURCE="from MQTT_BRIDGE_PASSWORD env var"
else
  # No env var supplied — generate a cryptographically random 24-character
  # password. This is printed ONCE below; it is not stored anywhere beyond
  # the passwd file that mosquitto_passwd writes. Save it now.
  PASSWORD="$(openssl rand -base64 18)"
  PASSWORD_SOURCE="auto-generated (save this — it will not be shown again)"
fi

if [[ -f "$PASSWD" && -f "$ACL" ]]; then
  echo "Mosquitto creds already exist at $DIR. Delete passwd / acl and re-run to regenerate."
  exit 0
fi

# mosquitto_passwd lives inside the eclipse-mosquitto image — no host install
# required. The container writes to /m/passwd which maps onto $DIR/passwd.
docker run --rm -v "$DIR:/m" eclipse-mosquitto:2.0.20 \
  mosquitto_passwd -c -b /m/passwd backend-bridge "$PASSWORD" >/dev/null

cp "$DIR/acl.example" "$ACL"

chmod 600 "$PASSWD"

echo "Mosquitto credentials generated:"
echo "  passwd:   $PASSWD  (account: backend-bridge)"
echo "  password: $PASSWORD  [$PASSWORD_SOURCE]"
echo "  acl:      $ACL"
echo
echo "Restart the broker if it's already up: npm run broker:down && npm run broker:up"
