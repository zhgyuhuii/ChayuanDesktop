# 知识库文件列表卡片化 + 服务端分页 + 无限滚动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 知识库详情页文件列表改服务端分页 + 无限滚动;与对话框共存(窄列)时以卡片纵向展示,解决表头错乱/看不全。

**Architecture:** 后端新增 `/knowledge_base/list_files_paged`(page/page_size/keyword,返回 items+total+has_more,内部基于 `get_kb_file_details` 全量过滤切片)。前端新增 `listFilesPaged` API + `useKbFilesPaged`(React Query useInfiniteQuery)+ `FileCard` 组件 + 底部 IntersectionObserver 哨兵;`DocumentKbDetail` 文件列表数据源从 `detail.files` 改为分页查询,KbDetailPage 传 `narrow` 决定卡片 vs 表格。

**Tech Stack:** Python/FastAPI(后端);React + TanStack Query + TypeScript(前端)。后端路径根 `$S=/work/chayuan-desktop/chayuan-server/libs/chayuan-server/chayuan/server/`,测试根 `$T=.../tests/`。前端根 `$C=/work/chayuan-desktop/chayuan-client/`。

**环境/提交约定**:仓库 root 所有 → 写文件用 scratchpad+`sudo cp` 或 `sudo python3 -` 就地改;后端测试 `cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server && sudo PYTHONPATH=. /usr/bin/python3.11 -m pytest -q <file>`;前端 `cd /work/chayuan-desktop/chayuan-client && npm run typecheck`,vitest `node node_modules/vitest/vitest.mjs run <file>`(nvm v22);提交 `sudo git -C /work/chayuan-desktop add <精确文件> && commit`,只 stage 改的文件,**不 push**(控制端统一推),commit body 末尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`;改了程序代码的提交 bump 版本(读 VERSION +1,同步 5 处:VERSION/server pyproject/3 个 tauri.conf)。

---

## File Structure
- 改 `$S/knowledge_base/kb_doc_api.py` — 新增 `list_files_paged(kb, page, page_size, keyword)`。
- 改 `$S/api_server/kb_routes.py` — 新增 `GET /knowledge_base/list_files_paged` 端点(`_require_read`)。
- 新 `$T/unit_tests/test_list_files_paged.py`。
- 改 `$C/packages/api/src/endpoints.ts` — 新增 `listFilesPaged` + 类型。
- 新 `$C/packages/app/src/features/kb/detail/useKbFilesPaged.ts` — 无限滚动 hook。
- 新 `$C/packages/app/src/features/kb/detail/useKbFilesPaged.test.ts` — getNextPageParam 逻辑 vitest。
- 新 `$C/packages/app/src/features/kb/detail/FileCard.tsx` — 文件卡片。
- 改 `$C/packages/app/src/features/kb/detail/DocumentKbDetail.tsx` — 数据源改分页 + narrow 分支渲染卡片/表格 + 服务端 keyword + 哨兵。
- 改 `$C/packages/app/src/features/kb/detail/KbDetailPage.tsx` — 传 `narrow` prop。

---

## Phase A — 后端分页

### Task A1: list_files_paged 函数 + 端点

**Files:** Modify `$S/knowledge_base/kb_doc_api.py`、`$S/api_server/kb_routes.py`;Test `$T/unit_tests/test_list_files_paged.py`

- [ ] **Step 1: 写失败测试** `$T/unit_tests/test_list_files_paged.py`(monkeypatch 掉 KB 查找与文件详情,纯测分页/过滤逻辑):
```python
import chayuan.server.knowledge_base.kb_doc_api as api


def _setup(monkeypatch, files):
    monkeypatch.setattr(api, "validate_kb_name", lambda n: True)
    class _KB: pass
    monkeypatch.setattr(api.KBServiceFactory, "get_service_by_name", staticmethod(lambda n: _KB()))
    monkeypatch.setattr(api, "get_kb_file_details", lambda n: files)


def test_paged_slice_and_has_more(monkeypatch):
    files = [{"file_name": f"f{i}.txt"} for i in range(25)]
    _setup(monkeypatch, files)
    r = api.list_files_paged("kb", page=0, page_size=10, keyword="")
    assert r.code == 200
    assert r.data["total"] == 25
    assert len(r.data["items"]) == 10
    assert r.data["items"][0]["file_name"] == "f0.txt"
    assert r.data["has_more"] is True
    r2 = api.list_files_paged("kb", page=2, page_size=10, keyword="")
    assert len(r2.data["items"]) == 5
    assert r2.data["has_more"] is False


