"""简单的可逆加密——用于安全存储 API 密钥（私有部署场景）."""

import base64
import hashlib
import secrets

# 服务端密钥：基于机器固定信息生成
_SECRET = hashlib.sha256(b"mingzebi-api-secret-key-v1").digest()[:16]


def _xor(data: bytes, key: bytes) -> bytes:
    return bytes(d ^ key[i % len(key)] for i, d in enumerate(data))


def encrypt(raw: str) -> str:
    """加密原始密钥."""
    nonce = secrets.token_bytes(8)
    plain = nonce + raw.encode("utf-8")
    cipher = _xor(plain, _SECRET)
    return base64.urlsafe_b64encode(cipher).decode()


def decrypt(encrypted: str) -> str:
    """解密为原始密钥."""
    if not encrypted:
        return ""
    try:
        cipher = base64.urlsafe_b64decode(encrypted.encode())
        plain = _xor(cipher, _SECRET)
        return plain[8:].decode("utf-8")
    except Exception:
        return "(无法解密)"
