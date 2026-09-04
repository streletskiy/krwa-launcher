# Create Fly: Power Loader metadata fix

Upstream artifact SHA-256: `B561818B8B4893757820AE247CEE08B1A771D5361D24B2353519472873F9C1A4`.

The upstream `fabric.mod.json` has a literal line break inside `description`, so strict JSON parsers reject it. The replacement file only escapes that line break as `\n\n`; mod classes and resources are unchanged.

Apply with the included helper:

```text
apply.cmd path\to\create-fly-power-loader-fabric-26.2-1.0.0.jar
```