def test_paged_keyword_filter(monkeypatch):
    files = [{"file_name": "答辩状.docx"}, {"file_name": "起诉书.pdf"}, {"file_name": "答辩补充.docx"}]
    _setup(monkeypatch, files)
    r = api.list_files_paged("kb", page=0, page_size=10, keyword="答辩")
    assert r.data["total"] == 2
    assert {i["file_name"] for i in r.data["items"]} == {"答辩状.docx", "答辩补充.docx"}


def test_paged_invalid_kb(monkeypatch):
    monkeypatch.setattr(api, "validate_kb_name", lambda n: False)
    r = api.list_files_paged("kb", page=0, page_size=10, keyword="")
    assert r.code == 403
```

- [ ] **Step 2: 运行确认失败**
Run: `cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server && sudo PYTHONPATH=. /usr/bin/python3.11 -m pytest -q tests/unit_tests/test_list_files_paged.py 2>&1 | tail -15`
Expected: FAIL（AttributeError: list_files_paged）

- [ ] **Step 3: 实现** —— 在 `kb_doc_api.py` 的 `list_files` 函数后新增:
```python
def list_files_paged(
    knowledge_base_name: str,
    page: int = 0,
    page_size: int = 20,
    keyword: str = "",
) -> ListResponse:
    """分页 + 关键词的文件列表。page 从 0 起;keyword 对 file_name 子串(忽略大小写)。

    v1 内部基于 get_kb_file_details 全量再过滤切片(契约即分页);底层 DB 级
    分页作为后续优化。返回 data={items,total,page,page_size,has_more}。
    """
    if not validate_kb_name(knowledge_base_name):
        return ListResponse(code=403, msg="Don't attack me", data=[])
    knowledge_base_name = urllib.parse.unquote(knowledge_base_name)
    kb = KBServiceFactory.get_service_by_name(knowledge_base_name)
    if kb is None:
        return ListResponse(code=404, msg=f"未找到知识库 {knowledge_base_name}", data=[])

    all_docs = get_kb_file_details(knowledge_base_name) or []
    kw = (keyword or "").strip().lower()
    if kw:
        all_docs = [
            d for d in all_docs
            if kw in str((d.get("file_name") if isinstance(d, dict) else getattr(d, "file_name", "")) or "").lower()
        ]
    total = len(all_docs)
    ps = page_size if page_size and page_size > 0 else 20
    pg = page if page and page > 0 else 0
    start = pg * ps
    items = all_docs[start:start + ps]
    return ListResponse(data={
        "items": items, "total": total, "page": pg,
        "page_size": ps, "has_more": start + ps < total,
    })
```

- [ ] **Step 4: 运行确认通过**
Run: 同 Step 2 命令
Expected: PASS（3 passed）

- [ ] **Step 5: 加端点** —— `kb_routes.py`:① 顶部 `from ...kb_doc_api import (...)` 那组里加 `list_files_paged`;② 在 `list_files_endpoint` 之后新增:
```python
@kb_router.get(
    "/list_files_paged", response_model=ListResponse,
    summary="分页+关键词获取知识库文件列表",
)
def list_files_paged_endpoint(
    knowledge_base_name: str,
    page: int = 0,
    page_size: int = 20,
    keyword: str = "",
    user=Depends(require_auth_enabled()),
):
    _require_read(user, knowledge_base_name)
    return list_files_paged(knowledge_base_name, page=page, page_size=page_size, keyword=keyword)
