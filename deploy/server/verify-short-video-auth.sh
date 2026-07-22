#!/usr/bin/env bash
set -Eeuo pipefail

shared_env="/www/wwwroot/chat-app-shared/.env"
phone="$(sed -n 's/^ADMIN_PHONE=//p' "$shared_env" | tail -n 1)"
password="$(sed -n 's/^ADMIN_BOOTSTRAP_PASSWORD=//p' "$shared_env" | tail -n 1)"
test -n "$phone"
test -n "$password"

request="$(node -e 'console.log(JSON.stringify({phone: process.argv[1], password: process.argv[2]}))' "$phone" "$password")"
cookie_jar="$(mktemp)"
trap 'rm -f "$cookie_jar"' EXIT

login_status="$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' -c "$cookie_jar" \
  -X POST https://www.koyue.top/api/auth/login \
  -H 'Content-Type: application/json' \
  --data "$request")"
test "$login_status" = "200"

parse_status="$(curl -sS --max-time 90 -o /dev/null -w '%{http_code}' -b "$cookie_jar" \
  -X POST https://www.koyue.top/api/short-videos/parse \
  -H 'Content-Type: application/json' \
  --data '{"platform":"bilibili","url":"https://www.bilibili.com/video/BV1xx411c7mD"}')"

printf 'authenticated-parser-status=%s\n' "$parse_status"
