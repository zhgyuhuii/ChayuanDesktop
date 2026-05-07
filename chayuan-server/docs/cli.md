# chachat —— 察元终端对话客户端

`chachat` 是察元的 CLI 对话工具（类 Claude Code / gcloud 体验）。
它把察元服务端的 `/chat/v2/chat` 流式接口包进一个 REPL，支持：

- **游客直聊** — 服务端 `AUTH_REQUIRED=false` 时无需登录即可开始；
- **OAuth2 Device Code 登录流** — 服务端开启强登录时，CLI 不经手用户密码，
  由浏览器承担真实登录、CLI 轮询拿 token；
- **/model、/kb、/new、/history、/whoami、/login、/logout** 等斜杠命令；
- **SSE 流式打印** —— 模型输出边走边显示；
- 本地凭证 `~/.config/chayuan/cli_credentials.json` 自动 chmod 600。

## 安装

`chachat` 随 `chayuan-server` 一起分发，已注册 console_script：

```bash
pip install 'chayuan-server[cli]'   # 推荐：带 httpx 依赖组合
# 或：
pip install chayuan-server httpx
```

## 快速开始

### 游客模式（AUTH_REQUIRED=false）

```
$ chachat
chachat v0.1.0 · guest · host=http://127.0.0.1:8000 · model=default · kb=none
输入 /help 查看命令，Ctrl-C 中断本轮流式（不退出），/exit 退出。

> 你好
...（模型流式答复）
```

### 需要登录（AUTH_REQUIRED=true）

```
$ chachat --host https://chayuan.example.com
未登录，请在浏览器打开以下链接完成登录：

  https://chayuan.example.com/cli/device?code=4X2T-9HQR

验证码：4X2T-9HQR
CLI 每 3s 轮询中... (Ctrl-C 退出)
```

浏览器中输入用户名 / 密码 → 点击"登录并授权 CLI" → 回到终端，CLI 自动拿到 token
并继续对话。token 落在 `~/.config/chayuan/cli_credentials.json`。

### 可选参数

| 参数 | 说明 |
|------|------|
| `--host URL` | 服务端地址（默认 `http://127.0.0.1:8000`，可用环境变量 `CHACHAT_HOST`） |
| `--model ID` | 预选 LLM，可在 REPL 内 `/model <id>` 切换 |
| `--kb NAME` | 预选知识库，可在 REPL 内 `/kb <name>` 切换 |
| `--no-auth` | 强制游客模式（不做 device flow） |
| `--logout` | 清除本地凭证后退出 |
| `-v / --version` | 打印版本 |

### REPL 内命令

```
/model [id]     切换 LLM；不带参数列可用
/kb [name]      切换知识库；不带参数列可用；/kb off 关掉 kb 检索
/new            开一段新 conversation
/history        打印当前会话历史
/whoami         打印登录态
/login          重新登录
/logout         清本地 token
/help, /?       显示帮助
/exit, /quit    退出
```

Ctrl-C 会**中断当前流式回答**但不退出 REPL；再次 Ctrl-C / `/exit` 才退出。

## 观测

`chachat` 每个请求会带 `X-Client: chachat/<ver>`；服务端 metrics 层可按
该 label 区分"来自 CLI 的流量"与其它端。

## 安全要点

- 浏览器登录表单内置 CSRF token，每轮 device flow 一次性绑定；
- token 本地文件权限 `0600`；`--logout` 可快速清除；
- device_code 默认 15 分钟 TTL，拿到 token 后**单次消费**，即使被窃也无法第二次换；
- Redis 可用时 device/token 状态走 Redis；Redis 不可用自动降级进程内字典，
  单 worker dev 可用但多 worker 生产务必配好 Redis。

## 相关路由

| 路由 | 方法 | 用途 |
|------|------|------|
| `/cli/device/start` | POST | CLI 拿 device_code + user_code |
| `/cli/device` | GET  | 浏览器登录页（用户访问） |
| `/cli/device/approve` | POST | 浏览器提交表单 → 绑 token |
| `/cli/device/token` | POST | CLI 轮询换 token |

代码位于 `chayuan/server/api_server/cli_routes.py` 与 `chayuan/tools/cli/chachat.py`。
