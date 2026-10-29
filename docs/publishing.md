# 发布到 Chrome Web Store（API/CLI 方式）

本项目用 `scripts/publish.mjs`（零依赖，Node 24 + 官方 REST API）上传并发布，凭据只从本地 `.env` 读取，绝不入库。

## 一、一次性 OAuth 配置（只做一次，产出 3 个值）

Chrome Web Store API 需要你用自己的 Google 账号建一套 OAuth 凭据：

1. 打开 Google Cloud Console，新建或选一个项目。
2. 「API 和服务 → 库」里启用 **Chrome Web Store API**。
3. 「OAuth 同意屏幕」配置为 **External**，发布/测试状态随意（自用加自己为测试用户即可）。
4. 「凭据 → 创建凭据 → OAuth 客户端 ID」，类型选 **桌面应用（Desktop app）**，得到 `client_id` 与 `client_secret`。
5. 用它换 `refresh_token`：
   - 浏览器打开（把 CLIENT_ID 换成你的）：
     `https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&access_type=offline&prompt=consent&redirect_uri=urn:ietf:wg:oauth:2.0:oob&client_id=CLIENT_ID`
   - 若 `oob` 被拒，桌面应用客户端也可用 `redirect_uri=http://localhost` 后从回跳地址里取 `code`。
   - 授权后拿到 `code`，用它换 refresh_token：
     ```sh
     curl -s https://oauth2.googleapis.com/token \
       -d client_id=CLIENT_ID -d client_secret=CLIENT_SECRET \
       -d code=THE_CODE -d grant_type=authorization_code \
       -d redirect_uri=urn:ietf:wg:oauth:2.0:oob
     ```
   - 响应里的 `refresh_token` 即所需值。

把三个值填进 `.env`（照 `.env.example`）：
```
CWS_CLIENT_ID=...
CWS_CLIENT_SECRET=...
CWS_REFRESH_TOKEN=...
CWS_EXTENSION_ID=        # 新建条目留空；首次发布后回填
CWS_PUBLISH_TARGET=default
```

## 二、发布

```sh
npm run package        # 构建 dist 并打成 release/loupe-<version>.zip
npm run publish:draft  # 首次：上传成草稿，不发布（先去后台补素材/隐私政策）
npm run publish        # 补齐后：上传并提交发布
```

- 首次 `CWS_EXTENSION_ID` 为空时走「新建条目」，脚本会打印新 `id`，回填到 `.env` 供以后更新。
- 每次发布 `package.json` 的 `version` 必须比线上高。

## 三、后台仍需人工补齐（API 无法替代，缺则审核打回或卡在草稿）

- **隐私政策 URL**：Loupe 读取评论、按登录态执行点赞/回复、可选把摘录发往用户自配 AI 端点，必须提供。
- **商店素材**：至少一张 1280×800 截图、简介、详细描述。
- **Data safety 表单**：如实声明收集/传输/是否出售。
- **权限用途说明**：宽主机权限（可选 `<all_urls>`，用于用户自配 AI 端点）与写操作要讲清。

## 四、合规风险（Loupe 特有，提交前自检）

- 写操作（点赞/回复/发布）须用户显式点击触发，不自动、不批量，否则可能判为垃圾/操纵。
- `bili_jct` 仅在写请求体内即时使用，不存储、不外传——描述与隐私政策据实说明。
- 具体条款以 Chrome Web Store Program Policies 最新版为准。
