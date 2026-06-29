# 服务版后台 组织/部门/角色/人员 + 数据权限授权 重设计

- 日期: 2026-06-29
- 范围: chayuan-server(服务端) + chayuan-client(网络版后台前端)
- 形态: 仅服务版/网络版(AUTH_REQUIRED=true)。单机版(guest 路径)全程零参与。
- 借鉴: RuoYi(部门树 + 多角色 + 数据权限) + Keycloak(部门/组继承角色)

## 1. 背景与问题

现状(探索结论):

- 用户 `UserModel`: username/email/`role`(单字符串)/is_active, JWT 登录。
- 角色 `RoleModel`(独立表): 角色 = 后台模块 + 前端功能(`app.*`)的开关清单(`modules` JSON)。
  内置 admin/user。一个用户只能挂**一个**角色字符串。
- 知识库授权: 每个 KB 有 visibility(private/public) + owner + grants(给**单个用户** reader/editor)。
- **无任何组织/部门/团队概念**(仅 `TenantCtx` 预留 `tenant_id`，未启用)。
- 迁移用 Alembic;后台已 NiceGUI→React,users/roles 域已迁。

痛点("古怪"的根源):

- 无组织机构树,用户无法归属部门。
- 角色只能管"看哪些功能菜单",不能管"看哪些数据"(无 data scope)。
- 授权只能一个个挑用户,无法按部门/子树/角色批量授权。
- 一个用户只能一个角色。

## 2. 关键决策(已与用户确认)

1. **组织形态**: 顶层多个平级组织(如多个分公司/事业部),每个组织下挂自己的部门树;
   数据**不强隔离**,管理员可跨组织查看。组织与部门是两张独立表、两层概念。
2. **授权客体(全部要)**: ①知识库/知识源访问权 ②后台功能模块权限 ③AI 功能/模型使用权 ④数据可见范围(data scope)。
3. **用户-角色**: 多对多。最终权限 = 所有角色权限的**并集**,数据权限取**最大范围**。
4. **路线**: 原生 RuoYi 式 org-RBAC(扩展现有 RoleModel/KB-ACL,不引入 Casbin、不推翻现有 authz 分层)。
5. 删除一律"有依赖就拦截+提示",不级联删。多来源权限取并集/最大(宁可多给不漏给)。
6. YAGNI: 不做岗位(post);菜单权限维持 module-key 粗粒度,不做按钮级。

## 3. 数据模型

### 新增表

```
organizations  组织(顶层、平级,多个)
  id, name, code(唯一), order_num, status, remark, created_at, updated_at

departments    部门(树,归属一个组织)
  id, org_id→organizations, parent_id→departments(可空),
  ancestors  (祖先路径 "0,1,5", 子树查询用, RuoYi 同款),
  name, order_num, leader_user_id(可空), status, created_at, updated_at

user_roles     用户-角色 多对多
  user_id→users, role_id→roles   PK(user_id, role_id)

dept_roles     部门-角色映射(Keycloak 式: 部门成员自动继承这些角色)
  dept_id→departments, role_id→roles, include_subtree(bool)  PK(dept_id, role_id)

role_scope_depts  角色自定义数据权限的部门集合(仅 data_scope=自定义时用)
  role_id→roles, dept_id→departments   PK(role_id, dept_id)
```

### 改动现有表

```
users   + dept_id→departments(可空, 未分配=null)
        (保留 role 字符串列做"主角色"向后兼容, 与 user_roles 同步)

roles   + data_scope  (int: 1全部 / 2自定义 / 3本部门 / 4本部门及以下 / 5仅本人)
        (保留 modules JSON 不动 = 后台模块 + app.* 功能权)

kb 授权表(现 grants)  从 (kb_id, user_id, role) 泛化为:
        (kb_id, subject_type ∈ {user|role|dept}, subject_id,
         permission ∈ {reader|editor}, include_subtree(bool), granted_by)
        迁移时把存量 user 授权转成 subject_type='user'
```

### Seed/兼容

- 建一个"默认组织 + 根部门",把存量用户挂上去。
- 按 `User.role` 回填 `user_roles`。
- admin 角色 `data_scope=全部`、user 角色 `data_scope=仅本人`。
- 单机版零影响(单机不开 AUTH, 走 guest, 这套表存在但不参与判定)。

## 4. 授权判定语义

核心概念: **有效角色(effective roles) = 直接角色 ∪ 部门链继承角色**。

### 4.1 有效角色

```
effective_roles(user) =
    user_roles(user)                              # 直接挂的角色
  ∪ ⋃ dept_roles(d)  for d in 部门链(user.dept)    # 部门继承(Keycloak式)

部门链(dept) = 自己 + 所有祖先(沿 parent_id 上溯, 用 ancestors 一次查出)
  其中 dept_roles.include_subtree=false 的, 只对该部门直属成员生效, 不向下传
```

