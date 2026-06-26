# `bundled_fonts/` — 视频生成字幕字体

video_generation 模块 + moviepy TextClip 渲染字幕时,从这里挑字体文件。
路径解析由 `chayuan/server/video_generation/binaries.py::get_fonts_dir()`
导出给 `/api/v1/video-generation/fonts` endpoint 列表使用。

## 已随仓库提交的中文字体(开箱即用)

- **`NotoSansCJKsc-Regular.otf`**(Noto Sans CJK SC,Google,OFL,~16 MB)已
  **入仓**。它保证 docker / dev / 离线构建出的镜像里**始终有一个可分发的中文
  字体**:字幕渲染按 `steps/compose.py` 与 `digital_human/overlay.py` 的字体
  回退链,**第一顺位**就是 `get_fonts_dir()`(本目录),所以当镜像/系统**没有**
  任何 CJK 系统字体时,字幕会**自动回退用这个随包字体**,不会再出方框。
- 这是唯一入仓的字体;其它(平台原生 STHeiti/雅黑、商用体)仍**不入仓**,
  按需 seed。换更小的(如文泉驿微米黑)或加字重,放进本目录即可被自动识别。

## 推荐字体清单

| 文件名 | 体积 | 来源 | 许可 | 用途 |
|---|---|---|---|---|
| STHeitiMedium.ttc | 56 MB | macOS 系统字体 | Apple TrueType,**仅适用 Apple 平台/许可** | 中文 medium 字重 |
| STHeitiLight.ttc | 56 MB | macOS 系统字体 | 同上 | 中文 light 字重 |
| MicrosoftYaHeiBold.ttc | 17 MB | Windows 系统字体 | Microsoft,**仅适用 Windows 平台/许可** | 中文 bold |
| MicrosoftYaHeiNormal.ttc | 20 MB | Windows 系统字体 | 同上 | 中文 normal |
| Charm-Bold.ttf | 132 KB | Google Fonts | OFL | 英文装饰体 |
| Charm-Regular.ttf | 132 KB | Google Fonts | OFL | 英文装饰体 |
| UTM Kabel KT.ttf | 35 KB | UTM | 商用需授权 | 英文 |

> **法律提醒**:STHeiti / MicrosoftYaHei 都是平台原生字体,**严格说不能
> 跨平台分发**(从 macOS 拷给 Linux 用户违反 Apple 字体许可)。生产环
> 境建议用同等 CJK 覆盖的开源替代:
> - 思源黑体 Source Han Sans(Adobe + Google,OFL)
> - 思源宋体 Source Han Serif(Adobe + Google,OFL)
> - 文泉驿 WenQuanYi(GPL)
> - Noto Sans CJK(Google,OFL)

## 怎么放进去

### 开发期 quick start

```bash
# 在 /work/chayuan-video-generation/resource/fonts/ 已经有上游字体(仅
# 学习/测试场景使用,不进 git):
cp /work/chayuan-video-generation/resource/fonts/*.ttc \
   /work/chayuan-video-generation/resource/fonts/*.ttf \
   chayuan-server/vendor/bundled_fonts/
```

### 生产分发

下载开源 CJK 字体到本目录:

```bash
# 思源黑体 — 单 OTC 文件,covers CJK + 拉丁
curl -L https://github.com/adobe-fonts/source-han-sans/raw/release/OTC/SourceHanSans.ttc \
  -o chayuan-server/vendor/bundled_fonts/SourceHanSans.ttc
```

放好后:
- 重启 chayuan-server,wizard step 6 字体 dropdown 会自动看到。
- desktop frozen build / Docker image build 时会 COPY 这些文件到分发包。

## .gitignore 行为

* 本 README + `.gitkeep` 入 git 仓库
* **例外**:`NotoSansCJKsc-Regular.otf`(OFL,可自由分发)**入 git**,
  保证开箱即有中文字幕字体(见 `.gitignore` 的 `!...NotoSansCJKsc-Regular.otf`)
* 其它 `*.ttf / *.ttc / *.otf` **不入 git**(大文件 + 许可不一定允许),
  开发者用 `scripts/seed-bundled-assets.{sh,ps1}` 或 `scripts/seed_fonts.py` 拉齐
