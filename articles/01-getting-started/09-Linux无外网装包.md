# 本地离线知识库的最小依赖 Linux下不联外网装包跑通

Linux 上把察元AI 桌面单机版装起来这件事，比 Windows 和 macOS 多一些细节。一来发行版多，glibc 版本差异不可忽视；二来 GUI 应用对 GTK、WebKit 这些底层依赖有要求；三来政企内网经常不开外网，只允许从内部源拿包。这一篇专门给 Linux 用户一份装包流程，覆盖国产化支持下的常见发行版。

先看 chayuan-desktop 在 Linux 上的形态。release 通常会出 deb 包、rpm 包和 AppImage。x86_64 是默认架构，aarch64 在国产化清单里也有。安装包里同样是两段：Tauri 主进程二进制、PyInstaller 打的嵌入式 Python sidecar。

第一步看依赖。在 Ubuntu 22.04 或 Debian 12 上装 deb 包前，确认这几个包齐：libwebkit2gtk-4.1-0、libssl3、libsqlite3-0、ca-certificates、libgtk-3-0、libayatana-appindicator3-1。命令行 dpkg -l | grep webkit2gtk 看一眼。如果是内网无外网环境，提前从可信镜像拿好这些 deb，cp 到目标机器后用 dpkg -i 安装，依赖问题用 dpkg --get-selections 对账。

第二步装 chayuan-desktop。sudo dpkg -i chayuan-desktop_x.y.z_amd64.deb，遇到依赖缺失会报错，根据提示 sudo apt-get install -f 补依赖，但 -f 这一步在无外网环境下会失败，必须提前把所有依赖 deb 一起带过来。

第三步首启动。GUI 环境下双击桌面图标，命令行环境下运行 /usr/bin/chayuan-desktop。FirstRunSetup 跳出来，CHAYUAN_ROOT 指到 ~/.local/share/chayuan-desktop 或者一个独立分区。

第四步无外网环境的特别处理。chayuan-desktop 在首启动会下载内嵌的 bge-m3-onnx 嵌入模型和 RapidOCR 权重，文件总大小约一个 G。如果这台机器没外网，需要从一台有外网的机器先把模型拉下来，再拷贝到目标机器的 CHAYUAN_ROOT/models 目录下。模型文件结构在仓库 packaging 文档里有详细列。这一步是无外网部署的关键，跳过就会卡在首启动模型加载。

第五步配置模型供应商。无外网情况下，外部厂商钥匙都用不上，只能配本地推理。在内网先部署一台 Ollama 或 vLLM 服务，把模型权重拷进去，让它监听内网某个 IP 端口。回到 chayuan-desktop 的设置，新建 OpenAI 兼容路由供应商，地址填内网那台机器的 http://10.x.x.x:11434/v1，保存。这种内网拓扑是政企部署察元AI 的常见做法。

第六步测试一句对话。新建对话，挑刚配的模型，问一句话。流式输出正常说明全栈跑通。再拖一份 PDF 进去做 RAG 测试，看引用气泡是否能展开。本地离线知识库 默认使用 sqlite-vec，KB 数据全部在本机。

第七步排查工具。内网装包出了问题不好搜资料，给一份本地诊断命令清单。systemctl status 看 sidecar 是不是被 systemd 起了；ss -ltnp | grep 62581 看端口；ldd /usr/lib/chayuan-desktop/chayuan-server | grep not 找缺失的动态库；strace -e trace=openat /usr/bin/chayuan-desktop 看启动时找哪些文件失败。这几条命令是 Linux 装包问题排查的万能锤。

国产化支持下的几个特别情况。麒麟 V10 GA 上 webkit2gtk 版本不一定够新，需要从软件商店或者社区 ppa 装更新一份。统信 UOS 1060 自带的 webkit 版本通常足够，但需要打开 Wine 兼容关相关选项。openKylin 上情况类似 Ubuntu，问题不大。loongarch64 架构的发行版需要专门的 chayuan-desktop 二进制构建，这个由发行渠道单独提供。

## 麒麟 V10 ARM 无外网装包：libwebkit2gtk-4.1 缺依赖的根治

麒麟 V10 的 ARM（aarch64）机器上装 deb 包，最常见的一条报错是「依赖关系不满足：libwebkit2gtk-4.1-0，libayatana-appindicator3-1」。很多人第一反应是想把依赖降到系统自带的 webkit2gtk-4.0，但这条路走不通——察元AI 桌面端的外壳是 Tauri v2，编译出来的二进制在链接层就绑死了 `libwebkit2gtk-4.1.so.0`，改安装包里的依赖声明只是骗过 dpkg 的检查，程序一跑还是找 4.1 的动态库，直接白屏或崩溃。真正支持 webkit2gtk-4.0 的是 Tauri v1，退回去等于重写整个壳工程，不现实。所以麒麟 V10 若系统没预装 4.1，唯一可行的办法是把 4.1 这一整套依赖离线随包带过去。

仓库里已经准备了一套现成脚本，在 `scripts/kylin-offline/` 下，分「联网收集」和「离线安装」两步。注意一个硬约束：架构不能混，arm64 的依赖必须在 arm64 机器上收集，x86 机器下不到能在麒麟 ARM 上运行的库。

第一步，在一台能联网、且软件源里有 4.1 的麒麟 V10 aarch64 机器上收集依赖。先自检源里有没有 4.1：

```bash
uname -m                                 # 应为 aarch64
apt-cache policy libwebkit2gtk-4.1-0     # Candidate 有版本号才收集得到
```

如果 `Candidate: (none)`，说明这台机器的源里根本没有 4.1，换一台有的机器，或者先给它配上较新的麒麟官方源 / openKylin 源。确认有 4.1 之后，跑收集脚本，把安装包 deb 作为参数传进去，依赖解析会最精确：

```bash
cd scripts/kylin-offline
./fetch-deps.sh Chayuan_x.y.z_arm64.deb   # 递归收集依赖树到 deps/
```

脚本会读安装包的 Depends 字段，递归展开依赖树，把 webkit2gtk-4.1 全家桶、appindicator 等下成一批 arm64 的 deb 存到 `deps/` 目录。

第二步，把整个 `kylin-offline/` 目录（含 `deps/` 和安装包 deb）拷到不联网的目标麒麟机上，跑安装脚本：

```bash
cd kylin-offline
./install-offline.sh                      # 多遍 dpkg 装依赖 + 装主程序 + 校验
```

脚本会反复几遍 `dpkg -i deps/*.deb` 把依赖之间的安装顺序吸收掉，再装主程序，最后校验 `libwebkit2gtk-4.1` 运行库到底有没有就位——这一项是最容易缺、也最致命的，缺了就白屏。全程不访问网络。托盘图标库 appindicator 若没装上，只是没有托盘图标，不影响主功能。

如果你是自己跑构建机出包，`build-desktop.sh` 在产出 arm64 的 deb 之后会自动把这套脚本和 deb 组装成一个开箱即用的「麒麟离线包骨架」放进 `dist-*/` 目录，`deps/` 留空，交给麒麟联网机的 `fetch-deps.sh` 填满即可。不需要这个行为时用 `KYLIN_OFFLINE=0` 关掉。

WPS AI 插件 chayuan-wps 在 Linux 上目前需要 Linux 版 WPS Office，但 WPS Office Linux 版本对加载项的支持还不如 Windows。建议 Linux 上先把 chayuan-desktop 桌面端跑稳，加载项作为后期补充。免费开源的AI软件 在 Linux 上的优势是装机灵活，劣势是细节散，给自己留半天时间装第一台。
