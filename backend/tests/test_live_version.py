"""实时同步的版本接口：版本令牌 / 权限判定 / 取页（纯函数，不连库）."""

from types import SimpleNamespace

from app.live.router import can_read_live, pick_view, version_token


def test_version_token_formats_datetime_and_string():
    stamp = SimpleNamespace(isoformat=lambda: "2026-11-24T10:00:00+08:00")
    assert version_token(stamp) == "2026-11-24T10:00:00+08:00"
    assert version_token("2026-11-24 10:00:00") == "2026-11-24 10:00:00"
    assert version_token(None) == ""


def test_can_read_live_matrix():
    base = dict(owner_id=7, team_shared=False, role="member", user_id=3, has_grant=False)
    # 管理员、公共看板、owner 都能读
    assert can_read_live(**{**base, "role": "admin"}) is True
    assert can_read_live(**{**base, "role": "super_admin"}) is True
    assert can_read_live(**{**base, "owner_id": None}) is True
    assert can_read_live(**{**base, "owner_id": 3}) is True
    # 别人的私有看板：没有协同、没有授权 → 拒
    assert can_read_live(**base) is False
    # 协同看板全团队可看
    assert can_read_live(**{**base, "team_shared": True}) is True
    # 非协同但有显式授权记录
    assert can_read_live(**{**base, "has_grant": True}) is True


def test_pick_view_finds_by_key_and_tolerates_junk():
    doc = {"views": [{"key": "main", "items": []}, {"key": "p2", "items": [1]}, None, {}]}
    assert pick_view(doc, "p2") == {"key": "p2", "items": [1]}
    assert pick_view(doc, "main") == {"key": "main", "items": []}
    assert pick_view(doc, "missing") is None
    assert pick_view(None, "main") is None
    assert pick_view({}, "main") is None


def test_pick_view_matches_non_string_keys():
    """历史文档里 key 可能是数字，按字符串比对才不会漏."""
    assert pick_view({"views": [{"key": 12, "items": []}]}, "12") == {"key": 12, "items": []}