```
(注:不走 `_kb_call`,因为要透传分页参数;`_require_read` 与 list_files 一致。)

- [ ] **Step 6: py_compile + 提交(bump)**
Run: `cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server && sudo /usr/bin/python3.11 -m py_compile chayuan/server/knowledge_base/kb_doc_api.py chayuan/server/api_server/kb_routes.py && echo OK`
然后 bump + 提交两个后端文件 + 测试:`feat(kb): list_files_paged 分页+关键词端点`。

---

## Phase B — 前端数据层

### Task B1: api 客户端 listFilesPaged

**Files:** Modify `$C/packages/api/src/endpoints.ts`

- [ ] **Step 1: 实现** —— 先读 `endpoints.ts` 第 576 行 `listFiles` 看 `http.get` 用法与 `KbFile` 类型。在其后新增类型 + 方法:
```typescript
export interface PagedFiles {
  items: KbFile[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}
```
并在 kb 对象里 listFiles 旁加:
```typescript
  /** 分页 + 关键词列文件 */
  listFilesPaged: (knowledge_base_name: string, page: number, page_size: number, keyword: string) =>
    http.get<PagedFiles>('/knowledge_base/list_files_paged', {
      query: { knowledge_base_name, page, page_size, keyword },
    }),
```
(若 `http.get` 的返回包装是 `{code,data}`,按 `listFiles` 同款解包方式对齐——以现有 listFiles 写法为准。)

- [ ] **Step 2: typecheck**
Run: `cd /work/chayuan-desktop/chayuan-client && npm run typecheck 2>&1 | tail -15`
Expected: 无新增错误
- [ ] **Step 3: 提交**(前端代码,bump)`feat(kb): api listFilesPaged`

### Task B2: useKbFilesPaged 无限滚动 hook

**Files:** Create `$C/packages/app/src/features/kb/detail/useKbFilesPaged.ts`、`useKbFilesPaged.test.ts`

- [ ] **Step 1: 写失败测试**(测纯逻辑 `getNextPageParam`,导出它单独测;不依赖 React)`useKbFilesPaged.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { nextPageParam } from './useKbFilesPaged';

describe('nextPageParam', () => {
  it('returns next page when has_more', () => {
    expect(nextPageParam({ items: [], total: 30, page: 0, page_size: 20, has_more: true })).toBe(1);
  });
  it('returns undefined when no more', () => {
    expect(nextPageParam({ items: [], total: 20, page: 0, page_size: 20, has_more: false })).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**
Run: `cd /work/chayuan-desktop/chayuan-client && node node_modules/vitest/vitest.mjs run packages/app/src/features/kb/detail/useKbFilesPaged.test.ts 2>&1 | tail -15`
Expected: FAIL（找不到 nextPageParam）

- [ ] **Step 3: 实现** `useKbFilesPaged.ts`:
```typescript
import { useInfiniteQuery } from '@tanstack/react-query';
import { kb as kbApi, type PagedFiles } from '@chayuan/api';

const PAGE_SIZE = 20;

/** 纯函数:由上一页响应推下一页 page(无更多则 undefined)。 */
export function nextPageParam(last: PagedFiles): number | undefined {
  return last.has_more ? last.page + 1 : undefined;
}

export function useKbFilesPaged(kbName: string, keyword: string) {
  const q = useInfiniteQuery({
    queryKey: ['kb.files.paged', kbName, keyword],
    enabled: !!kbName,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => kbApi.listFilesPaged(kbName, pageParam as number, PAGE_SIZE, keyword),
    getNextPageParam: nextPageParam,
    staleTime: 30_000,
  });
  const items = (q.data?.pages ?? []).flatMap((p) => p.items);
  const total = q.data?.pages?.[0]?.total ?? 0;
  return {
    items,
    total,
    fetchNextPage: q.fetchNextPage,
    hasNextPage: !!q.hasNextPage,
    isFetchingNextPage: q.isFetchingNextPage,
    isLoading: q.isLoading,
    refetch: q.refetch,
  };
}
```
(注:`listFilesPaged` 返回若被 http 层解包成 `PagedFiles` 直接用;若包成 `{data: PagedFiles}` 则 queryFn 里 `.then(r => r.data)` 对齐 B1 实际返回。)

- [ ] **Step 4: 运行确认通过**
Run: 同 Step 2 命令
Expected: PASS（2 passed）
- [ ] **Step 5: 提交**(bump)`feat(kb): useKbFilesPaged 无限滚动 hook`

---

## Phase C — 前端 UI

### Task C1: FileCard 组件

**Files:** Create `$C/packages/app/src/features/kb/detail/FileCard.tsx`

- [ ] **Step 1: 先读现有行组件** —— 读 `DocumentKbDetail.tsx` 里的 `FileRow`(grep `function FileRow` / `const FileRow`),记录它展示的字段(file_name/in_db/doc_count/file_size)和操作按钮组(预览/下载/总结全文/切片/重建/删除)以及对应回调 prop 名,**FileCard 必须复用同一组回调签名**。

- [ ] **Step 2: 实现** `FileCard.tsx`(无独立测试:纯展示组件,靠 typecheck + 真机;复用 KbCard 视觉)。结构:
```tsx
import * as React from 'react';
import { FileText } from 'lucide-react';
import { cn } from '@chayuan/ui';
import type { KbFile } from '@chayuan/api';

export interface FileCardProps {
  file: KbFile;
  selected: boolean;
  canWrite: boolean;
  onToggle: (fileName: string) => void;
  onPreview: (file: KbFile) => void;
  onDownload: (file: KbFile) => void;
  onSummarize?: (fileName: string) => void;
  actions?: React.ReactNode; // 切片/重建/删除等 overflow 操作,由 DocumentKbDetail 传入复用现有按钮
}

function humanSize(n?: number | null): string {
  if (!n || n <= 0) return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

export const FileCard: React.FC<FileCardProps> = ({
  file, selected, canWrite, onToggle, onPreview, onDownload, onSummarize, actions,
}) => {
  const size = humanSize(file.file_size);
  return (
    <div className={cn(
      'flex flex-col gap-1.5 rounded-lg border p-2.5 text-sm transition-colors',
      selected ? 'border-[var(--cy-brand-400)] bg-[var(--cy-brand-50)]' : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] hover:bg-[var(--cy-surface-2)]',
    )}>
      <div className="flex items-start gap-2">
        <input type="checkbox" checked={selected} onChange={() => onToggle(file.file_name)} className="mt-1 flex-shrink-0" />
        <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--cy-text-tertiary)]" />
        <span className="min-w-0 flex-1 break-all font-medium" title={file.file_name}>{file.file_name}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-8 text-[11px] text-[var(--cy-text-tertiary)]">
        <span className={file.in_db ? 'text-emerald-600' : 'text-amber-600'}>{file.in_db ? '已入库' : '未入库'}</span>
        {file.doc_count ? <span>· {file.doc_count} 块</span> : null}
        {size ? <span>· {size}</span> : null}
      </div>
      <div className="flex flex-wrap items-center gap-1 pl-8">
        <button type="button" className="rounded px-1.5 py-0.5 text-[11px] text-[var(--cy-brand-700)] hover:bg-[var(--cy-surface-2)]" onClick={() => onPreview(file)}>预览</button>
        <button type="button" className="rounded px-1.5 py-0.5 text-[11px] text-[var(--cy-brand-700)] hover:bg-[var(--cy-surface-2)]" onClick={() => onDownload(file)}>下载</button>
        {onSummarize ? <button type="button" className="rounded px-1.5 py-0.5 text-[11px] text-[var(--cy-brand-700)] hover:bg-[var(--cy-surface-2)]" onClick={() => onSummarize(file.file_name)}>总结全文</button> : null}
        {actions}
      </div>
    </div>
  );
};
```
(若 `KbFile` 字段名与上面不符,以 `@chayuan/api` 实际类型为准修正;`cn`/CSS 变量沿用项目既有。)

- [ ] **Step 3: typecheck + 提交**(bump)`feat(kb): FileCard 文件卡片组件`

### Task C2: DocumentKbDetail 接入分页/卡片 + KbDetailPage narrow

**Files:** Modify `$C/.../DocumentKbDetail.tsx`、`$C/.../KbDetailPage.tsx`

- [ ] **Step 1: KbDetailPage 传 narrow** —— 在渲染 `<DocumentKbDetail .../>`(约 318-325 行)处加 prop:
```tsx
                  <DocumentKbDetail
                    detail={detail}
                    mine={canWrite}
                    onMutate={onMutate}
                    onToggleCollapse={toggleBody}
                    onSummarizeFile={(f) => { void summaryTurn.startSummary(f); }}
                    narrow={inChatMode && !bodyCollapsed && !chatCollapsed}
                  />
```
并在 `DocumentKbDetail` 的 props 接口加 `narrow?: boolean`。

- [ ] **Step 2: 数据源改分页** —— 在 `DocumentKbDetail` 内:
  - 读取现有 keyword 过滤 state(grep `filter`/`keyword`/`search`),把它接成受控搜索框 + 300ms 防抖后的 `debouncedKeyword`。
  - 用 `const { items, total, fetchNextPage, hasNextPage, isFetchingNextPage } = useKbFilesPaged(detail.meta.name, debouncedKeyword);` 取代原 `detail.files` 作为列表数据源(`filtered` 等本地过滤删除)。
  - 上传/删除/重建等 mutation 的 `onSuccess`/`onMutate` 里追加 `queryClient.invalidateQueries({ queryKey: ['kb.files.paged', detail.meta.name] })`。
- [ ] **Step 3: 渲染分支 + 哨兵** —— 列表区:
```tsx
{narrow ? (
  <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
    {items.map((f) => (
      <FileCard key={f.file_name} file={f} selected={selected.has(f.file_name)}
        canWrite={mine} onToggle={toggleOne} onPreview={handlePreview}
        onDownload={handleDownload} onSummarize={onSummarizeFile ? (fn) => onSummarizeFile(fn) : undefined}
        actions={renderRowActions(f) /* 复用现有切片/重建/删除按钮 */} />
    ))}
    <InfiniteSentinel onHit={fetchNextPage} enabled={hasNextPage && !isFetchingNextPage} />
    {isFetchingNextPage && <div className="py-2 text-center text-[11px] text-[var(--cy-text-tertiary)]">加载中…</div>}
  </div>
) : (
  /* 现有 <table>/<FileRow>,tbody 末尾同样接 <InfiniteSentinel/> 行,数据改用 items */
)}
```
  - 新增轻量 `InfiniteSentinel`(可内联同文件):`useEffect` 里 `IntersectionObserver` 观察一个 ref div,进入视口且 `enabled` 时调 `onHit()`;`root` 用最近的 `overflow-y-auto` 容器(传 ref 或用 `null`=viewport,窄列容器内需指定 root,实测调整)。
  - 顶部加「共 {total} 个文件」。
- [ ] **Step 4: typecheck**
Run: `cd /work/chayuan-desktop/chayuan-client && npm run typecheck 2>&1 | tail -20`
Expected: 无新增错误
- [ ] **Step 5: 提交**(bump)`feat(kb): 文件列表接分页/无限滚动,窄列卡片宽列表格 + narrow 信号`

---

## Phase D — 验证

### Task D1
- [ ] 后端单测:`sudo PYTHONPATH=. /usr/bin/python3.11 -m pytest -q tests/unit_tests/test_list_files_paged.py`(3 passed)+ hook vitest(2 passed)。
- [ ] `npm run typecheck` 全绿。
- [ ] 真机(重建容器/重启 sidecar + 重建 apps/web):窄列共存→卡片纵向、下滑自动加载下一页;宽列→表格+下滑加载;搜索跨页生效;上传/删除后刷新;`list_files`(不分页)其它调用方不受影响。

---

## Self-Review 记录
- **Spec 覆盖**:① 窄列卡片→C2 narrow 分支+C1 FileCard;② 服务端分页→A1;③ 无限滚动→B2 hook+C2 哨兵;④ 服务端 keyword→A1+C2 防抖受控;⑤ 宽列保留表格→C2 非 narrow 分支;⑥ list_files 向后兼容→A1 用新端点不动旧。
- **占位扫描**:UI 集成(C2)依赖读现有 FileRow/keyword,已显式要求实现者先读并复用回调,非占位而是「复用现有」指令;纯逻辑(A1/B2)给了完整代码+测试。
- **类型一致**:`PagedFiles{items,total,page,page_size,has_more}` 在 A1(后端 data)/B1(ts 类型)/B2(nextPageParam 参数)一致;`listFilesPaged(kbName,page,page_size,keyword)` 在 B1 定义、B2 调用一致;`useKbFilesPaged` 返回 `{items,total,fetchNextPage,hasNextPage,isFetchingNextPage}` 在 B2 定义、C2 用一致。
- **已知风险**:http 层解包(`{code,data}` vs 直返)需按现有 listFiles 实际写法对齐(B1/B2 已注明);IntersectionObserver 的 root 在窄列滚动容器内需实测;KbFile 字段名以 `@chayuan/api` 为准。
