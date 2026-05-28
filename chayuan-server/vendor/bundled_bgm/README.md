# `bundled_bgm/` — 视频生成背景音乐

video_generation Wizard step 6 选 ``bgm_type=random/file`` 时从本目录
+ ``<CHAYUAN_ROOT>/video_generation/bgm/``(用户上传)合并的 BGM 池里取。

路径暴露由 ``chayuan/server/video_generation/binaries.py::get_bgm_dir()``
导出给 ``/api/v1/video-generation/bgm`` endpoint。

## 上游来源

chayuan-video-generation (MoneyPrinterTurbo) 上游内置 15 个 BGM:
``/work/chayuan-video-generation/resource/songs/output{000..014}.mp3``。

每个 ~1-2 MB,总计 ~15-30 MB。

## 许可

上游 ``resource/songs/`` 中的 mp3 来源不明确,**不推荐直接随 desktop
安装包 / docker image 分发**。生产前替换成明确无版权 / CC0 的素材:

- [Free Music Archive](https://freemusicarchive.org/) — CC0 / CC-BY 大量
- [Pixabay Music](https://pixabay.com/music/) — 商用免费
- [Bensound](https://www.bensound.com/) — 部分免费,部分要署名

## 怎么放进去

```bash
# 开发期:从上游拷过来(仅学习/测试场景)
cp /work/chayuan-video-generation/resource/songs/*.mp3 \
   chayuan-server/vendor/bundled_bgm/
```

放好后重启 chayuan-server,wizard step 6 BGM dropdown 自动出现。

## .gitignore 行为

* 本 README + `.gitkeep` 入 git 仓库
* `*.mp3 / *.wav / *.m4a / *.aac / *.ogg` **不入 git**(媒体 + 许可),
  开发者用 `scripts/seed-bundled-assets.{sh,ps1}` 拉齐
