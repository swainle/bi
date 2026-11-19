"""兼容垫片：已迁到 `app.ai.engine`（B38）."""

from app.ai.engine.models import (  # noqa: F401
    candidate_configs,
    decrypt_key,
    default_config,
    from_db,
    from_env,
    from_json_file,
    mask_key,
    normalize_base_url,
    test_connection,
)

__all__ = [
    "candidate_configs",
    "decrypt_key",
    "default_config",
    "from_db",
    "from_env",
    "from_json_file",
    "mask_key",
    "normalize_base_url",
    "test_connection",
]
