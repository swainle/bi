from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.middleware.auth import get_current_user
from app.schemas.user import UserLogin
from app.services import auth, cache


@pytest.mark.parametrize("version", [None, 0, 3])
def test_multiple_logins_keep_existing_tokens_valid(monkeypatch, version):
    user = SimpleNamespace(
        id=1, username="alice", email="alice@example.com", role="user",
        password_hash=auth.hash_password("Password1"), is_active=True,
        approval_status="approved", token_version=version,
    )
    db = Mock()
    db.query.return_value.filter.return_value.first.return_value = user
    monkeypatch.setattr(cache, "cache_get", lambda key: None)
    monkeypatch.setattr(cache, "cache_set", lambda *args: None)
    credentials = UserLogin(account="alice", password="Password1")

    first = auth.login_user(db, credentials)
    auth.login_user(db, credentials)

    assert user.token_version == version
    bearer = HTTPAuthorizationCredentials(
        scheme="Bearer", credentials=first["access_token"],
    )
    assert get_current_user(bearer, db) is user
    assert auth.verify_refresh_token(first["refresh_token"], db) == user.id

    user.token_version = (version or 0) + 1
    with pytest.raises(HTTPException) as exc:
        get_current_user(bearer, db)
    assert exc.value.status_code == 401
    with pytest.raises(ValueError, match="登录凭证已失效"):
        auth.verify_refresh_token(first["refresh_token"], db)
