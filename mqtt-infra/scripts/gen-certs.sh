#!/usr/bin/env bash
# Generate a self-signed CA + server cert for local Mosquitto TLS.
# Outputs:  mqtt/certs/ca.crt, mqtt/certs/server.crt, mqtt/certs/server.key
# TODO: MQ-03 — replace with a real CA-issued cert before any non-team testing.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERTS_DIR="${DIR}/certs"
mkdir -p "${CERTS_DIR}"
cd "${CERTS_DIR}"

if [[ -f ca.crt && -f server.crt && -f server.key ]]; then
  echo "Certs already exist in ${CERTS_DIR}. Delete them and re-run to regenerate."
  exit 0
fi

# CA
openssl genrsa -out ca.key 4096
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
  -subj "/CN=alzcare-dev-ca" -out ca.crt

# Server
openssl genrsa -out server.key 4096
openssl req -new -key server.key \
  -subj "/CN=localhost" -out server.csr
cat > server.ext <<'EOF'
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1  = 127.0.0.1
EOF
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 825 -sha256 -extfile server.ext

# Tidy
rm -f server.csr server.ext ca.srl
chmod 600 server.key ca.key

echo "Certs written to ${CERTS_DIR}:"
ls -la "${CERTS_DIR}"
