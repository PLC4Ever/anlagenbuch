#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root" >&2
  exit 1
fi

ACTION="${1:-}"
if [[ -z "$ACTION" ]]; then
  echo "usage: $0 <csr|install> --host <hostname-or-ip> [--san-ip <ip>]" >&2
  exit 2
fi
shift || true

HOST=""
SAN_IP=""

CADDYFILE="/etc/caddy/Caddyfile"
CERT_DIR="/etc/caddy/certs"
KEY_PATH="${CERT_DIR}/anlagen-domain.key"
CSR_PATH="${CERT_DIR}/anlagen-domain.csr"
CRT_PATH="${CERT_DIR}/anlagen-domain.crt"

is_ipv4() {
  local ip="$1"
  local a b c d
  if [[ ! "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    return 1
  fi
  IFS='.' read -r a b c d <<<"$ip"
  for octet in "$a" "$b" "$c" "$d"; do
    if ((octet < 0 || octet > 255)); then
      return 1
    fi
  done
  return 0
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --host)
        HOST="${2:-}"
        shift 2
        ;;
      --san-ip)
        SAN_IP="${2:-}"
        shift 2
        ;;
      *)
        echo "unknown argument: $1" >&2
        exit 2
        ;;
    esac
  done
}

validate_host() {
  if [[ -z "$HOST" ]]; then
    echo "--host is required" >&2
    exit 2
  fi
  if [[ "$HOST" =~ : ]]; then
    echo "invalid host" >&2
    exit 2
  fi
  if [[ "$HOST" =~ ^[A-Za-z0-9][A-Za-z0-9.-]{0,253}[A-Za-z0-9]$ ]]; then
    return 0
  fi
  echo "invalid host" >&2
  exit 2
}

validate_san_ip() {
  if [[ -z "$SAN_IP" ]]; then
    return 0
  fi
  if ! is_ipv4 "$SAN_IP"; then
    echo "invalid san ip" >&2
    exit 2
  fi
}

ensure_cert_dir() {
  install -d -m 0750 -o root -g caddy "$CERT_DIR"
}

update_caddyfile() {
  if [[ ! -f "$CADDYFILE" ]]; then
    echo "missing caddyfile: $CADDYFILE" >&2
    exit 1
  fi

  local backup
  backup="$(mktemp /tmp/caddyfile.backup.XXXXXX)"
  cp "$CADDYFILE" "$backup"

  sed -i -E "s#^([[:space:]]*redir https://)[^/{]+(\\{uri\\}[[:space:]]+308[[:space:]]*)\$#\\1${HOST}\\2#" "$CADDYFILE"
  sed -i -E "s#^https://[^[:space:]]+[[:space:]]*\\{#https://${HOST} {#" "$CADDYFILE"

  if grep -Eq '^[[:space:]]*tls[[:space:]]+internal[[:space:]]*$' "$CADDYFILE"; then
    sed -i -E "0,/^[[:space:]]*tls[[:space:]]+internal[[:space:]]*$/s##  tls ${CRT_PATH} ${KEY_PATH}#" "$CADDYFILE"
  elif grep -Eq '^[[:space:]]*tls[[:space:]]+/etc/caddy/certs/anlagen-domain\.crt[[:space:]]+/etc/caddy/certs/anlagen-domain\.key[[:space:]]*$' "$CADDYFILE"; then
    :
  else
    sed -i -E "0,/^[[:space:]]*encode[[:space:]]+gzip[[:space:]]*$/s##  tls ${CRT_PATH} ${KEY_PATH}\\n\\0#" "$CADDYFILE"
  fi

  if ! /usr/bin/caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
    cp "$backup" "$CADDYFILE"
    rm -f "$backup"
    echo "caddy config invalid after update" >&2
    exit 1
  fi

  rm -f "$backup"
}

