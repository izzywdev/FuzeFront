import pytest
import adapter as A

@pytest.fixture
def eng():
    e = A.engine(); A.reset_schema(e); yield e; e.dispose()
