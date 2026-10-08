import adapter as A
import pytest
import pytest_asyncio


@pytest_asyncio.fixture
async def sf():
    if not A.INFRA_READY:
        pytest.skip("DATABASE_URL not set")
    await A.reset_schema()
    eng, factory = A.async_session_factory()
    yield factory
    await eng.dispose()
