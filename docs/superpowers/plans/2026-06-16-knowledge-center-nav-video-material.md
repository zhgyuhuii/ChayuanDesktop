# 知识中心导航 + 素材中心 + 视频中心整合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把素材/视频抽到主页左侧「知识中心」可展开父菜单下,素材中心复用现有素材库页,视频中心新建并把图文成片+数字人视频统一网格整合。

**Architecture:** 纯前端。Sidebar 加 children 支持;新建 VideoCenterPage + useUnifiedVideos 把 listVideos(VgVideo) 与 listTasks(DhTaskStatus) 归一为 UnifiedVideo,顶部生成中独立区 + 已完成混排网格 + 来源徽标 + 筛选。

**Tech Stack:** React 19 / TS / @tanstack/react-query / @tanstack/react-router / lucide-react / vitest。仓库 root-owned,编辑用 sudo python heredoc;每次 commit 先 bump 版本。

---

## File Structure

- Modify `packages/app/src/features/shell/Sidebar.tsx` — NavItem 加 children/group;知识中心改可展开父菜单 + 折叠态处理。
- Modify `packages/i18n/src/locales/{zh-CN,en,ja,fr,de,ko}.ts` — nav.knowledgeBase/materials/videos 新 key(zh 主,余 fallback)。
- Modify `packages/app/src/features/shell/page-registry.tsx` — 新增 `/video-generation/videos` 路由;素材库 defaultTitle 改素材中心。
- Modify `packages/app/src/features/video-generation/MaterialLibraryPage.tsx` — H1 素材库→素材中心。
- Create `packages/app/src/features/video-generation/unifiedVideos.ts` — 纯函数 mergeUnifiedVideos + 类型 UnifiedVideo。
- Create `packages/app/src/features/video-generation/unifiedVideos.test.ts` — vitest。
- Create `packages/app/src/features/video-generation/useUnifiedVideos.ts` — react-query hook(条件 3s 轮询)。
- Create `packages/app/src/features/video-generation/VideoCenterPage.tsx` — 统一页。

---

## Task 1: i18n nav keys

**Files:** Modify `packages/i18n/src/locales/zh-CN.ts`(及 en/ja/fr/de/ko)

- [ ] Step1: zh-CN `nav` 块在 `history:` 后加 `knowledgeBase: '知识库', materials: '素材中心', videos: '视频中心',`。
- [ ] Step2: en.ts nav 块加 `knowledgeBase: 'Knowledge Base', materials: 'Materials', videos: 'Videos',`;其余 4 locale 加同 key(值可暂用英文,i18next 缺失走 fallback)。
- [ ] Step3: 提交前 `grep -n "knowledgeBase\|materials:\|videos:" packages/i18n/src/locales/zh-CN.ts` 确认存在。

## Task 2: Sidebar 可展开父菜单

**Files:** Modify `packages/app/src/features/shell/Sidebar.tsx`

- [ ] Step1: NavItem 接口加 `children?: ReadonlyArray<NavItem>; group?: boolean;`。
- [ ] Step2: NAV_ITEMS 把 `{ to:'/kb', labelKey:'nav.knowledge', icon:Library }` 改为:
```ts
{ to: '/kb', labelKey: 'nav.knowledge', icon: Library, group: true, children: [
  { to: '/kb', labelKey: 'nav.knowledgeBase', icon: Library },
  { to: '/video-generation/materials', labelKey: 'nav.materials', icon: FolderOpen },
  { to: '/video-generation/videos', labelKey: 'nav.videos', icon: Video },
] },
```
import 补 `FolderOpen, Video`(lucide)。
- [ ] Step3: 展开态渲染:group 项渲染 toggle 按钮(图标+label+ChevronDown 旋转),state `const [kcOpen,setKcOpen]=React.useState(()=>localStorage.getItem('sidebar.kc.expanded')!=='0')`,toggle 时写 localStorage;展开则 children 缩进(pl-7)渲染,active=location.pathname===child.to,点击走 onNavItem(child.to, child.labelKey, iconKeyFor(child.to))。非 group 项保持原渲染。
- [ ] Step4: 折叠态(collapsed):一级 NAV 当前不渲染(整 nav 在 !collapsed 内)。本期折叠态不加 Popover(收敛风险),保持现状(折叠态无一级入口,与现状一致)。
- [ ] Step5: iconKeyFor 加 `if (path==='/video-generation/materials') return 'folder'; if (path==='/video-generation/videos') return 'video';`。
- [ ] Step6: `cd packages/app && npx tsc --noEmit -p tsconfig.json` 期望 EXIT=0。
- [ ] Step7: commit(bump 版本)。

