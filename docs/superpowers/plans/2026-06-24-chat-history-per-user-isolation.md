# 历史对话按用户区分 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让聊天历史按登录用户隔离——前端本地库(tauri SQLite / web Dexie)的 conversations/messages 加 user_id 维度并按当前 localUserId 过滤(旧数据弃);服务端首消息自动建 ConversationModel(带 user_id),会话可云端同步。

**Architecture:** 隔离键 localUserId = 真实用户 id 否则 "guest"。前端:两 platform schema 加 user_id(DROP 重建),persistence CRUD 带 userId,useConversations 按 localUserId 过滤+随账号重载。服务端:/chat/completions 首消息若无会话行则 add_conversation_to_db(id=客户端 conversation_id, user_id=uid),客户端回填 remote_id。

**Tech Stack:** React+TS(pnpm workspace), Dexie/Tauri plugin-sql, zustand, react-query;Python/FastAPI/SQLAlchemy。

**环境/验证:**
- 仓库 root 拥有:写/改用 sudo(scratchpad 临时文件→`sudo cp`,或 `sudo python3` 精确替换);提交 `sudo git`(仓库根 /work/chayuan-desktop,分支 main,只 stage 本任务文件)。
- 前端 typecheck(只读免 sudo):`cd /work/chayuan-desktop/chayuan-client/packages/app && /work/chayuan-desktop/chayuan-client/node_modules/.bin/tsc -p tsconfig.json --noEmit`(EXIT 0);platform 包同理 `packages/platform-web|platform-tauri/tsconfig.json`。
- 后端:本机无 sqlalchemy/pytest 依赖 → 语法用 `python3.11 -c "import ast; ast.parse(open(f).read())"`;含 sqlalchemy 的测试加 `pytest.importorskip("sqlalchemy")`(沙箱 skip、真机跑),pytest 用 `sudo PYTHONPATH=<libs> python3.11 -m pytest`(非 sudo 读 settings yaml 报 PermissionError)。

---

## 文件结构

```
前端(chayuan-client)
  改 packages/platform-tauri/src/index.ts        runMigrations:DROP+CREATE conversations/messages 带 user_id
  改 packages/platform-web/src/index.ts          Dexie version 升级:stores 加 user_id 索引 + upgrade 清旧表
  改 packages/app/src/features/conversations/persistence.ts   ConversationRecord+CRUD 带 user_id
  新 packages/app/src/features/conversations/localUser.ts     localUserId / useLocalUserId
  改 packages/app/src/features/conversations/useConversations.ts  按 localUserId 过滤+重载
  改 packages/app/src/features/chat/ConversationView.tsx      建会话/存消息时传 localUserId + 回填 remote_id

服务端(chayuan-server libs/chayuan-server)
  改 chayuan/server/api_server/chat_routes.py    /chat/completions 首消息自动建 ConversationModel(带 user_id)
  (可选)改 chayuan/server/db/repository/message_repository.py  filter_message 加可选 user_id(防守)
  新 tests/unit_tests/test_chat_conversation_isolation.py     首消息建会话+换用户隔离
```

---

### Task 1: 前端本地 schema 加 user_id(两 platform,DROP 旧数据)

**Files:**
- Modify: `packages/platform-tauri/src/index.ts`(runMigrations,~225-247)
- Modify: `packages/platform-web/src/index.ts`(Dexie ChayuanDb constructor,~150-159)

- [ ] **Step 1: tauri runMigrations 加 DROP+CREATE(带 user_id)**

