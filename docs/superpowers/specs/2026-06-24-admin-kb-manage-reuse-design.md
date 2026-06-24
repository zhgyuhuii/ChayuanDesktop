# 管理端知识库管理复用知识中心 —— 设计

- 日期: 2026-06-24
- 状态: 已定稿(用户审过)
- 目标版本: chayuan-client (packages/app)
- 关联记忆: [[project_knowledge_center_nav]] [[project_admin_panel_react_refactor]] [[feedback_reuse_before_build]]

## 1. 背景与目标

管理端后台「知识库管理」当前只能创建 1 类知识源(文档库),而用户侧「知识中心」(`/kb`)
已有支持多类知识源的富创建流程。用户要求:**管理端与知识中心使用同一套界面,只多一层授权**;
并明确「站在架构师角度复用代码、模块化开发是首要考虑」。

### 现状(已核实)

- 用户侧 `/kb` = `kb/KbBoard.tsx` → `kb/create/CreateKbDialog.tsx`(带类型选择的富对话框)。
  - 类型卡片数组 `OPTIONS` 当前 3 类:文档 / 数据库(结构化) / 外部向量库;**图像库被注释隐藏**(PyTorch 顾虑),office 无前端表单。
  - 子表单:`DocumentKbForm` / `VectorKbForm`(内置于 CreateKbDialog);`AddStructuredSourceDialog`(+ `SchemaScopePicker`)由父级经 `onPickStructured` 回调单独开。
- 管理端 React 后台 `AdminPage.tsx` 有三个相关 tab:
  - `kbmanage`(知识库管理)→ `admin/kbmanage/KbManagePage.tsx`:复用 `KbCard` 网格 + 详情(文件/分片 + `GrantsDialog` 授权);「添加知识库」用的是 **`KbAclPage.tsx` 里另写的简版 `CreateKbDialog`(只能建文档)**。
  - `kbacl`(KB 授权)→ `admin/kbacl/KbAclPage.tsx`:表格管 可见性 / owner / 授权,**也内嵌那个简版创建对话框**。
  - `kbcfg`(知识库配置)→ `SchemaForm file="kb_settings"`:与本设计**无关,不动**。
- 后端 5 类全可建(doc 走 `kb.create`;其余走 `POST /knowledge_source/`),授权端点 `kbAcl.*` 齐全。**缺口纯在前端复用**。

### 根因

1. 存在**两个 `CreateKbDialog`**:用户侧富版(3 类、无授权)vs 管理端简版(1 类、文档)——重复实现,管理端因此只有 1 类。
2. 管理端两个页面(`kbmanage` / `kbacl`)高度重叠,且各自内嵌简版创建对话框。

## 2. 用户决策(brainstorming 澄清结果)

- **知识源类型范围**:与用户侧完全一致 = 3 类(文档 / 数据库 / 外部向量库)。图像、office 不纳入。
- **授权接入点**:创建后再授权,复用现有 `GrantsDialog`(共享创建对话框对管理端零改动)。
- **页面整合**:`kbmanage` + `kbacl` 合并为一个「知识库管理」tab。
- **复用方式**:方案 A —— 抽一个自包含 `KbCreateFlow` 包装组件(真·一处真源)。

## 3. 模块结构与文件改动

```
新增
  kb/create/KbCreateFlow.tsx        自包含创建流程包装(核心)。内部管 CreateKbDialog(文档/向量)
                                    + AddStructuredSourceDialog(结构化);对外只暴露干净接口。

迁移
  admin/kbmanage/GrantsDialog.tsx   从 KbAclPage.tsx 抽出(KbAclPage 将删,GrantsDialog 仍要用)。

改动
  kb/KbBoard.tsx                    用户侧:现有 CreateKbDialog + 自管 AddStructuredSourceDialog 两段接线
                                    → 换成单个 <KbCreateFlow/>。外观/行为不变,仅去重接线。
  admin/kbmanage/KbManagePage.tsx   合并页:网格 + 详情(新增 可见性/owner 编辑,吸收自 kbacl)+ KbCreateFlow。
  admin/AdminPage.tsx               删 kbacl tab(AdminTab 类型 / ADMIN_GROUPS / render 三处);
                                    kbcfg 不动;旧 /admin/kbacl 深链显式重定向到 kbmanage。

删除
  admin/kbacl/KbAclPage.tsx         表格页 + 内嵌简版 CreateKbDialog 一并删;
                                    其可见性/owner 编辑逻辑(setVis/setOwner)迁进 KbManagePage 详情。
```

