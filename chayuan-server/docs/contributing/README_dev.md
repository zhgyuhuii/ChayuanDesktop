# # 察元AI助手服务/开发部署指南
如果您是想要使用源码启动的用户，请直接拉取 master 分支代码


## 1. 初始化开发环境

Langchain-Chatchat 自 0.3.0 版本起，为方便支持用户使用 pip 方式安装部署，以及为避免环境中依赖包版本冲突等问题，
在源代码/开发部署中不再继续使用 requirements.txt 管理项目依赖库，转为使用 Poetry 进行环境管理。

### 1.1 安装 Poetry

> 在安装 Poetry 之前，如果您使用 Conda，请创建并激活一个新的 Conda 环境，例如使用 `conda create -n chayuan python=3.12` 创建一个新的 Conda 环境。

安装 Poetry: [Poetry 安装文档](https://python-poetry.org/docs/#installing-with-pipx)

> [!Note]
> 如果你没有其它 poetry 进行环境/依赖管理的项目，利用 pipx 或 pip 都可以完成 poetry 的安装，

> [!Note]
> 如果您使用 Conda 或 Pyenv 作为您的环境/包管理器，在安装Poetry之后，
> 使用如下命令使 Poetry 使用 virtualenv python environment (`poetry config virtualenvs.prefer-active-python true`)

### 1.2 安装源代码/开发部署所需依赖库

> ⚠ **重要**:`chayuan-server` 还依赖 `libs/chayuan-*/` 下的 11 个 sibling 包(chayuan-modelmgr / chayuan-runtime / chayuan-core / ...)。
> 单独 `poetry install` 不会装这些 sibling 包,会出现 `No module named 'chayuan_modelmgr'` 等错误。
> 推荐**智能安装脚本**,失败会自动诊断 + 提示一键修复:

```shell
# Linux / macOS / WSL —— 智能安装 + 失败自动诊断
bash scripts/install_smart.sh             # 失败时打印诊断
bash scripts/install_smart.sh --auto-fix  # 失败时交互式逐条执行修复

# Windows (PowerShell) —— 同等效果
.\scripts\install_smart.ps1
.\scripts\install_smart.ps1 -AutoFix
```

> **失败自动识别的 10 类典型错误**(详见 `scripts/install_diagnose.py`):
>
> | 类型 | 触发症状 | 一键修复 |
> |---|---|---|
> | `winerror5_dll_lock` | Windows torch DLL 被锁 | 关 Python 进程 → 重装 torch |
> | `torch_broken_install` | `torch.SymInt` 缺失 / `_C.pyd` 加载失败 | 卸载残骸 → 重装 2.4.1 CPU 版 |
> | `missing_chayuan_lib` | `No module named 'chayuan_xxx'` | 跑 install_ai_platform |
> | `pip_network_timeout` | 拉包超时 | 切清华镜像 + 重试 |
> | `missing_msvc_build_tools` | "Visual C++ 14.0 required" | 提示打开下载页 |
> | `missing_python_dev` | `Python.h: No such file` | apt-get install python3-dev |
> | `permission_denied` | `[Errno 13]` | 检查 venv 激活状态 |
> | `ssl_cert_error` | SSL 证书验证失败 | 加 trusted-host + 升级 certifi |
> | `disk_full` | `[Errno 28]` | 清 pip cache |
> | `version_conflict` | "Could not find a version" | 切官方源 + 清缓存 |
>
> 也可以手动跑底层安装(老命令仍有效):

```shell
bash scripts/dev_setup_all.sh                  # Linux/macOS
.\scripts\install_ai_platform.ps1              # Windows
```

> 如果只想手动分步(老用法),仍然可以:

```shell
# 1) 主依赖(chayuan-server 自身的 PyPI 依赖)
cd  Langchain-Chatchat/libs/chayuan-server/
poetry install --with lint,test -E xinference

# 或者从仓库根:
poetry -C libs/chayuan-server install --with lint,test -E xinference

# 2) **必做**:11 个 sibling 包(否则缺 chayuan_modelmgr / chayuan_runtime 等)
bash ../../scripts/install_ai_platform.sh
# Windows:  .\..\..\scripts\install_ai_platform.ps1
```

> [!Important]
> **Windows 装包遇到 `[WinError 5] 拒绝访问 _C.pyd` 怎么办**
>
> 这是 PyTorch 的 `_C.cp312-win_amd64.pyd` 被其他 Python 进程锁住,pip 无法替换。常见原因:
> - VSCode / PyCharm / Jupyter 已激活同一 conda 环境
> - chayuan server 自身正在跑
> - Windows Defender 实时扫描这个 DLL
>
> 修复步骤:
> 1. 关闭所有 Python 进程(任务管理器查 `python.exe` / `pythonw.exe`)
> 2. 临时关闭 Windows Defender 实时保护
> 3. 用 *管理员* 模式重新运行脚本
> 4. 仍不行: `pip uninstall -y torch torchvision torchaudio` 后重装
>
> 我们的脚本已经在最后一步加了 `--upgrade-strategy only-if-needed`,默认情况下不会动已经满足约束的 torch,只装缺失的包。

> [!Important]
> **如果 chayuan 启动报 `AttributeError: module 'torch' has no attribute 'SymInt'`**
>
> 这是 `[WinError 5]` 中断后留下的"半装 torch"残骸 — 目录在但 C 扩展没装全。
>
> 一键修复(Windows PowerShell):
>
> ```powershell
> .\scripts\repair_torch.ps1
> ```
>
> 该脚本会:
> 1. 关闭占用 torch 的 Python 进程
> 2. 卸载 torch / torchvision / torchaudio
> 3. 删 `site-packages\torch*` 残留目录
> 4. 重装 `torch==2.4.1` CPU 版(py312 稳定组合)
> 5. 验证 `torch.SymInt` 与 `torch.distributed` 可用
>
> 我们也在 `chayuan` CLI 加了 `_preflight_check_torch()`,启动时如果检测到这种残骸会
> 直接退出 + 给修复指引,**不再让用户对着 200 行调用栈猜原因**。

> [!Note]
> **Agent 工具的可选依赖（按需安装）**
>
> T1/T2 批次新增的 Agent 工具把第三方 SDK 全部声明为 `optional`，按场景拆到了 `-E` 分组里。
> 缺包时对应工具会返回 `"请 pip install XXX"` 的友好错误，不影响主服务与其它工具。
>
> | 分组 | 装的工具 | 包清单 |
> | :-- | :-- | :-- |
> | `tools-finance` | Yahoo 财经新闻 | `yfinance` |
> | `tools-academic` | Semantic Scholar 学术检索 | `semanticscholar` |
> | `tools-weather` | OpenWeatherMap 海外天气 | `pyowm` |
> | `tools-code` | GitHub / GitLab / StackExchange | `PyGithub`, `python-gitlab`, `stackapi` |
> | `tools-enterprise` | Confluence 企业 Wiki | `atlassian-python-api` |
> | `tools-all` | 以上全部 | 一次装齐 |
>
> 典型用法：
>
> ```shell
> # 只用 GitHub + GitLab 工具
> poetry -C libs/chayuan-server install -E tools-code
>
> # 研发机器上一次装齐
> poetry -C libs/chayuan-server install --with lint,test -E xinference -E tools-all
> ```
>
> 其余「不需要额外 pip」的工具（Lark/企业微信/钉钉/NewsAPI/OpenAPI/Notion/Tavily/Serper/PubMed/HTTP）走内置 httpx，无需安装任何 extra 即可启用。

> [!Note]
> Poetry install 后会在你的虚拟环境中 site-packages 路径下生成一个 `chayuan_server-<version>.dist-info`（或随 PyPI 包名变化）文件夹带有 direct_url.json 文件，这个文件指向你的开发环境

> [!Important]
> **敏感字段的加密主密钥（`CHAYUAN_MASTER_KEY`）**
>
> 从开放平台集成起，`apps.yaml` 里的 `app_secret` 默认走对称加密存储（Fernet / AES-128-CBC）。
> 写入前会加密、读取时解密，若主密钥缺失则降级到明文并打一条 warning（不影响服务可用）。
>
> **生成并设置主密钥**（生产强烈建议）：
>
> ```bash
> export CHAYUAN_MASTER_KEY=$(python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')
> ```
>
> 也可把密钥放在 `CHAYUAN_ROOT/.master.key`（644 会自动降到 600），本机开发够用。主密钥与 `apps.yaml` 是**对应关系**：
> - 丢失主密钥 → 所有已加密 secret 不可解，需要走「面板 → 轮换 secret」重签；
> - 更换主密钥前请先用老 key 把所有 secret 轮换一遍（解密后重新加密）。
>
> 诊断命令：
>
> ```bash
> poetry -C libs/chayuan-server run python -c 'from chayuan.server.shared import secret_store; print(secret_store.status())'
> # => {'enabled': True, 'key_source': 'env'} / 'file:...' / 'none'
> ```

### 1.3 更新开发部署环境依赖库

当开发环境中所需的依赖库发生变化时，一般按照更新主项目目录(`Langchain-Chatchat/libs/chayuan-server/`)下的 pyproject.toml 再进行 poetry update 的顺序执行。

### 1.4 将更新后的代码打包测试

如果需要对开发环境中代码打包成 Python 库并进行测试，可在主项目目录执行以下命令：

```shell
poetry build
```

命令执行完成后，在主项目目录下会新增 `dist` 路径，其中存储了打包后的 Python 库。

## 2. 设置源代码根目录

如果您在开发时所使用的 IDE 需要指定项目源代码根目录，请将主项目目录(`Langchain-Chatchat/libs/chayuan-server/`)设置为源代码根目录。

执行以下命令之前，请先设置当前目录。**数据目录**可以不显式设置——察元会按平台约定给出默认（见下表）：

```shell
cd Langchain-Chatchat/libs/chayuan-server/chayuan

# 可选：显式指定数据目录。不设置时会自动落到 OS 默认路径。
export CHAYUAN_ROOT=/path/to/chayuan_data
```

### 2.1 数据目录（`CHAYUAN_ROOT`）默认值

参考 Poetry / gh CLI / platformdirs 的做法，按下列优先级解析：

1. `$CHAYUAN_ROOT`（显式，任意平台）
2. `$XDG_DATA_HOME/chayuan`（显式设置了 XDG 的用户，跨平台尊重）
3. OS 默认：

   | 平台 | 默认路径 |
   | :-- | :-- |
   | macOS | `~/Library/Application Support/chayuan` |
   | Linux/BSD | `~/.local/share/chayuan`（或 `$XDG_DATA_HOME/chayuan`） |
   | Windows | `%APPDATA%\chayuan`（回退 `~\AppData\Roaming\chayuan`） |

> [!NOTE]
> **没有 cwd fallback**。老版本在未设置环境变量时会把 cwd 当作数据目录，极易导致 yaml 配置被写到意外位置——新版本不再这样做。首次以默认路径启动时，终端会打印 `[chayuan] CHAYUAN_ROOT=... （未设置 $CHAYUAN_ROOT，使用... 默认；...）` 提示当前数据目录在哪。`chayuan user-info` 的输出也会标注路径来源（`[来自 $CHAYUAN_ROOT]` / `[macOS 默认]` / …）。

## 3. 关于 chayuan 配置项

从 `0.3.1` 版本开始，所有配置项改为 `yaml` 文件，具体参考 [Settings](settings.md)。

### 3.1 首次初始化（交互向导，推荐）

```shell
cd libs/chayuan-server
poetry run chayuan init

# 或从仓库根目录执行：
poetry -C libs/chayuan-server run chayuan init
```

默认进入交互式向导，按项目生命周期一步步引导完成：

1. **数据目录** —— 问 `CHAYUAN_ROOT`（默认 `$PWD/chayuan_data`）；已存在非空目录会二次确认。
2. **面板账号** —— 用户名（默认 `admin`）/ 密码（两次确认，PBKDF2-SHA256 存储）/ 端口（默认 8502）/ 登录路径（回车 = 随机 8 位小写字母）。
3. **生成默认模板** —— 子进程带新的 `CHAYUAN_ROOT` 跑 `chayuan init --non-interactive`，在目录下写出所有 yaml + samples 知识库。
4. **写入面板账号** —— 依次调 `chayuan update username/password/port/path` 落到 `basic_settings.yaml`。
5. **环境变量引导** —— 终端打印可直接复制的 `export CHAYUAN_ROOT=...`，并额外写一份 `CHAYUAN_ROOT/activate.sh`（`source` 后自动 export，便于新终端）。
6. **立即启动** —— 默认询问是否 `chayuan start -c` 后台拉起配置面板，日志写到 `CHAYUAN_ROOT/config_panel.out.log`，约 10 秒后即可在浏览器打开登录页。

如果需要脚本化 / CI 场景，可加 `-q/--non-interactive` 跳过向导，按旧行为在当前 `CHAYUAN_ROOT` 下直接生成模板（此时不会写账号、不会启动面板）。

## 4. 初始化知识库

> [!WARNING]
> 这个命令会清空数据库、删除已有的配置文件，如果您有重要数据，请备份。

```shell
cd libs/chayuan-server
poetry run chayuan kb --recreate-vs

# 或从仓库根目录执行：
poetry -C libs/chayuan-server run chayuan kb --recreate-vs
```
如需使用其它 Embedding 模型，或者重建特定的知识库，请查看 `poetry run chayuan kb --help` 了解更多参数。

## 5. 启动服务

```shell
cd libs/chayuan-server
poetry run chayuan start -a

# 或从仓库根目录执行：
poetry -C libs/chayuan-server run chayuan start -a
```

`start` 支持三种独立启动开关：

| 命令 | 说明 | 默认端口 |
| :-- | :-- | :-- |
| `chayuan start --api` | 仅启动后端 API | 62581 |
| `chayuan start -w` / `--webui` | 仅启动对话界面（Streamlit） | 8501 |
| `chayuan start -c` / `--config` | 仅启动配置面板（NiceGUI） | 8502 |
| `chayuan start -a` / `--all` | 三者一起启动 | — |

> [!Note]
> **DB 未就绪时的降级策略（保证配置面板始终可启动）**
>
> - `chayuan start -c`：完全**跳过**数据库初始化（`create_tables / run_migrations / bootstrap_default_admin`）。配置面板只读写 `chayuan_data/` 下的 yaml，与 KB 数据库无关，因此即使 Postgres/MySQL 尚未就绪，也能打开面板去修改 `basic_settings.SQLALCHEMY_DATABASE_URI` 等连接串。
> - `chayuan start -a` / `--api` / `-w`：尝试初始化 DB，失败时只打 warning，**不再中断启动流程**。此时 API/WebUI 涉及 DB 的接口会在运行期报错，但配置面板依然可用，可先进面板修正 DB 配置再 `chayuan start -a` 重启。
> - 面板子页面（知识库管理、MCP、ACL）在 DB 不可达时会显示其自身的错误提示，不影响主配置页的编辑。

如需调用 API，请参考 [API 使用说明](api.md)

## 6. 运维命令（配置面板）

配置面板（NiceGUI）是一个独立应用，主要用来在线编辑 `chayuan_data/` 下的 yaml 配置。所有运维参数都持久化到 `chayuan_data/basic_settings.yaml`，**修改后需要重启 `chayuan start -c` 或 `-a` 才会生效**。

### 6.1 查看状态

```shell
# 同时检查 API / 对话界面 / 配置面板
chayuan status
# 或只查某一项
chayuan status core    # API
chayuan status web     # Streamlit 对话界面
chayuan status config  # NiceGUI 配置面板
```

### 6.2 查看面板信息

```shell
chayuan user-info
```
输出内容：`CHAYUAN_ROOT`、API 地址、对话界面地址、配置面板地址、面板用户名、密码是否已设置（密码本身不展示）。

### 6.3 修改面板账号 / 端口 / 登录路径

```shell
# 带参数直接修改
chayuan update username <新用户名>
chayuan update port <新端口>

# 修改密码（以 PBKDF2-SHA256 加盐散列存储）
# 方式 A：交互输入（两遍一致）
chayuan update password
# 方式 B：位置参数（便捷，但会进入 shell 历史）
chayuan update password <新密码>
# 方式 C：-p / --password 选项
chayuan update password -p <新密码>
# 方式 D：从 stdin 读取（推荐脚本化用法）
echo <新密码> | chayuan update password --stdin

# 修改登录页路径（形如 `/xkjmwpof`，作用类似访问口令）
# 方式 A：不带参数 / 传空 → 随机生成 8 位小写字母
chayuan update path
# 方式 B：显式指定（允许 [a-z0-9_-]{3,32}；login/dashboard/logout/static/_nicegui 为保留词）
chayuan update path <新路径>

# 不带子命令：由 chayuan 引导交互选择要改什么（username / password / port / path）
chayuan update
```

**首次 bootstrap 会自动补全凭据**：无论是 `chayuan init -q`（非交互）还是首次 `chayuan start -c`（检测到 yaml 里 PANEL_* 为空时），都会自动补齐：

| 字段 | 缺失时的默认值 |
| :-- | :-- |
| `PANEL_USERNAME` | `admin` |
| `PANEL_PASSWORD_HASH` | 随机 12 位字母数字 → PBKDF2-SHA256 |
| `PANEL_SESSION_SECRET` | 64 字符十六进制 |
| `PANEL_LOGIN_PATH` | 随机 8 位小写字母 |

生成的**明文初始密码**会写到 `<CHAYUAN_ROOT>/initial_credentials.txt`（`chmod 0600`），同时在终端里高亮打印。类似 MinIO / Keycloak 首次启动的处理方式。**首次登录后务必 `chayuan update password` 改掉并删除该文件**。

交互向导 (`chayuan init`) 一开始就会问账号密码，因此走向导时不会触发 bootstrap；bootstrap 主要覆盖「直接调 `chayuan start -c`、忘了 init」或「`chayuan init -q` 脚本化」的场景，保证 NiceGUI 登录页永远能被登录。

> [!IMPORTANT]
> **所有运维命令都依赖 `CHAYUAN_ROOT` 指向真实的 `chayuan_data/` 目录**。未设置时会回退为"当前工作目录"，会导致读写到错误的 `basic_settings.yaml`。执行前务必：
> ```shell
> export CHAYUAN_ROOT=/path/to/chayuan_data
> ```

### 6.4 配置面板 · 在线编辑 YAML

登录配置面板后，**按「项目生命周期」从上到下**在左侧 rail 导航展开，右侧切换渲染：

| 序号 | 导航项 | 类型 | 说明 |
| :-- | :-- | :-- | :-- |
| ① | 服务监控 | 只读 | 首页：提问/回答/会话 KPI，时间序列（24h/30d/12w/12m 切换），对话类型 / 模型 / 向量库饼图，Top 知识库横道图，反馈分数直方图，星期×小时热力图（近 90 天），文件扩展名分布；图表每 60 秒自动刷新 |
| ② | 数据目录 | 只读 | 当前 `CHAYUAN_ROOT` + yaml 清单 + `export` 引导 |
| ③ | 基础配置 | 可编辑 | `basic_settings.yaml` |
| ④ | 知识库配置 | 可编辑 | `kb_settings.yaml` |
| ⑤ | 模型配置 | 可编辑 | `model_settings.yaml` |
| ⑥ | 工具配置 | 可编辑 | `tool_settings.yaml` |
| ⑦ | Prompt 模板 | 可编辑 | `prompt_settings.yaml` |
| ⑧ | 服务管理 | 动作 | 查看运行时元数据 + 「立即重启」按钮 |

③–⑦ 的「可编辑」页又分「可视化配置」与「原始 YAML」两个子 tab。

左侧 rail **可折叠**：点击侧栏顶部的 `chevron_left` 图标把 240px 宽度收到 64px（仅留图标）；再点一次还原。折叠态每个按钮悬停有 tooltip 显示原文字。

**「② 数据目录」页提供了 `CHAYUAN_ROOT` 的可视化设置**：输入新路径、选择 shell（zsh / bash / fish / sh）、填 rc 文件路径，点「写入 rc 文件」会幂等地追加 / 替换 `export CHAYUAN_ROOT=...`（fish 会自动改写成 `set -x CHAYUAN_ROOT ...`）。**新终端或 `source` 后才生效**；当前运行的服务不会自动切换数据目录。

- **可视化配置**：为常用字段生成表单控件（开关 / 数字 / 下拉 / 文本 / 密码 / 多行文本）。
  - 每个字段标签后会注明 `(即时生效)` 或 `(需重启)`。
  - 点击「保存」后只写回真正发生变化的字段，使用 `ruamel.yaml` **完整保留原有注释与结构**；写入前会在同目录生成 `<文件>.yaml.bak` 备份。
- **原始 YAML**：直接编辑 yaml 全文。保存前做语法校验，通过后原子写入。出于安全考虑，原始 YAML 的改动一律被视为「需重启」。

涉及的文件：`basic_settings.yaml`、`kb_settings.yaml`、`model_settings.yaml`、`tool_settings.yaml`、`prompt_settings.yaml`（无 nacos；缺失文件会在首次保存时创建）。

**哪些字段需要重启**：以 `basic_settings.yaml` 顶部注释为准——`log_verbose` 与 `HTTPX_DEFAULT_TIMEOUT` 为即时生效，其它所有字段与其它所有 yaml 文件的改动默认都需要重启。

**保存后顶部会出现黄色「需要重启」横幅**，右侧有「立即重启」按钮：

- 「立即重启」本质是通过 `chayuan.server.config_panel.restart_helper` 这个**脱离 chayuan 进程组的守护脚本**完成：
  1. 向 `chayuan start` 父进程发送 `SIGTERM`（超时则 `SIGKILL`）；
  2. 以记录下来的原始 `argv` / `cwd` / `env` 重新拉起 chayuan。
- 该机制依赖 `CHAYUAN_ROOT/.chayuan_runtime.json` 中的元数据，`chayuan start` 启动时会自动写入。只在 **通过 `chayuan start` 启动** 时才能使用；如果是直接 `python -m chayuan.server.config_panel.app` 拉起的面板，「立即重启」按钮会提示「未找到运行时元数据」。
- 重启过程大约 10 秒，期间面板页面会断开；等待后刷新浏览器即可。

> 安全：面板不允许在线修改 `PANEL_USERNAME` / `PANEL_PASSWORD_HASH` / `PANEL_SESSION_SECRET` / `PANEL_LOGIN_PATH`——这些必须在服务器上用 CLI（`chayuan update …`）来改，避免页面内错误配置直接踢掉自己的登录态。
