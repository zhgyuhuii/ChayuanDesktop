import chacmd


def test_package_version_exposed():
    assert chacmd.__version__ == "0.0.0"