**单一真源**:创建流程只剩 `KbCreateFlow`;授权弹窗只剩 `GrantsDialog`。两端各自只 import 这两个模块,不再各抄接线。后端零改动。

## 4. 合并后的「知识库管理」页(kbmanage)

两态:

### 网格态(默认)
```
+-----------------------------------------------+
| 知识库管理            [刷新] [+ 添加知识库]      |   -> 添加 -> <KbCreateFlow>
+-----------------------------------------------+
| [KbCard] [KbCard] [KbCard] [KbCard]  ...       |   -> 复用 KbCard, knowledgeUniverse.list() 全部 KB
+-----------------------------------------------+
```

### 详情态(点卡片进入)
```
+-----------------------------------------------+
| <- 返回   product_docs  [document]             |
|           可见性[private v]  owner[张三 v] [授权]|   -> 吸收自 kbacl + GrantsDialog
+-----------------------------------------------+
| 文档库 -> 文件列表 / 分片编辑(原 KbManagePage 详情)|
| 非文档 -> "该类型无文件管理,可用上方授权管理权限"   |
+-----------------------------------------------+
```

相比现状新增的仅详情头部一行 **可见性下拉 + owner 下拉**(逻辑搬自 `KbAclPage` 的 `setVis`/`setOwner`,
调 `kbAcl.setVisibility/setOwner`)。网格、文件/分片、`GrantsDialog` 全为既有,原样复用。

## 5. KbCreateFlow 接口

```tsx
interface KbCreateFlowProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreated?(kuId: string, kind: KuKind): void;   // 创建成功;两端各自刷新列表
  initialKind?: KuKind;                            // 可选:直接进某类表单,跳过选择屏
}
```

内部状态机:picker -> 文档/向量走 `CreateKbDialog` 内置表单;结构化切到 `AddStructuredSourceDialog`。
两个子对话框对外完全隐藏。`AddStructuredSourceDialog` 依赖 QueryClient —— 由 `KbCreateFlow`
内部 `useQueryClient` 提供,消费方无需关心。

> 注:`CreateKbDialog` 现有 `onPickStructured` 是它把"结构化"外抛给父级的机制。
> `KbCreateFlow` 内部消费这个回调(自己开 AddStructuredSourceDialog),从而对外屏蔽它。
> 因此 `CreateKbDialog` 本身**保留**(被 KbCreateFlow 包裹),不删。

## 6. 数据流与 API(全部已存在,零后端改动)

```
创建:  KbCreateFlow
        |- 文档     -> kb.create()                        (POST /knowledge_base/)
        |- 向量     -> knowledgeSource.create()            (POST /knowledge_source/)
        |- 结构化   -> knowledgeSource.create() + catalog   (含 SchemaScopePicker 二步选表)
列表:  knowledgeUniverse.list()    (admin 后端自动返回全部 KB)
授权:  kbAcl.list()/grants()/addGrant()/revokeGrant()/setVisibility()/setOwner()
```

## 7. 风险 / 假设 / 不在范围

- **授权覆盖面假设**:`kbAcl.list()` 的 `kbs` 是否含非文档源(src:*)待实现阶段核实。
  详情页「可见性/owner/授权」控件**仅在该 ku 命中 ACL 记录时显示**(`aclByName[name]`),
  与现状 `KbManagePage` 一致;非文档源若后端无 ACL 记录,只显示创建时设的可见性,不强加。
- **图像库 / office**:不纳入。`KbCreateFlow` picker 沿用 `CreateKbDialog` 现有 3 类。
  模块预留扩展点:将来加一类 = 加一个 Form + 一个 picker 选项。
- **旧深链**:`/admin/kbacl` 改为显式重定向到 `kbmanage`(`normTab` 现有兜底是 ->users,体验差)。
- **不做**:任何后端改动;用户侧知识中心视觉重构(仅替换创建接线,外观不变);`kbcfg`。

## 8. 验证计划

- `packages/app` typecheck(`tsc -p tsconfig.json --noEmit`)= 0 error。
- 手动核对:用户侧 `/kb` 创建 3 类仍正常(KbCreateFlow 替换无回归);
  管理端 `/admin/kbmanage` 能创建 3 类、详情可改 可见性/owner、`GrantsDialog` 授权可用;
  `/admin/kbacl` 深链重定向到 kbmanage;`kbcfg` 不受影响。