## Task 3: page-registry 路由 + 素材中心命名

**Files:** Modify `packages/app/src/features/shell/page-registry.tsx`, `MaterialLibraryPage.tsx`

- [ ] Step1: page-registry 素材库块 defaultTitle '素材库'→'素材中心'。
- [ ] Step2: 加 VideoCenterPage lazy import + 路由 `{ pattern:/^\/video-generation\/videos$/, render:()=><VgVideoCenterPage/>, defaultTitle:'视频中心', defaultIcon:'video' }`(VideoCenterPage 在 Task 6 建,先建桩避免悬空——本步先不加路由,留到 Task 6)。本步只改素材命名。
- [ ] Step3: MaterialLibraryPage H1 文本「素材库」→「素材中心」。
- [ ] Step4: tsc 通过 → commit。

## Task 4: mergeUnifiedVideos 纯函数 + 测试(TDD)

**Files:** Create `unifiedVideos.ts` + `unifiedVideos.test.ts`

- [ ] Step1: 写测试 unifiedVideos.test.ts:
```ts
import { describe, it, expect } from 'vitest';
import { mergeUnifiedVideos } from './unifiedVideos';
const vg = [{ video_id:'a', task_id:'ta', title:'图文', path:'/x/final.mp4', duration_ms:1000, width:1080, height:1920, created_at: 2000, params_snapshot:{}, owner_id:null, thumbnail_path:null }] as any;
const dh = { items:[
  { task_id:'d1', state:'complete', progress:100, created_at: 3, name:'数人A', result_path:'/y.mp4', error:'' },
  { task_id:'d2', state:'processing', progress:63, created_at: 1, name:'数人B', result_path:'', error:'' },
]} as any;
it('归一+混排倒序: 已完成按 createdAt 倒序(dh秒→毫秒)', () => {
  const { completed } = mergeUnifiedVideos(vg, dh);
  expect(completed.map((v)=>v.key)).toEqual(['dh:d1','vg:a']); // d1=3000ms > a=2000ms
  expect(completed[0].source).toBe('dh');
});
it('进行中进 active 区', () => {
  const { active } = mergeUnifiedVideos(vg, dh);
  expect(active.map((v)=>v.key)).toEqual(['dh:d2']);
  expect(active[0].progress).toBe(63);
});
it('source 筛选 helper', () => {
  const { completed } = mergeUnifiedVideos(vg, dh);
  expect(completed.filter((v)=>v.source==='vg').length).toBe(1);
});
```
- [ ] Step2: 运行 `cd packages/app && npx vitest run src/features/video-generation/unifiedVideos.test.ts` 期望 FAIL(模块不存在)。
- [ ] Step3: 实现 unifiedVideos.ts:
```ts
import { vgTaskFileUrl, digitalHuman, type VgVideo, type DhTaskStatus } from '@chayuan/api';
export type UnifiedSource = 'vg' | 'dh';
export interface UnifiedVideo {
  key: string; source: UnifiedSource; title: string; fileUrl: string;
  durationMs: number; createdAt: number; width?: number; height?: number;
  state: 'complete'|'processing'|'failed'|'canceled'; progress?: number;
  raw: VgVideo | DhTaskStatus;
}
function fromVg(v: VgVideo): UnifiedVideo {
  const name = v.path.split(/[\\/]/).pop() || `${v.video_id}.mp4`;
  return { key:`vg:${v.video_id}`, source:'vg', title:v.title||'未命名视频',
    fileUrl: vgTaskFileUrl(v.task_id, name, false), durationMs:v.duration_ms||0,
    createdAt:v.created_at||0, width:v.width, height:v.height, state:'complete', raw:v };
}
function fromDh(t: DhTaskStatus): UnifiedVideo {
  const st = (t.state==='complete'||t.state==='failed'||t.state==='canceled') ? t.state : 'processing';
  return { key:`dh:${t.task_id}`, source:'dh', title:t.name||'数字人视频',
    fileUrl: st==='complete' ? digitalHuman.taskFileUrl(t.task_id) : '',
    durationMs:0, createdAt:(t.created_at??0)*1000, state:st,
    progress: st==='processing'?t.progress:undefined, raw:t };
}
export function mergeUnifiedVideos(videos: VgVideo[], dh: { items: DhTaskStatus[] }) {
  const all = [...videos.map(fromVg), ...(dh?.items??[]).map(fromDh)];
  const completed = all.filter((v)=>v.state==='complete').sort((a,b)=>b.createdAt-a.createdAt);
  const active = all.filter((v)=>v.source==='dh' && v.state!=='complete').sort((a,b)=>b.createdAt-a.createdAt);
  return { completed, active };
}
```
- [ ] Step4: vitest run 期望 3 passed。
- [ ] Step5: commit(bump)。

