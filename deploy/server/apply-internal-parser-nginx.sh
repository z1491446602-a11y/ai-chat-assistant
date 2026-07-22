#!/usr/bin/env bash
set -Eeuo pipefail

source_config="/tmp/short-videos-internal.conf"
target_config="/etc/nginx/conf.d/short-videos-5200.conf"
backup_config="${target_config}.bak-$(date +%Y%m%d%H%M%S)"

[[ -f "$source_config" ]]
[[ -f "$target_config" ]]
cp "$target_config" "$backup_config"
install -m 644 "$source_config" "$target_config"

if ! nginx -t; then
  mv -f "$backup_config" "$target_config"
  nginx -t
  exit 1
fi

nginx -s reload
rm -f "$source_config"
echo "NGINX_INTERNAL_PARSER_OK backup=$backup_config"
