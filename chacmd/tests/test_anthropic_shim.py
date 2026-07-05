from chacmd.shim.anthropic_shim import anthropic_to_openai, openai_to_anthropic


def test_request_system_becomes_system_message():
    a = {
        "model": "m", "max_tokens": 100, "system": "you are x",
        "messages": [{"role": "user", "content": "hi"}],
    }
    o = anthropic_to_openai(a)
    assert o["messages"][0] == {"role": "system", "content": "you are x"}
    assert o["messages"][1] == {"role": "user", "content": "hi"}
    assert o["max_tokens"] == 100


def test_request_content_blocks_flattened_to_text():
    a = {
        "model": "m", "max_tokens": 10,
        "messages": [{"role": "user", "content": [{"type": "text", "text": "a"}, {"type": "text", "text": "b"}]}],
    }
    o = anthropic_to_openai(a)
    assert o["messages"][0]["content"] == "a\nb"


def test_request_without_system_has_no_system_message():
    a = {"model": "m", "max_tokens": 5, "messages": [{"role": "user", "content": "hi"}]}
    o = anthropic_to_openai(a)
    assert all(m["role"] != "system" for m in o["messages"])


def test_response_openai_to_anthropic_shape():
    o = {
        "choices": [{"message": {"content": "hello"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 5, "completion_tokens": 7},
    }
    a = openai_to_anthropic(o, model="m")
    assert a["content"] == [{"type": "text", "text": "hello"}]
    assert a["stop_reason"] == "end_turn"
    assert a["usage"] == {"input_tokens": 5, "output_tokens": 7}
    assert a["role"] == "assistant"
    assert a["type"] == "message"


def test_response_length_finish_maps_to_max_tokens():
    o = {"choices": [{"message": {"content": "x"}, "finish_reason": "length"}], "usage": {}}
    a = openai_to_anthropic(o, model="m")
    assert a["stop_reason"] == "max_tokens"
