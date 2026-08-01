# Generated from packages/units/registry/units.yaml. Version 2026.1, sha256:6e8fe3d77e8e8820884d3ae3db20ca5c7804cf73964ba36b814ebd447bd251e4. Do not edit.
REGISTRY_VERSION = "2026.1"
REGISTRY_DIGEST = "6e8fe3d77e8e8820884d3ae3db20ca5c7804cf73964ba36b814ebd447bd251e4"
REGISTRY = {
  "version": "2026.1",
  "exponentRange": [
    -6143,
    6144
  ],
  "dimensions": {
    "dimensionless": {
      "canonicalUnit": "one"
    },
    "length": {
      "canonicalUnit": "m"
    },
    "area": {
      "canonicalUnit": "m2"
    },
    "volume": {
      "canonicalUnit": "m3"
    },
    "mass": {
      "canonicalUnit": "kg"
    },
    "time": {
      "canonicalUnit": "s"
    },
    "temperature": {
      "canonicalUnit": "K"
    },
    "electric_current": {
      "canonicalUnit": "A"
    },
    "voltage": {
      "canonicalUnit": "V"
    },
    "resistance": {
      "canonicalUnit": "ohm"
    },
    "power": {
      "canonicalUnit": "W"
    },
    "energy": {
      "canonicalUnit": "J"
    },
    "pressure": {
      "canonicalUnit": "Pa"
    },
    "force": {
      "canonicalUnit": "N"
    },
    "frequency": {
      "canonicalUnit": "Hz"
    },
    "wavelength": {
      "canonicalUnit": "wavelength_m"
    },
    "angle": {
      "canonicalUnit": "rad"
    },
    "luminous_intensity": {
      "canonicalUnit": "cd"
    }
  },
  "units": [
    {
      "id": "one",
      "dimension": "dimensionless",
      "symbol": "1",
      "name": "one",
      "scaleNumerator": "1",
      "scaleDenominator": "1",
      "offsetNumerator": "0",
      "offsetDenominator": "1",
      "aliases": [
        ""
      ]
    },
    {
      "id": "m",
      "dimension": "length",
      "symbol": "m",
      "name": "metre",
      "scaleNumerator": "1",
      "scaleDenominator": "1",
      "offsetNumerator": "0",
      "offsetDenominator": "1",
      "prefixable": True,
      "aliases": [
        "meter",
        "metre"
      ]
    },
    {
      "id": "in",
      "dimension": "length",
      "symbol": "in",
      "name": "inch",
      "scaleNumerator": "254",
      "scaleDenominator": "10000",
      "offsetNumerator": "0",
      "offsetDenominator": "1",
      "aliases": [
        "inch"
      ]
    },
    {
      "id": "m2",
      "dimension": "area",
      "symbol": "m²",
      "name": "square metre",
      "scaleNumerator": "1",
      "scaleDenominator": "1",
      "offsetNumerator": "0",
      "offsetDenominator": "1",
      "aliases": [
        "m^2"
      ]
    },
    {
      "id": "m3",
      "dimension": "volume",
      "symbol": "m³",
      "name": "cubic metre",
      "scaleNumerator": "1",
      "scaleDenominator": "1",
      "offsetNumerator": "0",
      "offsetDenominator": "1",
      "aliases": [
        "m^3"
      ]
    },
    {
      "id": "L",
      "dimension": "volume",
      "symbol": "L",
      "name": "litre",
      "scaleNumerator": "1",
      "scaleDenominator": "1000",
      "offsetNumerator": "0",
      "offsetDenominator": "1",
      "prefixable": True,
      "aliases": [
        "l",
        "liter",
        "litre"
      ]
    },
    {
      "id": "kg",
      "dimension": "mass",
      "symbol": "kg",
      "name": "kilogram",
      "scaleNumerator": "1",
      "scaleDenominator": "1",
      "offsetNumerator": "0",
      "offsetDenominator": "1",
      "aliases": [
        "kilogram"
      ]
    },
    {
      "id": "g",
      "dimension": "mass",
      "symbol": "g",
      "name": "gram",
      "scaleNumerator": "1",
      "scaleDenominator": "1000",
      "offsetNumerator": "0",
      "offsetDenominator": "1",
      "prefixable": True,
      "aliases": [
        "gram"
      ]
    },
    {
      "id": "s",
      "dimension": "time",
      "symbol": "s",
      "name": "second",
      "scaleNumerator": "1",
      "scaleDenominator": "1",
      "offsetNumerator": "0",
      "offsetDenominator": "1",
      "prefixable": True,
      "aliases": [
        "sec",
        "second"
      ]
    },
    {
      "id": "min",
      "dimension": "time",
      "symbol": "min",
      "name": "minute",
      "scaleNumerator": "60",
      "scaleDenominator": "1",
      "offsetNumerator": "0",
      "offsetDenominator": "1",
      "aliases": [
        "minute"
      ]
    },
    {
      "id": "h",
      "dimension": "time",
      "symbol": "h",
      "name": "hour",
      "scaleNumerator": "3600",
      "scaleDenominator": "1",
      "offsetNumerator": "0",
      "offsetDenominator": "1",
      "aliases": [
        "hr",
        "hour"
      ]
    },
    {
      "id": "K",
      "dimension": "temperature",
      "symbol": "K",
      "name": "kelvin",
      "scaleNumerator": "1",
      "scaleDenominator": "1",
      "offsetNumerator": "0",
      "offsetDenominator": "1",
      "aliases": [
        "kelvin"
      ]
    },
    {
      "id": "degC",
      "dimension": "temperature",
      "symbol": "°C",
      "name": "degree Celsius",
      "scaleNumerator": "1",
      "scaleDenominator": "1",
      "offsetNumerator": "27315",
      "offsetDenominator": "100",
      "aliases": [
        "C",
        "celsius"
      ]
    },
    {
      "id": "degF",
      "dimension": "temperature",
      "symbol": "°F",
      "name": "degree Fahrenheit",
      "scaleNumerator": "5",
      "scaleDenominator": "9",
      "offsetNumerator": "229835",
      "offsetDenominator": "900",
      "aliases": [
        "F",
        "fahrenheit"
      ]
    },
    {
      "id": "A",
      "dimension": "electric_current",
      "symbol": "A",
      "name": "ampere",
      "scaleNumerator": "1",
      "scaleDenominator": "1",
      "offsetNumerator": "0",
      "offsetDenominator": "1",
      "prefixable": True,
      "aliases": [
        "ampere"
      ]
    },
    {
      "id": "V",
      "dimension": "voltage",
      "symbol": "V",
      "name": "volt",
      "scaleNumerator": "1",
      "scaleDenominator": "1",
      "offsetNumerator": "0",
      "offsetDenominator": "1",
      "prefixable": True,
      "aliases": [
        "volt"
      ]
    },
    {
      "id": "ohm",
      "dimension": "resistance",
      "symbol": "Ω",
      "name": "ohm",
      "scaleNumerator": "1",
      "scaleDenominator": "1",
      "offsetNumerator": "0",
      "offsetDenominator": "1",
      "prefixable": True,
      "aliases": [
        "Ohm"
      ]
    },
    {
      "id": "W",
      "dimension": "power",
      "symbol": "W",
      "name": "watt",
      "scaleNumerator": "1",
      "scaleDenominator": "1",
      "offsetNumerator": "0",
      "offsetDenominator": "1",
      "prefixable": True,
      "aliases": [
        "watt"
      ]
    },
    {
      "id": "J",
      "dimension": "energy",
      "symbol": "J",
      "name": "joule",
      "scaleNumerator": "1",
      "scaleDenominator": "1",
      "offsetNumerator": "0",
      "offsetDenominator": "1",
      "prefixable": True,
      "aliases": [
        "joule"
      ]
    },
    {
      "id": "Pa",
      "dimension": "pressure",
      "symbol": "Pa",
      "name": "pascal",
      "scaleNumerator": "1",
      "scaleDenominator": "1",
      "offsetNumerator": "0",
      "offsetDenominator": "1",
      "prefixable": True,
      "aliases": [
        "pascal"
      ]
    },
    {
      "id": "N",
      "dimension": "force",
      "symbol": "N",
      "name": "newton",
      "scaleNumerator": "1",
      "scaleDenominator": "1",
      "offsetNumerator": "0",
      "offsetDenominator": "1",
      "prefixable": True,
      "aliases": [
        "newton"
      ]
    },
    {
      "id": "Hz",
      "dimension": "frequency",
      "symbol": "Hz",
      "name": "hertz",
      "scaleNumerator": "1",
      "scaleDenominator": "1",
      "offsetNumerator": "0",
      "offsetDenominator": "1",
      "prefixable": True,
      "aliases": [
        "hertz"
      ]
    },
    {
      "id": "wavelength_m",
      "dimension": "wavelength",
      "symbol": "m",
      "name": "metre wavelength",
      "scaleNumerator": "1",
      "scaleDenominator": "1",
      "offsetNumerator": "0",
      "offsetDenominator": "1",
      "prefixable": True,
      "aliases": []
    },
    {
      "id": "rad",
      "dimension": "angle",
      "symbol": "rad",
      "name": "radian",
      "scaleNumerator": "1",
      "scaleDenominator": "1",
      "offsetNumerator": "0",
      "offsetDenominator": "1",
      "aliases": [
        "radian"
      ]
    },
    {
      "id": "deg",
      "dimension": "angle",
      "symbol": "°",
      "name": "degree",
      "scaleNumerator": "1745329251994329576923690768488613",
      "scaleDenominator": "100000000000000000000000000000000000",
      "offsetNumerator": "0",
      "offsetDenominator": "1",
      "aliases": [
        "degree"
      ]
    },
    {
      "id": "cd",
      "dimension": "luminous_intensity",
      "symbol": "cd",
      "name": "candela",
      "scaleNumerator": "1",
      "scaleDenominator": "1",
      "offsetNumerator": "0",
      "offsetDenominator": "1",
      "prefixable": True,
      "aliases": [
        "candela"
      ]
    }
  ]
}
