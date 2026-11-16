import pytest
from backend import db


def test_memory_crud(tmp_path):
    p = str(tmp_path / "a.db")
    db.init_db(p)
    m = db.add_memory(p, "  Likes   chess ", "hobby")
    assert m["content"] == "Likes chess" and m["category"] == "hobby"
    assert [x["id"] for x in db.list_memories(p)] == [m["id"]]
    u = db.update_memory(p, m["id"], content="Likes chess and drawing")
    assert u["content"] == "Likes chess and drawing" and u["category"] == "hobby"
    assert db.update_memory(p, 999, content="x") is None
    assert db.delete_memory(p, m["id"]) is True
    assert db.delete_memory(p, m["id"]) is False
    assert db.list_memories(p) == []


def test_empty_and_limit(tmp_path):
    p = str(tmp_path / "b.db")
    db.init_db(p)
    with pytest.raises(ValueError):
        db.add_memory(p, "   ")
    db.add_memory(p, "one", max_memories=1)
    with pytest.raises(db.MemoryLimitError):
        db.add_memory(p, "two", max_memories=1)


def test_memories_persist_across_connections(tmp_path):
    p = str(tmp_path / "c.db")
    db.init_db(p)
    db.add_memory(p, "Name is Sarwesh")
    db.init_db(p)  # re-open, as after a restart
    assert db.list_memories(p)[0]["content"] == "Name is Sarwesh"


def test_messages_recent_and_clear(tmp_path):
    p = str(tmp_path / "d.db")
    db.init_db(p)
    for i in range(5):
        db.add_message(p, "user" if i % 2 == 0 else "rem", f"m{i}")
    assert [m["content"] for m in db.recent_messages(p, 3)] == ["m2", "m3", "m4"]
    assert db.clear_messages(p) == 5
    assert db.recent_messages(p, 3) == []
