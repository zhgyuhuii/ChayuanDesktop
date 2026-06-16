"""Task C1 单测:系统字体枚举。独立可跑(importlib 直接加载模块文件,不拉 chayuan 包)。"""
import importlib.util
import pathlib
import tempfile

_MOD = (pathlib.Path(__file__).resolve().parents[4]
        / "libs" / "chayuan-server" / "chayuan" / "server"
        / "video_generation" / "system_fonts.py")
_spec = importlib.util.spec_from_file_location("system_fonts", _MOD)
system_fonts = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(system_fonts)


def test_list_system_fonts_shape_and_extra_dir():
    with tempfile.TemporaryDirectory() as td:
        d = pathlib.Path(td)
        (d / "Foo.ttf").write_bytes(b"\x00\x01\x00\x00")
        (d / "Bar.otf").write_bytes(b"OTTO")
        (d / "ignore.txt").write_bytes(b"x")
        fonts = system_fonts.list_system_fonts(extra_dirs=[d])
        families = {x["family"] for x in fonts}
        assert "Foo" in families and "Bar" in families
        # 非字体后缀不收
        assert "ignore" not in families
        # 形状
        for x in fonts:
            assert {"family", "path"} <= set(x)
        # 排序稳定
        fam_list = [x["family"] for x in fonts]
        assert fam_list == sorted(fam_list)


def test_dedup_by_family():
    with tempfile.TemporaryDirectory() as td:
        d1 = pathlib.Path(td) / "a"; d2 = pathlib.Path(td) / "b"
        d1.mkdir(); d2.mkdir()
        (d1 / "Same.ttf").write_bytes(b"\x00\x01\x00\x00")
        (d2 / "Same.ttf").write_bytes(b"\x00\x01\x00\x00")
        fonts = system_fonts.list_system_fonts(extra_dirs=[d1, d2])
        same = [x for x in fonts if x["family"] == "Same"]
        assert len(same) == 1  # 去重


if __name__ == "__main__":
    test_list_system_fonts_shape_and_extra_dir()
    test_dedup_by_family()
    print("OK: C1 system_fonts tests passed")