→ 同时解决"按部门批量配 AI 功能/模块": 给"华东分公司"挂带视频权限的角色,下面所有人自动继承。

### 4.2 后台模块 / AI 功能权(modules)

```
modules(user) = ⋃ role.modules  over effective_roles
admin 角色 → 展开为 ALL_MODULE_KEYS(全部)
/auth/me/modules、useFeatureAccess、useIsAdmin 全改读 effective_roles, 语义不变只是来源变宽
```

### 4.3 数据可见范围(data_scope) —— 取最大范围

```
scope(user) = max(全部 > 本部门及以下 > 本部门 > 自定义 > 仅本人) over effective_roles
data_scope_dept_ids(user) → 可见部门 id 集合:
   全部        → 不限制(None)
   本部门及以下 → user.dept 及其整棵子树(ancestors LIKE)
   本部门       → user.dept 单个
   自定义       → role_scope_depts 配的部门集合
   仅本人       → 空集(只看自己创建的)
```

第一期先接到后台用户列表 + 用户分析快照;其它列表后续逐个接(共用同一 helper)。

### 4.4 知识库访问权(KB access) —— 取最大权限

```
kb_permission(user, kb) = max(editor > reader) over 命中的 grant:
   subject_type='user' 且 subject_id=user.id
   subject_type='role' 且 role ∈ effective_roles
   subject_type='dept' 且 (dept = user.dept                         # 直属
                          或 dept ∈ user.部门链 且 include_subtree)  # 含子树
   再叠加 KB 自身的 owner / visibility(public 兜底 reader)
```

判定落在现有 `kb_query/authz.py` 的 `kb_access_for(user, kb)` 扩展,不另开一套;
前端授权对话框、后端检索鉴权共用同一判定。

### 4.5 性能

`effective_roles` / `dept_chain` 单次请求内 memoize;`ancestors` 路径让子树查询是一条
`LIKE 'x,%'`,不递归。`kb_access_for` 是检索热路径,改完确认无回退。

## 5. API 设计

全部 `/api/v1/admin/*` admin-only(沿用 `require_role("admin")`)。路由文件只做协议适配,
业务落 repository/service(守分层红线)。

### 组织 organizations

```
GET    /api/v1/admin/orgs
POST   /api/v1/admin/orgs                {name, code, order_num, remark}
PATCH  /api/v1/admin/orgs/{id}
DELETE /api/v1/admin/orgs/{id}           (下有部门/用户则拦)
```

### 部门 departments(树)

```
GET    /api/v1/admin/depts?org_id=                       返回部门树(嵌套)
POST   /api/v1/admin/depts                               {org_id, parent_id, name, order_num, leader_user_id}
PATCH  /api/v1/admin/depts/{id}                          (移动 parent → 级联重算 ancestors 及子孙)
DELETE /api/v1/admin/depts/{id}                          (下有子部门/用户则拦)
GET    /api/v1/admin/depts/{id}/members?include_subtree=&keyword=&page=
PUT    /api/v1/admin/depts/{id}/roles                    {role_ids:[], include_subtree}
```

### 用户(扩展现有 /auth/users)

```
GET    /auth/users?dept_id=&include_subtree=&keyword=&page=   受 data_scope 过滤的分页
POST   /auth/users           body 扩 {dept_id, role_ids:[]}
PATCH  /auth/users/{id}       {email, dept_id}
PUT    /auth/users/{id}/roles  {role_ids:[]}  (同步回 User.role 主角色)
PATCH  /auth/users/{id}/active   (已有)
PATCH  /auth/users/{id}/password (已有)
DELETE /auth/users/{id}      软删(补缺失)
```

### 角色(扩展现有 /api/v1/admin/roles)

```
GET    /api/v1/admin/roles               (+ 模块目录 + data_scope)
POST   /api/v1/admin/roles               body 扩 {data_scope, scope_dept_ids:[]}
PATCH  /api/v1/admin/roles/{name}        (模块 + data_scope + 自定义部门)
DELETE /api/v1/admin/roles/{name}        (内置/有人用则拦, 已有)
```

### 知识库授权(泛化现有 kb-acl)

```
GET    /api/v1/admin/kb-acl/{kbId}/grants                返回全部主体(user/role/dept)
POST   /api/v1/admin/kb-acl/{kbId}/grants                {subject_type, subject_id, permission, include_subtree}
DELETE /api/v1/admin/kb-acl/{kbId}/grants/{subject_type}/{subject_id}
       (setVisibility / setOwner 不变)
```

### 当前用户(扩展现有 /auth/me/modules)

```
GET    /auth/me/modules   增量返回 effective_roles 后的 modules + data_scope, 字段向后兼容
```

契约原则: 全部新增字段可选、向后兼容;前端 `packages/api` 加 `orgs.ts`/`depts.ts`,
扩 `admin.ts`/`roles.ts`/`endpoints.ts(kbAcl)`。

