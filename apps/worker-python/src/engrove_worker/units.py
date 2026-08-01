from decimal import ROUND_HALF_EVEN, Context, Decimal, InvalidOperation, localcontext
from typing import Any, cast

from .generated_units import REGISTRY, REGISTRY_DIGEST, REGISTRY_VERSION

CONTEXT = Context(prec=34, rounding=ROUND_HALF_EVEN, Emin=-6143, Emax=6144)
PREFIXES = {
    "da": 1,
    "Y": 24,
    "Z": 21,
    "E": 18,
    "P": 15,
    "T": 12,
    "G": 9,
    "M": 6,
    "k": 3,
    "h": 2,
    "d": -1,
    "c": -2,
    "m": -3,
    "u": -6,
    "µ": -6,
    "n": -9,
    "p": -12,
    "f": -15,
}


class UnitError(ValueError):
    pass


def canonical_decimal(raw: str) -> str:
    try:
        with localcontext(CONTEXT):
            value = Decimal(raw)
            if not value.is_finite():
                raise UnitError("INVALID_DECIMAL")
            digits = len(value.as_tuple().digits)
            if digits > 34:
                raise UnitError("DECIMAL_PRECISION_EXCEEDED")
            value = +value
            if value.is_zero():
                return "0"
            return (
                format(value, "f").rstrip("0").rstrip(".")
                if "." in format(value, "f")
                else format(value, "f")
            )
    except InvalidOperation as error:
        raise UnitError("INVALID_DECIMAL") from error


def _resolve(unit_id: str) -> tuple[dict[str, Any], int]:
    units = cast(list[dict[str, Any]], REGISTRY["units"])
    for unit in units:
        if unit_id in [unit["id"], unit["symbol"], *unit["aliases"]]:
            return unit, 0
    for prefix in sorted(PREFIXES, key=len, reverse=True):
        if not unit_id.startswith(prefix):
            continue
        base = unit_id[len(prefix) :]
        for unit in units:
            if unit.get("prefixable") and base in [unit["id"], unit["symbol"]]:
                return unit, PREFIXES[prefix]
    raise UnitError("UNKNOWN_UNIT")


def convert_quantity(
    raw: str, unit_id: str, dimension: str, difference: bool = False
) -> dict[str, str]:
    original = canonical_decimal(raw)
    unit, prefix_power = _resolve(unit_id)
    if unit["dimension"] != dimension:
        raise UnitError("INCOMPATIBLE_DIMENSION")
    with localcontext(CONTEXT):
        scale = (Decimal(unit["scaleNumerator"]) / Decimal(unit["scaleDenominator"])) * (
            Decimal(10) ** prefix_power
        )
        offset = (
            Decimal(0)
            if difference
            else Decimal(unit["offsetNumerator"]) / Decimal(unit["offsetDenominator"])
        )
        canonical = canonical_decimal(format(Decimal(original) * scale + offset, "f"))
    return {
        "value": original,
        "unit": unit_id,
        "canonicalValue": canonical,
        "canonicalUnit": cast(dict[str, dict[str, str]], REGISTRY["dimensions"])[dimension][
            "canonicalUnit"
        ],
        "dimension": dimension,
        "unitRegistryVersion": f"{REGISTRY_VERSION}+sha256:{REGISTRY_DIGEST}",
    }
