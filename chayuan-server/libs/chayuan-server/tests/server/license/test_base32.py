from chayuan.server.license.base32 import decode, check_char

def test_decode_maps_confusables_and_case():
    # "O"->0, "I"/"L"->1, 大小写不敏感
    assert decode("ABC") == decode("abc")

def test_decode_invalid_raises():
    import pytest
    with pytest.raises(ValueError):
        decode("!!!")

def test_check_char_deterministic_and_37_alphabet():
    c = check_char(bytes([1, 2, 3, 4]))
    assert c == check_char(bytes([1, 2, 3, 4]))
    assert c in "0123456789ABCDEFGHJKMNPQRSTVWXYZ*~$=U"

def test_check_char_changes_on_byte_change():
    assert check_char(bytes([1, 2, 3, 4])) != check_char(bytes([1, 2, 3, 5]))
