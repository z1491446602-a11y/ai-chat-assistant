# Deploy Directory

This directory keeps deployment and packaging materials separated from the app
source code.

## Layout

- `server/`
  - Alibaba Cloud and server deployment files.
  - Typical files:
    - `DEPLOY_ALIYUN.md`
    - `hello-kitty-chat.service`
    - `nginx.conf`

Legacy APK and WebView shell materials were extracted to the sibling
`聊天ai旧APK材料/` directory and are not part of this project's release tree.

## Rules

- Put server deployment files in `deploy/server/`.
- Do not place deployment archives in this folder. Old archives belong in
  `workspace-artifacts/deploy-archives/`.
