# 麒麟V10 ARM 离线安装(kylin-offline）

给**银河麒麟 V10 aarch64（ARM64）**在**无外网**环境下安装 Chayuan 桌面版用。

## 为什么需要这套东西

Chayuan 桌面壳是 **Tauri v2**，编译产物在链接层就绑死 `libwebkit2gtk-4.1.so.0`，
**无法降级到 webkit2gtk-4.0**（那是 Tauri v1 才支持的）。麒麟 V10 若系统没预装
4.1，`dpkg -i chayuan.deb` 就会报：

```
依赖关系不满足：libwebkit2gtk-4.1-0, libayatana-appindicator3-1
```

离线机又没法 `apt install -f` 联网补依赖。解决办法：**在一台联网的麒麟机上把 4.1
这套依赖收集成 arm64 .deb，随发布物带到离线机安装**。

> 关键约束：架构不能混。arm64 的依赖必须在 **arm64 机器**上收集，x86 机器下不到
> 能在麒麟 ARM 上运行的库。

## 两步流程

```
[联网的麒麟V10 aarch64 机器]                    [离线的麒麟V10 aarch64 机器]
        │                                                │
   ./fetch-deps.sh  ──生成──►  deps/*.deb                │
        │                         │                      │
        │              把整个 kylin-offline/ 目录拷过去 ──►  ./install-offline.sh
        │              (含 deps/ 和 Chayuan_*.deb)            装齐依赖 + 主程序
```

### 第 1 步：联网机收集依赖

在**能上网、且软件源里有 `libwebkit2gtk-4.1-0`** 的麒麟 V10 aarch64 机器上：

```bash
cd kylin-offline
# 把要发布的主程序 deb 也放进本目录,传给脚本可让依赖解析最精确:
./fetch-deps.sh Chayuan_2.0.151_arm64.deb
# 或不传,用默认顶层依赖:
# ./fetch-deps.sh
```

产出：`deps/*.deb`（依赖全家桶）+ `deps/manifest.txt`（清单）。

先自检源里有没有 4.1：

```bash
uname -m                                 # 应为 aarch64
apt-cache policy libwebkit2gtk-4.1-0     # Candidate 有版本号才收集得到
```

若 `Candidate: (none)`，换一台有 4.1 源的机器，或给它配上较新的麒麟官方源 /
openKylin 源再跑。

### 第 2 步：离线机安装

把整个 `kylin-offline/` 目录（含 `deps/` 和 `Chayuan_*.deb`）拷到离线麒麟机：

```bash
cd kylin-offline
./install-offline.sh
# 或显式指定主程序:
# ./install-offline.sh Chayuan_2.0.151_arm64.deb
```

脚本会：多遍 `dpkg -i deps/*.deb` 装依赖 → 装主程序 → 校验
`libwebkit2gtk-4.1` 运行库是否就位。全程不联网。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DEPS_DIR` | `./deps` | 依赖 .deb 目录（两个脚本共用） |
| `SKIP_BASE` | `0` | fetch 时设 `1` 跳过 libc6 等系统基础包，减体积（仅在确认离线机基础系统完整时用） |
| `NO_UPDATE` | `0` | fetch 时设 `1` 跳过 `apt-get update` |

## 常见问题

- **fetch 报「没有 libwebkit2gtk-4.1-0 候选」**：这台收集机的源里没有 4.1，换机器或配源。
- **install 后校验说「未找到 libwebkit2gtk-4.1 运行库」**：`deps/` 没收全，回联网机重跑 fetch。
- **托盘图标没显示**：appindicator 没装上，不影响主功能，可后续单独补 `libayatana-appindicator3-1`。
- **x86 机器能跑 fetch 吗**：不建议。要下 arm64 包得 `dpkg --add-architecture arm64` 且配 arm64 源，依赖解析常缺库，远不如在真机上收集稳。

## 与构建端的关系

`build-desktop.sh` 产出 Linux arm64 `.deb` 后，可把本目录连同 `deps/`（若已在 arm64
机上预收集）一起打进 `dist-*/`，形成开箱即用的「麒麟离线安装包」。详见
`build-desktop.sh` 中 `kylin-offline` 相关步骤。
