import os
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from fuzefront_events import metadata

REPO = Path(__file__).resolve().parents[3]
VECTORS = REPO / "packages" / "conformance-vectors" / "events"
PG_URL = os.environ.get("FUZEFRONT_EVENTS_TEST_PG_URL")


@pytest.fixture(params=["sqlite", pytest.param("postgres", marks=pytest.mark.postgres)])
async def sf(request, tmp_path):
    if request.param == "postgres":
        if not PG_URL:
            pytest.skip("FUZEFRONT_EVENTS_TEST_PG_URL not set")
        url = PG_URL
    else:
        url = f"sqlite+aiosqlite:///{tmp_path / 't.db'}"
    engine = create_async_engine(url)
    async with engine.begin() as c:
        await c.run_sync(metadata.drop_all)
        await c.run_sync(metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()