## 6. 界面(ASCII 草图)

后台"用户与权限"组从 `用户 / 角色` 扩成 `组织机构 / 用户 / 角色`;KB 授权对话框升级。

### 组织机构页(新) —— 左组织+部门树, 右部门成员

```
┌── 组织机构 ──────────────────────────────────────────────┐
│ ┌─ 组织/部门 ─────┐ │ 当前: 总公司 / 研发部  [含下级 ▢]      │
│ │ ▼ 总公司         │ │ 搜索成员[____]            [+添加成员] │
│ │   ▼ 研发部 ◀选中 │ │ ┌──────────────────────────────────┐ │
│ │     · 设计组     │ │ │用户名  角色        部门    状态 操作│ │
│ │     · 前端组     │ │ │张三   研发,主管    研发部  正常 ⋯ │ │
│ │   · 销售部       │ │ │李四   研发         研发部  正常 ⋯ │ │
│ │ ▼ 华东分公司     │ │ └──────────────────────────────────┘ │
│ │   · 客服部       │ │ 部门继承角色: [研发] [×]  [配置 ▾]    │
│ │ [+组织][+部门]   │ │ (本部门成员自动获得这些角色的功能权)  │
│ │ [改名][移动][删] │ │                                       │
│ └─────────────────┘ │                                       │
└──────────────────────────────────────────────────────────┘
```

### 用户页(升级) —— 加部门列/部门筛选/多角色

```
部门筛选[全部 ▾] 搜索[____]   席位 18/50      [+ 新建用户]
用户名  邮箱        部门      角色(多)    状态  操作
张三   z@x.com    研发部     研发,主管   正常  编辑 停用 ⋯
新建/编辑对话框: 用户名/邮箱/密码 + 所属部门[树选择] + 角色(可多选)
```

### 角色页(升级) —— 加数据权限范围

```
名称/说明 + 后台/功能模块(原样勾选) +
数据权限范围: ()全部 ()本部门及以下 ()本部门 ()仅本人 ()自定义→[部门勾选树]
```

### 知识库授权对话框(升级 GrantsDialog) —— 主体可选 部门/角色/用户

```
对象类型[部门/角色/用户 ▾] + 选择[树/下拉] + ☑包含下级部门 + 权限(只读/可编辑) [添加]
已授权: 🏢部门·研发部(含下级) 可编辑 / 👥角色·销售 只读 / 👤用户·张三 只读  [移除]
可见性[私有 ▾]  拥有者[张三 ▾]
```

### 复用

部门"树选择器"抽成共享组件 `DeptTreePicker`,用户编辑/角色自定义范围/KB 授权/部门筛选四处共用。

## 7. 分期实施计划

```
P1  数据模型 + 迁移 + 组织/部门 CRUD
    Alembic 建表 + users/roles 改列 + kb grants 泛化; seed 默认组织+回填;
    org/dept repository+service+路由(树构建/ancestors/move 重算);
    验证: pytest schema/CRUD/子树/move 级联

P2  用户多角色 + 部门归属 + 有效角色计算
    user_roles 读写 + User.role 同步; effective_roles(含部门继承)+dept_chain memoize;
    /auth/me/modules 改读; 用户 API 扩 dept_id/role_ids、DELETE 软删、scoped 列表;
    验证: 继承并集/include_subtree/me modules 回归

P3  角色数据权限(data_scope)
    roles API 扩 data_scope+自定义部门; data_scope_dept_ids helper 接后台用户列表/快照;
    验证: 5 档/取最大/自定义集

P4  知识库授权泛化
    kb grants 主体 user/role/dept(+子树) 读写; kb_access_for() 扩展判定(叠加 owner/visibility);
    验证: 三类主体/取最大/子树继承

P5  前端
    packages/api 加 orgs.ts/depts.ts 扩 admin/roles/kbAcl; 共享 DeptTreePicker;
    组织机构页(新)+用户页升级+角色页数据权限+GrantsDialog 升级; AdminPage 注册 tab;
    验证: typecheck + 手动走查

P6  收尾
    AI 功能按部门已由 P2 部门继承覆盖, 无需额外开发;
    端到端: 建组织→建部门→建用户挂部门多角色→按部门授 KB→登录验权;
    文档(放仓库根) + 全量回归
```

## 8. 风险与边界

- 后端 pytest 本机可跑(root conda py312);真机 Postgres 多实例迁移 advisory lock 已有。
- **单机版全程零参与**(guest 路径不碰这些表),每期都要回归单机不崩。
- `kb_access_for` 是检索鉴权热路径,P4 改完确认无性能回退。
- 部门 move(改 parent)级联重算 ancestors 是写操作,量大时稍重;删除一律拦截不级联。
- 多角色/多部门来源权限取并集、data_scope 取最大范围(可后续改严)。
