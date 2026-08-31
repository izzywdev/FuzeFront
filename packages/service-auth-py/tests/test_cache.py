"""Unit tests for the bounded positive cache, isolated from the verifier."""

from __future__ import annotations

from fuzefront_service_auth._cache import PositiveCache


def test_put_then_get_within_ttl():
    cache = PositiveCache(max_size=10, max_ttl_seconds=100.0)
    cache.put("k", "v", now=0.0)
    assert cache.get("k", now=50.0) == "v"


def test_get_after_ttl_expires_returns_none():
    cache = PositiveCache(max_size=10, max_ttl_seconds=100.0)
    cache.put("k", "v", now=0.0)
    assert cache.get("k", now=150.0) is None


def test_entry_expiry_is_capped_by_provided_expires_at_even_if_shorter_than_max_ttl():
    cache = PositiveCache(max_size=10, max_ttl_seconds=1000.0)
    cache.put("k", "v", now=0.0, expires_at=10.0)
    assert cache.get("k", now=5.0) == "v"
    assert cache.get("k", now=15.0) is None


def test_put_with_already_past_expires_at_does_not_cache():
    cache = PositiveCache(max_size=10, max_ttl_seconds=1000.0)
    cache.put("k", "v", now=100.0, expires_at=50.0)
    assert cache.get("k", now=100.0) is None
    assert len(cache) == 0


def test_bounded_size_evicts_least_recently_used():
    cache = PositiveCache(max_size=2, max_ttl_seconds=1000.0)
    cache.put("a", "va", now=0.0)
    cache.put("b", "vb", now=0.0)
    cache.put("c", "vc", now=0.0)  # evicts "a" (least recently used)

    assert cache.get("a", now=0.0) is None
    assert cache.get("b", now=0.0) == "vb"
    assert cache.get("c", now=0.0) == "vc"
    assert len(cache) == 2


def test_get_refreshes_recency():
    cache = PositiveCache(max_size=2, max_ttl_seconds=1000.0)
    cache.put("a", "va", now=0.0)
    cache.put("b", "vb", now=0.0)
    cache.get("a", now=0.0)  # "a" is now most-recently-used
    cache.put("c", "vc", now=0.0)  # must evict "b", not "a"

    assert cache.get("a", now=0.0) == "va"
    assert cache.get("b", now=0.0) is None
    assert cache.get("c", now=0.0) == "vc"