action_csr() {
  ensure_cert_dir
  local tmp_key tmp_csr san_list
  tmp_key="$(mktemp /tmp/anlagen-domain-key.XXXXXX)"
  tmp_csr="$(mktemp /tmp/anlagen-domain-csr.XXXXXX)"
  trap "rm -f '$tmp_key' '$tmp_csr'" EXIT

  san_list="DNS:${HOST}"
  if [[ -n "$SAN_IP" ]]; then
    san_list="${san_list},IP:${SAN_IP}"
  fi

  /usr/bin/openssl genrsa -out "$tmp_key" 2048 >/dev/null 2>&1
  /usr/bin/openssl req -new -key "$tmp_key" -out "$tmp_csr" -subj "/CN=${HOST}" -addext "subjectAltName = ${san_list}"

  install -o root -g caddy -m 0640 "$tmp_key" "$KEY_PATH"
  install -o root -g root -m 0644 "$tmp_csr" "$CSR_PATH"

  echo "host=${HOST}"
  echo "san_ip=${SAN_IP}"
  echo "csr_path=${CSR_PATH}"
  echo "key_path=${KEY_PATH}"
  cat "$CSR_PATH"
}

action_install() {
  ensure_cert_dir
  if [[ ! -s "$KEY_PATH" ]]; then
    echo "missing private key; run csr first" >&2
    exit 1
  fi

  local tmp_cert cert_pub key_pub san_text subject_text
  tmp_cert="$(mktemp /tmp/anlagen-domain-cert.XXXXXX)"
  trap "rm -f '$tmp_cert'" EXIT
  cat > "$tmp_cert"

  if ! grep -q "BEGIN CERTIFICATE" "$tmp_cert"; then
    echo "certificate pem is empty or invalid" >&2
    exit 2
  fi

  if ! /usr/bin/openssl x509 -in "$tmp_cert" -noout >/dev/null 2>&1; then
    echo "invalid certificate pem" >&2
    exit 2
  fi

  cert_pub="$(
    /usr/bin/openssl x509 -in "$tmp_cert" -pubkey -noout \
      | /usr/bin/openssl pkey -pubin -outform DER \
      | /usr/bin/sha256sum \
      | /usr/bin/awk '{print $1}'
  )"
  key_pub="$(
    /usr/bin/openssl pkey -in "$KEY_PATH" -pubout -outform DER \
      | /usr/bin/sha256sum \
      | /usr/bin/awk '{print $1}'
  )"
  if [[ "$cert_pub" != "$key_pub" ]]; then
    echo "certificate does not match private key" >&2
    exit 2
  fi

  san_text="$(/usr/bin/openssl x509 -in "$tmp_cert" -noout -ext subjectAltName 2>/dev/null || true)"
  if [[ "$san_text" != *"DNS:${HOST}"* && "$san_text" != *"IP Address:${HOST}"* ]]; then
    subject_text="$(/usr/bin/openssl x509 -in "$tmp_cert" -noout -subject 2>/dev/null || true)"
    if [[ "$subject_text" != *"CN = ${HOST}"* && "$subject_text" != *"CN=${HOST}"* ]]; then
      echo "certificate does not match host=${HOST}" >&2
      exit 2
    fi
  fi

  install -o root -g root -m 0644 "$tmp_cert" "$CRT_PATH"
  update_caddyfile
  /usr/bin/systemctl reload caddy

  /usr/bin/curl --silent --fail --insecure --max-time 20 \
    --resolve "${HOST}:443:127.0.0.1" \
    "https://${HOST}/readyz" >/dev/null || true

  echo "host=${HOST}"
  echo "cert_path=${CRT_PATH}"
  echo "key_path=${KEY_PATH}"
  echo "activate=ok"
}

parse_args "$@"
validate_host
validate_san_ip

case "$ACTION" in
  csr)
    action_csr
    ;;
  install)
    action_install
    ;;
  *)
    echo "unknown action: $ACTION" >&2
    exit 2
    ;;
esac
