"""兼容垫片：分享链接已迁到 `app.templates.share_links`（B19）."""

from app.templates.share_links import generate_share_link, validate_share_token

__all__ = ["generate_share_link", "validate_share_token"]
