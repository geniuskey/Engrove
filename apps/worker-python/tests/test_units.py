import json
from pathlib import Path

import pytest

from engrove_worker.generated_units import REGISTRY_DIGEST
from engrove_worker.units import UnitError, convert_quantity


def test_cross_language_conversion_fixtures() -> None:
    fixture_path = (
        Path(__file__).parents[3] / "packages" / "units" / "fixtures" / "conversions.json"
    )
    for fixture in json.loads(fixture_path.read_text()):
        result = convert_quantity(fixture["value"], fixture["unit"], fixture["dimension"])
        assert result["canonicalValue"] == fixture["canonicalValue"]
        assert result["canonicalUnit"] == fixture["canonicalUnit"]
    assert len(REGISTRY_DIGEST) == 64


def test_incompatible_dimension() -> None:
    with pytest.raises(UnitError, match="INCOMPATIBLE_DIMENSION"):
        convert_quantity("1", "s", "length")
