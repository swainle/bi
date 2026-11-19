"""简单的可逆加密——用于安全存储 API 密钥（私有部署场景）."""

import base64
import hashlib
import secrets

# 服务端密钥：基于机器固定信息生成
_SECRET = hashlib.sha256(b"mingcebi-api-secret-key-v1").digest()[:16]
# 旧名（MingzeBI 时期）加密的数据可能还在库里：解密时回退旧密钥，历史 Key / 口令不会因为改名读不出来
_LEGACY_SECRET = hashlib.sha256(b"mingzebi-api-secret-key-v1").digest()[:16]
# 新密文带版本前缀，旧密文没有前缀 —— 用哪把钥匙是确定的，不靠试错
_PREFIX = "v2:"


def _xor(data: bytes, key: bytes) -> bytes:
    return bytes(d ^ key[i % len(key)] for i, d in enumerate(data))


def encrypt(raw: str) -> str:
    """加密原始密钥."""
    nonce = secrets.token_bytes(8)
    plain = nonce + raw.encode("utf-8")
    cipher = _xor(plain, _SECRET)
    return _PREFIX + base64.urlsafe_b64encode(cipher).decode()


def decrypt(encrypted: str) -> str:
    """解密为原始密钥（无前缀的历史密文用旧密钥）."""
    if not encrypted:
        return ""
    try:
        if encrypted.startswith(_PREFIX):
            cipher = base64.urlsafe_b64decode(encrypted[len(_PREFIX):].encode())
            key = _SECRET
        else:
            cipher = base64.urlsafe_b64decode(encrypted.encode())
            key = _LEGACY_SECRET
        plain = _xor(cipher, key)
        return plain[8:].decode("utf-8")
    except Exception:
        return "(无法解密)"
