"""查询治理（app/query/executor.py）单元测试.

覆盖：每用户并发配额、关闭开关、语句超时旋钮的解析。
语句超时的真实取消效果由「连真实 PG 跑 pg_sleep」的链路验证覆盖，不放在单测里。
"""

from app.query import executor


def test_user_slot_cap(monkeypatch):
    monkeypatch.setattr(executor, "USER_MAX_CONCURRENT", 1)
    executor._user_slots.clear()

    slot = executor._user_slot(7)
    assert slot is not None
    assert slot.acquire(blocking=False) is True
    try:
        assert slot.acquire(timeout=0.05) is False  # 超过配额：排队超时
    finally:
        slot.release()

    # 同一用户复用同一把锁；不同用户互不影响
    assert executor._user_slot(7) is slot
    other = executor._user_slot(8)
    assert other is not slot
    assert other.acquire(blocking=False) is True
    other.release()


def test_user_slot_disabled(monkeypatch):
    monkeypatch.setattr(executor, "USER_MAX_CONCURRENT", 0)
    assert executor._user_slot(9) is None


def test_env_int_fallback():
    assert executor._env_int("MCBI_NOT_EXIST_ENV", 15) == 15