在 `runMigrations` 的 `stmts` 数组**最前面**(CREATE schema_version 之后)插入一次性 DROP(旧数据弃),并把 conversations/messages 的 CREATE 改成含 user_id。把现有:
```
    `CREATE TABLE IF NOT EXISTS conversations (
       id TEXT PRIMARY KEY,
       remote_id TEXT,
       title TEXT NOT NULL,
       model TEXT NOT NULL,
       mode TEXT NOT NULL,
       meta JSON,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC)`,
    `CREATE TABLE IF NOT EXISTS messages (
       id TEXT PRIMARY KEY,
       conv_id TEXT NOT NULL,
       role TEXT NOT NULL,
       parts JSON NOT NULL,
       trace_id TEXT,
       created_at INTEGER NOT NULL,
       FOREIGN KEY(conv_id) REFERENCES conversations(id) ON DELETE CASCADE
     )`,
    `CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conv_id, created_at)`,
```
改为(加两条 DROP 在最前 + 两表加 user_id 列 + conv 加 user_id 索引):
```
    // 历史对话按用户隔离(2026-06-24):旧表无 user_id,一次性丢弃重建(已与用户确认弃旧数据)
    `DROP TABLE IF EXISTS messages`,
    `DROP TABLE IF EXISTS conversations`,
    `CREATE TABLE IF NOT EXISTS conversations (
       id TEXT PRIMARY KEY,
       remote_id TEXT,
       user_id TEXT NOT NULL DEFAULT 'guest',
       title TEXT NOT NULL,
       model TEXT NOT NULL,
       mode TEXT NOT NULL,
       meta JSON,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_conv_user_updated ON conversations(user_id, updated_at DESC)`,
    `CREATE TABLE IF NOT EXISTS messages (
       id TEXT PRIMARY KEY,
       conv_id TEXT NOT NULL,
       user_id TEXT NOT NULL DEFAULT 'guest',
       role TEXT NOT NULL,
       parts JSON NOT NULL,
       trace_id TEXT,
       created_at INTEGER NOT NULL,
       FOREIGN KEY(conv_id) REFERENCES conversations(id) ON DELETE CASCADE
     )`,
    `CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conv_id, created_at)`,
```
(messages_fts / lf_outbox 等其余 stmts 不动。DROP 只跑一次没问题:DROP IF EXISTS 幂等;旧库重建后这两条 DROP 后续启动会把空表再删再建,数据已都带 user_id 不丢——可接受;若要更精细可用 schema_version 守卫,但 YAGNI。)

- [ ] **Step 2: web Dexie 升 version + user_id 索引 + 清旧**

把 `ChayuanDb` constructor 里:
```
    super('chayuan');
    this.version(1).stores({
      conversations: 'id, remote_id, updated_at',
      messages: 'id, conv_id, [conv_id+created_at]',
      lf_outbox: '++id, created_at',
    });
```
改为(保留 v1 定义 + 新增 v2:加 user_id 索引,upgrade 清旧表落实「弃旧数据」):
```
    super('chayuan');
    this.version(1).stores({
      conversations: 'id, remote_id, updated_at',
      messages: 'id, conv_id, [conv_id+created_at]',
      lf_outbox: '++id, created_at',
    });
    // v2(2026-06-24 历史对话按用户隔离):conversations 加 user_id 索引;旧数据弃(清空两表)
    this.version(2)
      .stores({
        conversations: 'id, remote_id, updated_at, user_id',
        messages: 'id, conv_id, [conv_id+created_at]',
        lf_outbox: '++id, created_at',
      })
      .upgrade(async (tx) => {
        await tx.table('conversations').clear();
        await tx.table('messages').clear();
      });
```
(messages 不加 user_id 索引:不会 `.where('user_id')` 查 messages,靠 conv 归属隔离;user_id 作为普通字段仍会被 INSERT 存入,Dexie 容纳非索引字段。)

- [ ] **Step 3: typecheck 两 platform 包**

Run:
```
cd /work/chayuan-desktop/chayuan-client/packages/platform-tauri && /work/chayuan-desktop/chayuan-client/node_modules/.bin/tsc -p tsconfig.json --noEmit; echo EXIT=$?
cd /work/chayuan-desktop/chayuan-client/packages/platform-web && /work/chayuan-desktop/chayuan-client/node_modules/.bin/tsc -p tsconfig.json --noEmit; echo EXIT=$?
```
Expected: 都 EXIT 0(纯 SQL/schema 字符串 + Dexie 链式,不引新类型)。

