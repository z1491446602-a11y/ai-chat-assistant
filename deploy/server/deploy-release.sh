#!/usr/bin/env bash
set -Eeuo pipefail

release_name="${1:?release name is required}"
archive="/tmp/${release_name}-v1.tgz"
releases_root="/www/wwwroot/chat-app-releases"
app_link="/www/wwwroot/chat-app"
shared_root="/www/wwwroot/chat-app-shared"
previous="$(readlink -f "$app_link")"
node_modules_source="$(readlink -f "$previous/node_modules")"
release="$releases_root/$release_name"
next_link="${app_link}.next"
switched=0

rollback() {
  local exit_code=$?
  if [[ "$switched" == "1" ]]; then
    ln -s "$previous" "$next_link"
    mv -Tf "$next_link" "$app_link"
    systemctl restart hello-kitty-chat.service || true
  fi
  rm -f "$next_link"
  echo "DEPLOY_FAILED rollback=$previous" >&2
  exit "$exit_code"
}
trap rollback ERR

[[ ! -e "$release" ]]
[[ -f "$archive" ]]
[[ -f "$shared_root/.env" ]]
[[ -d "$shared_root/storage" ]]
[[ -d "$node_modules_source" ]]

mkdir -p "$release"
tar -xzf "$archive" -C "$release"
rm -rf "$release/.env" "$release/storage" "$release/data.json" "$release/node_modules"
ln -s "$shared_root/.env" "$release/.env"
ln -s "$shared_root/storage" "$release/storage"
ln -s "$node_modules_source" "$release/node_modules"

[[ -f "$release/server.js" ]]
[[ -f "$release/dist/index.html" ]]
[[ -f "$release/node_modules/express/package.json" ]]

chown -R root:chatapp "$release"
chown -h root:chatapp "$release/.env" "$release/storage" "$release/node_modules"
find "$release" -type d -exec chmod 750 {} +
find "$release" -type f -exec chmod 640 {} +

rm -f "$next_link"
ln -s "$release" "$next_link"
mv -Tf "$next_link" "$app_link"
switched=1
systemctl restart hello-kitty-chat.service

healthy=0
for _ in $(seq 1 20); do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/api/health >/dev/null; then
    healthy=1
    break
  fi
  sleep 1
done
[[ "$healthy" == "1" ]]
[[ "$(readlink -f "$app_link")" == "$release" ]]
[[ "$(systemctl is-active hello-kitty-chat.service)" == "active" ]]

switched=0
trap - ERR
rm -f "$archive"
echo "DEPLOY_OK release=$release previous=$previous"
