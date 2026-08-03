"""TypeID-compatible suffix codec: 128-bit UUID <-> 26-char base32.

Byte-for-byte identical to ``shared/src/identity/codec.ts``. Both are pinned by
the same TypeID spec vectors in their respective test suites, so a divergence
fails CI in whichever language drifted.

Wire form keeps the prefix; storage stays a native ``uuid`` column. The
conversion is lossless, so ``cus_01h455vb4pex5vsknk084sn02q`` and
``01890a5d-ac96-774b-bcce-b302099a8057`` are two renderings of one value.
"""

from __future__ import annotations

import os
import re
import time
import uuid as _uuid

_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"
_DECODE = {char: index for index, char in enumerate(_ALPHABET)}
SUFFIX_LENGTH = 26

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE
)


def encode_suffix(data: bytes) -> str:
    """Encode 16 bytes as the 26-character base32 suffix.

    26 * 5 = 130 bits for a 128-bit value, so the encoding is left-padded with
    two zero bits and the leading character never exceeds ``'7'``.
    """
    if len(data) != 16:
        raise ValueError(f"expected 16 bytes, received {len(data)}")
    value = int.from_bytes(data, "big")
    # 26 shifts: 125, 120, ... 5, 0. At shift 125 only 3 bits remain above it,
    # which is the two-bit pad plus the value's leading bit.
    return "".join(_ALPHABET[(value >> shift) & 31] for shift in range(125, -1, -5))


def decode_suffix(suffix: str) -> bytes:
    """Decode a 26-character base32 suffix back to 16 bytes."""
    if len(suffix) != SUFFIX_LENGTH:
        raise ValueError(f"suffix must be {SUFFIX_LENGTH} characters, received {len(suffix)}")
    value = 0
    for position, char in enumerate(suffix):
        digit = _DECODE.get(char)
        if digit is None:
            raise ValueError(f"invalid base32 character {char!r} at position {position}")
        # The leading character carries only 2 significant bits (130 - 128);
        # anything above '7' would overflow 128 bits and encode cannot produce it.
        if position == 0 and digit > 7:
            raise ValueError("suffix overflows 128 bits")
        value = (value << 5) | digit
    return value.to_bytes(16, "big")


def is_valid_suffix(suffix: str) -> bool:
    try:
        decode_suffix(suffix)
        return True
    except ValueError:
        return False


def bytes_to_uuid(data: bytes) -> str:
    """Canonical hyphenated UUID string for 16 bytes."""
    return str(_uuid.UUID(bytes=data))


def uuid_to_bytes(value: str) -> bytes:
    if not _UUID_RE.match(value):
        raise ValueError(f"not a canonical UUID: {value!r}")
    return _uuid.UUID(value).bytes


def is_uuid(value: str) -> bool:
    return bool(_UUID_RE.match(value))


def uuidv7_bytes(now_ms: int | None = None) -> bytes:
    """UUIDv7 bytes: 48-bit big-endian Unix-ms timestamp, version, variant, random.

    The leading timestamp is the point — ids minted near each other in time sort
    near each other, so B-tree inserts stay clustered instead of scattering the
    way v4 does (RFC 9562 5.7).
    """
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    data = bytearray(os.urandom(16))
    data[0:6] = int(now_ms).to_bytes(6, "big")
    data[6] = 0x70 | (data[6] & 0x0F)  # version 7
    data[8] = 0x80 | (data[8] & 0x3F)  # RFC 9562 variant
    return bytes(data)
