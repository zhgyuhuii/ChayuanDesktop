# `bundled_video_clips/` — 出厂内置素材片段(可选)

完全离线场景下,wizard step 5 "我的素材"看到的全局 bundled 素材。本
目录的视频文件会通过 ``video_generation.binaries.get_clips_dir()``
被注册到 ``vg_materials`` 表(``source=bundled``, ``owner_id=NULL``),
所有用户共享可见。

## 设计目的

- **离线红线**:用户机器全无网络也能跑通 wizard,需要本地素材兜底
- **快速预览**:用户首次试用不必先上传任何素材

## 推荐素材

挑选标准:
- **CC0 / 商用免费**(无版权风险)
- 9:16 / 16:9 / 1:1 全覆盖
- 内容多样(自然景观 / 城市 / 办公 / 科技 / 抽象画面)
- 单段 5-15 秒 + ~5-10 MB
- 总 30 段以内,总体积 < 200 MB(避免 desktop 安装包过大)

推荐来源:
- [Pexels Video](https://www.pexels.com/videos/) — 全 CC0
- [Pixabay Video](https://pixabay.com/videos/) — 商用免费
- [Coverr.co](https://coverr.co/) — 全 CC0

## 怎么放进去

```bash
# 把视频文件直接放本目录,不强求子目录组织(扁平即可)
cp ~/Downloads/spring-flower.mp4 chayuan-server/vendor/bundled_video_clips/
```

放好后:
1. 启动 chayuan-server
2. 第一次启动钩子 ``video_generation.binaries.configure()`` 探测到本
   目录有视频文件,触发"seed 内置素材到 vg_materials"逻辑(M3.D8 接入)
3. wizard step 5 "我的素材" tab 自动看到

## .gitignore 行为

* 本 README 入 git 仓库
* `*.mp4 / *.mov / *.webm / *.mkv` **不入 git**(媒体大文件)
* 实际素材通过 `scripts/seed-bundled-assets.{sh,ps1}` 按可达性下载
