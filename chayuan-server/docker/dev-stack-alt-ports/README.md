# dev-stack-alt-ports — 大端口版开发栈

与 `../dev-stack/` 的核心区别：

| | dev-stack | **dev-stack-alt-ports** |
|---|---|---|
| Postgres | 5432 | **35432** |
| Redis    | 6379 | **36379** |
| MinIO    | 9000 / 9001 | **39000 / 39001** |
| Milvus   | 19530 / 9091 | **39530 / 39091** |
| Ollama   | 11434 | **31434** |

适用场景：
* 本机已有系统级 Postgres / Redis / MinIO 跑在标准端口；
* 多个 chayuan 实例想并存（以 `name:` 不同 + .env 中端口不同区分）；
* 安装包默认端口与 `vendor/README.md` 对齐。

## 启动

```bash
cp docker/dev-stack-alt-ports/.env.example docker/dev-stack-alt-ports/.env
# ↑ 编辑 .env，填上自己的密码

docker compose -f docker/dev-stack-alt-ports/docker-compose.yml up -d

# 让 chayuan 一次记下当前端口/凭据
chayuan service recheck
chayuan service info       # 一张表打印所有服务的最终 URL / 用户 / 密码
```

## 与 yaml 联动

`<CHAYUAN_ROOT>/basic_settings.yaml` 中：

```yaml
SQLALCHEMY_DATABASE_URI: postgresql+psycopg2://chayuan:<pwd>@127.0.0.1:35432/chayuan
REDIS_URL: redis://127.0.0.1:36379/0
MINIO_ENDPOINT: 127.0.0.1:39000
MINIO_ACCESS_KEY: chayuan_minio
MINIO_SECRET_KEY: <pwd>
```

> 推荐：把 yaml 字段留空，直接走 `chayuan init --profile prod`，里面会
> 优先读 `runtime.json`（包含 alt 端口）拼出 URI，避免手填。
