# `imagemagick/` — moviepy TextClip 字幕渲染必需

video_generation 模块用 moviepy 生成视频时,`TextClip` 渲染中英文字幕
**必须**有 ImageMagick portable 二进制。本目录是按平台放二进制的位置,
启动时 `chayuan/server/video_generation/binaries.py` 探测 + 注入
`os.environ["IMAGEMAGICK_BINARY"]` 环境变量。

## 平台子目录约定

```
imagemagick/
├── win-x64/
│   ├── magick.exe         必需
│   └── ...config/dlls     ImageMagick 自带的运行时
├── linux-x64/
│   ├── magick             portable AppImage 解出来的可执行
│   └── ...
├── linux-arm64/
│   └── magick
├── macos-arm64/
│   └── magick
└── macos-x64/
    └── magick
```

`<platform>` 命名跟 `vendor/services/llama-server/` / `whisper-server/`
保持一致,由 `binaries.py::_platform_tag()` 解析。

## 下载源(M3.D4 seed 脚本会做)

| 平台 | 推荐源 | 体积 |
|---|---|---|
| Windows x64 | https://imagemagick.org/archive/binaries/ImageMagick-7.x.x-portable-Q16-HDRI-x64.zip | ~75 MB |
| Linux x64 | https://imagemagick.org/archive/binaries/magick(AppImage) | ~50 MB |
| Linux arm64 | https://imagemagick.org/archive/binaries/magick(aarch64 AppImage) | ~50 MB |
| macOS arm64 | https://download.imagemagick.org/ImageMagick/download/binaries/ImageMagick-arm64-darwin.tar.gz | ~70 MB |
| macOS x64 | https://download.imagemagick.org/ImageMagick/download/binaries/ImageMagick-x86_64-darwin.tar.gz | ~70 MB |

## 怎么放进去

### 用 seed 脚本(推荐,M3.D4 接入后)

```bash
scripts/seed-bundled-assets.sh imagemagick    # 当前平台
scripts/seed-bundled-assets.sh imagemagick --all-platforms  # 所有平台,~300 MB
```

### 手工放

1. 下载对应平台 portable 二进制(见上表)
2. 解压到 `chayuan-server/vendor/services/imagemagick/<platform>/`
3. 确保 `magick(.exe)` 可执行(`chmod +x` linux/macos)
4. 重启 chayuan-server,启动日志看到:
   `[binaries] IMAGEMAGICK_BINARY = .../magick`
5. 否则会有 warning:`未找到 ImageMagick(平台 xxx)`

## .gitignore 行为

* 本 README + `.gitkeep` 入 git 仓库
* `<platform>/` 下二进制和 dll **不入 git**(体积太大 + 许可)