## Task 5: useUnifiedVideos hook(条件轮询)

**Files:** Create `useUnifiedVideos.ts`

- [ ] Step1: 实现:
```ts
import { useQuery } from '@tanstack/react-query';
import { videoGeneration, digitalHuman } from '@chayuan/api';
import { mergeUnifiedVideos } from './unifiedVideos';
export function useUnifiedVideos() {
  const vq = useQuery({ queryKey:['vg.videos',{page:1,page_size:100}],
    queryFn:()=>videoGeneration.listVideos({page:1,page_size:100}), staleTime:30_000 });
  const dq = useQuery({ queryKey:['dh.tasks'], queryFn:digitalHuman.listTasks,
    refetchInterval:(q)=> (q.state.data?.items??[]).some((t)=>t.state!=='complete'&&t.state!=='failed'&&t.state!=='canceled') ? 3000 : false });
  const merged = mergeUnifiedVideos(vq.data?.items??[], dq.data??{items:[]});
  return { ...merged, isLoading:vq.isLoading||dq.isLoading,
    vgError:vq.error as Error|null, dhError:dq.error as Error|null };
}
```
- [ ] Step2: tsc 通过(注意 refetchInterval 回调签名:react-query v5 传 query 对象,用 `q.state.data`)。
- [ ] Step3: commit(bump)。

## Task 6: VideoCenterPage 统一页

**Files:** Create `VideoCenterPage.tsx`;Modify page-registry.tsx 加路由

- [ ] Step1: 建 VideoCenterPage:header(标题视频中心 + card/list 视图切换)+ 筛选 chips(全部/图文成片/数字人,state useState)+「生成中」区(active.length>0 时渲染,每项显 title+progress%或失败,DH 删除按钮)+ 已完成网格(completed 经 chips 过滤,grid card / list)。卡片:video 播放(fileUrl)、来源徽标(右上角 absolute:source==='vg'?'图文成片':'数字人')、下载(getPlatform().fs.saveBinary 经 fetch blob)、删除(vg→videoGeneration.deleteVideo(id,{drop_file:true}) / dh→digitalHuman.deleteTask)、VG 额外「用参数重做」(复制 VideoLibraryPage.onCopyAndRedo 逻辑:patchParams+setStep(7)+navigate /video-generation)。删除后 invalidate 对应 query key(vg.videos / dh.tasks)。
- [ ] Step2: page-registry 加 lazy `const VgVideoCenterPage = React.lazy(()=>import('../video-generation/VideoCenterPage').then((m)=>({default:m.VideoCenterPage})))` + 路由 `{ pattern:/^\/video-generation\/videos$/, render:()=><VgVideoCenterPage/>, defaultTitle:'视频中心', defaultIcon:'video' }`。
- [ ] Step3: `npx tsc --noEmit` EXIT=0 + `npx vitest run`(全绿)。
- [ ] Step4: commit(bump)。

## Task 7: 收尾验证

- [ ] Step1: `cd packages/app && npx tsc --noEmit -p tsconfig.json` EXIT=0。
- [ ] Step2: `npx vitest run src/features/video-generation/unifiedVideos.test.ts` 全绿。
- [ ] Step3: `git -C /work/chayuan-desktop status --short` 确认只动目标文件(忽略 mode-bit 噪音)。
- [ ] Step4: 最终 commit + push origin main;提醒用户重建 desktop + 重启 sidecar 真机验。

---

## Self-Review

- 覆盖:菜单结构(T2)、素材中心命名(T1/T3)、视频中心命名(T1)、统一网格+生成中区(T4-T6)、整合两来源(T4)、来源徽标/筛选/操作(T6)、测试(T4)、typecheck(T7)。
- 无 TODO 占位;折叠态 Popover 明确本期不做(降风险),非黑洞。
- 类型一致:UnifiedVideo / mergeUnifiedVideos / useUnifiedVideos 跨任务签名一致。
