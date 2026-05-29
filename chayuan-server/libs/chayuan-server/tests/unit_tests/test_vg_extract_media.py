from chayuan.server.video_generation.url_extractor import _parse_media_from_html


def test_parse_media_extracts_img_video_source_og():
    html = b"""
    <html><head>
      <meta property="og:image" content="https://x.com/og.jpg">
      <meta property="og:video" content="https://x.com/og.mp4">
    </head><body>
      <img src="https://x.com/a.png">
      <img src="/rel/b.jpg">
      <video src="https://x.com/c.mp4"></video>
      <video><source src="https://x.com/d.webm" type="video/webm"></video>
      <img src="data:image/gif;base64,AAAA">
    </body></html>
    """
    items = _parse_media_from_html(html, "https://x.com/page", "utf-8")
    urls = [it["url"] for it in items]
    assert "https://x.com/og.jpg" in urls
    assert "https://x.com/og.mp4" in urls
    assert "https://x.com/a.png" in urls
    assert "https://x.com/rel/b.jpg" in urls   # 相对路径已 urljoin
    assert "https://x.com/c.mp4" in urls
    assert "https://x.com/d.webm" in urls
    assert all(not u.startswith("data:") for u in urls)  # data URI 丢弃
    kinds = {it["url"]: it["kind"] for it in items}
    assert kinds["https://x.com/a.png"] == "image"
    assert kinds["https://x.com/c.mp4"] == "video"


def test_parse_media_dedups():
    html = b'<img src="https://x.com/a.png"><img src="https://x.com/a.png">'
    items = _parse_media_from_html(html, "https://x.com/p", "utf-8")
    assert sum(1 for it in items if it["url"] == "https://x.com/a.png") == 1