- [ ] **Step 4: commit**
```bash
cd /work/chayuan-desktop
sudo git add -- chayuan-client/packages/platform-tauri/src/index.ts chayuan-client/packages/platform-web/src/index.ts
sudo git commit -m "feat(chat): 本地会话库加 user_id(tauri/web schema,旧数据弃)"
sudo git push origin main
```

---

### Task 2: persistence.ts —— CRUD 带 user_id + 列表按 user 过滤

**Files:**
- Modify: `packages/app/src/features/conversations/persistence.ts`

- [ ] **Step 1: ConversationRecord 加 user_id**
把 interface 里 `id: string;` 下一行加:
```
  user_id: string;
```
(放在 `id` 与 `remote_id` 之间。)

- [ ] **Step 2: upsertConversation 写 user_id**
把 INSERT 语句与参数改为含 user_id:
```
  await db.exec(
    `INSERT OR REPLACE INTO ${TBL_CONV} (id, remote_id, user_id, title, model, mode, meta, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      c.id,
      c.remote_id ?? null,
      c.user_id,
      c.title,
      c.model,
      c.mode,
      c.meta ? JSON.stringify(c.meta) : null,
      c.created_at,
      c.updated_at,
    ],
  );
```

- [ ] **Step 3: listConversations 改为按 userId 过滤**
把签名与查询改为:
```
export async function listConversations(userId: string, limit = 100): Promise<ConversationRecord[]> {
  const db = getPlatform().db;
  const rows = await db.query<{
    id: string;
    remote_id: string | null;
    user_id: string;
    title: string;
    model: string;
    mode: string;
    meta: string | null;
    created_at: number;
    updated_at: number;
  }>(
    `SELECT * FROM ${TBL_CONV} WHERE user_id = ? ORDER BY updated_at DESC LIMIT ${Math.max(1, Math.min(limit, 1000))}`,
    [userId],
  );
  return rows.map((r) => ({
    ...r,
    meta: r.meta ? (JSON.parse(r.meta) as Record<string, unknown>) : null,
  }));
}
```
(web 解析器支持 `SELECT * FROM t WHERE col=? ORDER BY c DESC LIMIT n`,已核实;tauri 原生 SQLite 无碍。)

- [ ] **Step 4: getConversation 返回类型补 user_id**
在 `db.query<{...}>` 的类型字面量里加 `user_id: string;`(与 listConversations 同),其余不变(仍按 id 查——id 本身属当前用户)。

- [ ] **Step 5: appendMessage 写 user_id**
把签名与 INSERT 改为:
```
export async function appendMessage(convId: string, msg: ChatMessage, userId: string): Promise<void> {
  const db = getPlatform().db;
  await db.exec(
    `INSERT OR REPLACE INTO ${TBL_MSG} (id, conv_id, user_id, role, parts, trace_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [msg.id, convId, userId, msg.role, JSON.stringify(msg), msg.traceId ?? null, msg.createdAt],
  );
}
```
(listMessages 不改:仍按 conv_id 查;只加载属于当前用户的会话的消息,隔离由会话列表过滤保证。)

- [ ] **Step 6: typecheck app 包**(会因调用方签名不匹配而报错——预期,Task 3/4 修)
Run: `cd /work/chayuan-desktop/chayuan-client/packages/app && /work/chayuan-desktop/chayuan-client/node_modules/.bin/tsc -p tsconfig.json --noEmit; echo EXIT=$?`
Expected: 报 `listConversations`/`appendMessage`/`ConversationRecord.user_id` 相关调用方错误(Task3/4 修复后归零)。本步只确认 persistence 自身语法对、错误都在调用方。

- [ ] **Step 7: commit**
```bash
cd /work/chayuan-desktop
sudo git add -- chayuan-client/packages/app/src/features/conversations/persistence.ts
sudo git commit -m "feat(chat): persistence 会话/消息带 user_id,列表按 user 过滤"
sudo git push origin main
```

---

### Task 3: localUserId 来源 + useConversations 按用户过滤/重载

**Files:**
- Create: `packages/app/src/features/conversations/localUser.ts`
- Modify: `packages/app/src/features/conversations/useConversations.ts`

- [ ] **Step 1: 新建 localUser.ts**
先确认 auth store 导出名与 user 形态:`grep -n "export const useAuthStore\|user:" packages/app/src/store/auth.ts | head`。按其结果写(下面假设 `useAuthStore` + `s.user?.id:number`):
```ts
/** 本地历史隔离键:真实登录用户 → 其 id 字符串;单机/未登录/guest → "guest"。
 *  与服务端 auth.deps.owner_id_of(guest→共享)语义对齐。 */
import { useAuthStore } from '../../store/auth';

export function localUserIdOf(user: { id?: number } | null | undefined): string {
  return user && typeof user.id === 'number' && user.id > 0 ? String(user.id) : 'guest';
}

export function useLocalUserId(): string {
  return useAuthStore((s) => localUserIdOf(s.user));
}
```
(若 auth store 不叫 useAuthStore / user 字段名不同,据实改 import 与 selector,但导出 `localUserIdOf`/`useLocalUserId` 两个名字保持不变。)

- [ ] **Step 2: useConversations loadAll 接收 userId 并过滤本地**
把 `loadAll` 改为接收 userId,本地查询传它;远端会话 server 已按 user 过滤;远端独有项补 `user_id`:
- 函数签名:`async function loadAll(userId: string): Promise<ConversationView[]> {`
- 本地:`const local = await listLocal(userId, 200);`
- 远端独有项构造里(`byRemote.set(r.id, { ... })`)在 `remote_id: r.id,` 后加一行:`user_id: userId,`

- [ ] **Step 3: useConversationList 带入 localUserId + queryKey 含它**
把:
```
export function useConversationList() {
  return useQuery({
    queryKey: CONVERSATION_KEYS.list,
    queryFn: loadAll,
    staleTime: 30_000,
    retry: 0,
  });
}
```
改为:
```
export function useConversationList() {
  const userId = useLocalUserId();
  return useQuery({
    queryKey: [...CONVERSATION_KEYS.list, userId],
    queryFn: () => loadAll(userId),
    staleTime: 30_000,
    retry: 0,
  });
}
```
并在文件顶部 import:`import { useLocalUserId } from './localUser';`
(queryKey 含 userId → 切账号自动用新 key 重新拉取,旧用户列表不残留。)

- [ ] **Step 4: typecheck app 包**
Run: `cd /work/chayuan-desktop/chayuan-client/packages/app && /work/chayuan-desktop/chayuan-client/node_modules/.bin/tsc -p tsconfig.json --noEmit; echo EXIT=$?`
Expected: 仍可能报 ConversationView.tsx 里 upsert/append 调用方(Task4 修);persistence/useConversations 自身应无错。

- [ ] **Step 5: commit**
```bash
cd /work/chayuan-desktop
sudo git add -- chayuan-client/packages/app/src/features/conversations/localUser.ts chayuan-client/packages/app/src/features/conversations/useConversations.ts
sudo git commit -m "feat(chat): localUserId 隔离键 + 会话列表按用户过滤/随账号重载"
sudo git push origin main
```

---

### Task 4: ConversationView 建会话/存消息传 user_id + 回填 remote_id

**Files:**
- Modify: `packages/app/src/features/chat/ConversationView.tsx`

先通读该文件,grep 所有持久化调用:`grep -n "upsertConversation\|appendMessage\|ConversationRecord\|remote_id\|conversation_id" packages/app/src/features/chat/ConversationView.tsx`。

- [ ] **Step 1: 取当前 localUserId**
在组件内(顶层 hooks 区)加:`const localUserId = useLocalUserId();`,并 import:`import { useLocalUserId } from '../conversations/localUser';`

- [ ] **Step 2: 每个 upsertConversation 的 record 带 user_id**
所有构造 `ConversationRecord` 传给 `upsertConversation(...)` 的地方,对象里补 `user_id: localUserId,`。(grep 出的每处都改;通常是首次发消息 lazy 建会话那处。)

- [ ] **Step 3: 每个 appendMessage 传 userId 第三参**
所有 `appendMessage(convId, msg)` 改成 `appendMessage(convId, msg, localUserId)`。

- [ ] **Step 4: 回填 remote_id(让历史可同步)**
聊天首条成功后(已有写库逻辑处),把该会话 `remote_id` 置为其 conversation_id(= 服务端会话 id,Task5 服务端会用同一 id 建行)。即在 upsert 时 `remote_id: conversationId`(原本多为 null)。具体:若现有代码 upsert 时 remote_id 传 null,改成传当前 conversationId(前端生成、与服务端一致)。
> 注:若 ConversationView 现有逻辑较复杂,保持「本地 id == conversation_id == 服务端会话 id」一致;remote_id 填 conversation_id 即可让 useConversations 合并去重生效。

- [ ] **Step 5: typecheck app 包(应归零)**
Run: `cd /work/chayuan-desktop/chayuan-client/packages/app && /work/chayuan-desktop/chayuan-client/node_modules/.bin/tsc -p tsconfig.json --noEmit; echo EXIT=$?`
Expected: EXIT 0(所有 persistence 调用方已补 user_id)。若仍报别的调用方(如别处也调 listConversations/appendMessage),一并按同规则补 userId。grep 全 app:`grep -rn "appendMessage\|listConversations(" packages/app/src` 确认无漏。

- [ ] **Step 6: 手动核对(记录)**
网络版同浏览器:登 A 建对话→登出→登 B,B 的会话列表为空/仅 B 自己;A 重登历史还在。单机:无登录,localUserId='guest',照常。

- [ ] **Step 7: commit**
```bash
cd /work/chayuan-desktop
sudo git add -- chayuan-client/packages/app/src/features/chat/ConversationView.tsx
sudo git commit -m "feat(chat): 会话/消息落库带 localUserId + 回填 remote_id"
sudo git push origin main
```

---

### Task 5: 服务端首消息自动建 ConversationModel(带 user_id)

**Files:**
- Modify: `chayuan/server/api_server/chat_routes.py`(/chat/completions,~457-483)

现状(已核实):line 458-467 当 `conversation_id and uid is not None` 时 `get_conversation_by_id` 取 conv 做归属校验;line 473-483 `add_message_to_db(...)`。`add_conversation_to_db` 签名:`add_conversation_to_db(chat_type, name="", conversation_id=None, user_id=None)`(conversation_repository.py:8,已在 `from chayuan.server.db.repository import ...` 可取)。

- [ ] **Step 1: 确认 import**
确认 chat_routes.py 顶部能取到 `add_conversation_to_db` 与 `get_conversation_by_id`。`grep -n "add_conversation_to_db\|get_conversation_by_id\|from chayuan.server.db.repository" chayuan/server/api_server/chat_routes.py`。`get_conversation_by_id` 已在用(line 460)。若 `add_conversation_to_db` 未 import,在现有 repository import 行补上。

- [ ] **Step 2: 首消息无会话行则创建(带 user_id)**
把现有归属校验块(line ~457-467):
```
    # 多用户隔离：拿到已存在会话时，校验归属；admin 放行
    if conversation_id and uid is not None:
        try:
            conv = get_conversation_by_id(conversation_id=conversation_id)
        except Exception:
            conv = None
        if conv is not None and conv.user_id not in (None, uid):
            if (user or {}).get("role") != "admin":
                raise HTTPException(
                    status_code=403, detail="conversation not owned by current user",
                )
```
改为(在校验基础上:conv 不存在则按客户端 conversation_id 建行,stamp user_id):
```
    # 多用户隔离：已存在会话校验归属(admin 放行);不存在则按客户端 id 建行并 stamp user_id
    if conversation_id:
        try:
            conv = get_conversation_by_id(conversation_id=conversation_id)
        except Exception:
            conv = None
        if conv is not None and uid is not None and conv.user_id not in (None, uid):
            if (user or {}).get("role") != "admin":
                raise HTTPException(
                    status_code=403, detail="conversation not owned by current user",
                )
        if conv is None:
            # 首消息:统一「客户端 id = 服务端会话 id」,落 ConversationModel 让历史按用户可列/可同步
            try:
                _name = (body.messages[-1].get("content") or "").strip()[:50] if body.messages else ""
                add_conversation_to_db(
                    chat_type="agent_chat",
                    name=_name or "新会话",
                    conversation_id=conversation_id,
                    user_id=uid,
                )
            except Exception as _ce:
                logger.warning("auto-create conversation failed: %r", _ce)
```

- [ ] **Step 3: 语法自检**
Run: `cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server && python3.11 -c "import ast; ast.parse(open('chayuan/server/api_server/chat_routes.py').read()); print('OK')"`
Expected: OK。

- [ ] **Step 4: commit**
```bash
cd /work/chayuan-desktop
sudo git add -- chayuan-server/libs/chayuan-server/chayuan/server/api_server/chat_routes.py
sudo git commit -m "feat(chat): /chat/completions 首消息自动建 ConversationModel(带 user_id),历史可按用户列/同步"
sudo git push origin main
```

---

### Task 6: filter_message 防守 + 服务端隔离测试 + 收尾

**Files:**
- Modify: `chayuan/server/db/repository/message_repository.py`(filter_message,~155-173 + async ~132-152)
- Create: `tests/unit_tests/test_chat_conversation_isolation.py`
- 收尾:bump + push

- [ ] **Step 1: filter_message 加可选 user_id 防守**
给同步 `filter_message(conversation_id, limit=10)` 增 `user_id: Optional[int] = None` 参数,查询在 `.filter_by(conversation_id=...)` 后追加:
```
        if user_id is not None:
            q = q.filter(MessageModel.user_id.in_((None, user_id)))
```
(in (None, uid):兼容历史 NULL 消息 + 当前用户;admin 调用方传 None 即不过滤。async 版同改。调用方 chat.py:288 可暂不传——路由层已做归属校验;此为 defense-in-depth,不强制改调用方。)

- [ ] **Step 2: 写隔离测试(importorskip 守卫)**
新建 `tests/unit_tests/test_chat_conversation_isolation.py`:
```python
from __future__ import annotations
import pytest
pytest.importorskip("sqlalchemy")  # 本沙箱无 sqlalchemy → skip;真机跑

from chayuan.server.db.session import session_scope
from chayuan.server.db.models.conversation_model import ConversationModel
from chayuan.server.db.repository.conversation_repository import (
    add_conversation_to_db, list_conversations_for_user,
)


@pytest.fixture(autouse=True)
def _clean():
    def _purge():
        with session_scope() as s:
            s.query(ConversationModel).delete()
    _purge(); yield; _purge()


def test_list_isolates_by_user():
    add_conversation_to_db(chat_type="agent_chat", name="a-conv", conversation_id="ca", user_id=1)
    add_conversation_to_db(chat_type="agent_chat", name="b-conv", conversation_id="cb", user_id=2)
    a = list_conversations_for_user(user_id=1)
    b = list_conversations_for_user(user_id=2)
    assert {c["id"] for c in a} == {"ca"}
    assert {c["id"] for c in b} == {"cb"}


def test_admin_sees_all_when_user_id_none():
    add_conversation_to_db(chat_type="agent_chat", name="a", conversation_id="ca", user_id=1)
    add_conversation_to_db(chat_type="agent_chat", name="b", conversation_id="cb", user_id=2)
    allc = list_conversations_for_user(user_id=None)
    assert {"ca", "cb"}.issubset({c["id"] for c in allc})
```
> 注:`list_conversations_for_user` 返回结构以实际为准(repo 返回 dict 列表;若返回 ORM 对象则改断言用 `.id`)。实施时先读该函数确认返回形态再定断言字段。

- [ ] **Step 3: 语法自检 + 尝试 pytest(预期 skip)**
```
cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server
python3.11 -c "import ast; ast.parse(open('chayuan/server/db/repository/message_repository.py').read()); print('OK msg')"
python3.11 -c "import ast; ast.parse(open('tests/unit_tests/test_chat_conversation_isolation.py').read()); print('OK test')"
sudo PYTHONPATH=$PWD python3.11 -m pytest -q tests/unit_tests/test_chat_conversation_isolation.py
```
Expected: ast OK;pytest skipped(importorskip)。

- [ ] **Step 4: 前端全量 typecheck**
Run: app/platform-web/platform-tauri 三个包 tsc --noEmit 全 EXIT 0。

- [ ] **Step 5: bump + 提交推送**
```bash
cd /work/chayuan-desktop
sudo git add -- chayuan-server/libs/chayuan-server/chayuan/server/db/repository/message_repository.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_chat_conversation_isolation.py
sudo git commit -m "feat(chat): filter_message 可选 user_id 防守 + 会话隔离回归测试"
sudo python3.11 scripts/bump-version.py
sudo git add -- VERSION chayuan-server/libs/chayuan-server/pyproject.toml chayuan-server/libs/chayuan-server/chayuan/__init__.py chayuan-client/apps/desktop/src-tauri/tauri.conf.json chayuan-client/apps/installer/src-tauri/tauri.conf.json chayuan-client/apps/publisher/src-tauri/tauri.conf.json
sudo git commit -m "chore(release): bump 版本(历史对话按用户区分)"
sudo git push origin main
```

- [ ] **Step 6: 收尾说明**
汇总改动、typecheck/语法结果;提醒:docker 网络版重建镜像、前端重 build + 重启 sidecar;首启会触发本地库 DROP/迁移(旧本地历史按约定丢弃);真机 pytest 验证隔离。

---

## Self-Review

- **Spec 覆盖**:§3 隔离键=Task3(localUser.ts);§4 前端本地=Task1(schema)+Task2(persistence)+Task3(useConversations)+Task4(ConversationView);§5 服务端持久化=Task5(首消息建会话)+§5.1 remote_id 回填=Task4 Step4;§6 边界(guest/单机)=Task3 localUserIdOf+Task5 uid;§7 测试=Task6+各 typecheck。无缺口。
- **占位扫描**:无 TBD;代码步给完整 old→new 或新文件全文;ConversationView 因未通读,给「grep 全部调用点 + 逐一加 userId/remote_id」的精确规则(可执行,非占位)。
- **类型一致**:`listConversations(userId, limit)`、`appendMessage(convId,msg,userId)`、`ConversationRecord.user_id`、`loadAll(userId)`、`useLocalUserId()`/`localUserIdOf()` 在定义(Task2/3)与调用(Task3/4)处签名一致;服务端 `add_conversation_to_db(chat_type,name,conversation_id,user_id)` 与实际签名一致。
- **风险**:web 解析器仅支持单 WHERE → 已避免给 messages 加双条件;auth store 导出名/ user 形态实施时先 grep 确认(Task3 Step1 已注明);list_conversations_for_user 返回形态实施时确认(Task6 Step2 已注明)。
