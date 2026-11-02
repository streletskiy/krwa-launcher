# Production runtime images

Compose builds these small images locally. Node services need only built-in
modules; their runtime removes npm/Yarn and their unused dependency trees.
The Caddy image uses Go 1.27.3, refreshed compatible modules and patched Alpine.

The JOSE v3 dependency uses the official [RSA backport](https://github.com/go-jose/go-jose/commit/0e502b87c7aa651155b11ae8e195ec33ce10230a).
Two unchanged upstream patches add a [JSON depth bound](https://github.com/go-jose/go-jose/commit/a31af25836222f4c45d366d6e8f9b1049dd9935a)
and reject [empty CBC ciphertext](https://github.com/go-jose/go-jose/commit/35883f7999e87cbd1b1f4cda07fdad8cd71c3dd6).
They are applied to vendored build inputs; source licenses are retained.
Regression tests cover the three attacks and normal RSA signing.

`caddy/openvex.json` describes one inventory false positive:
[GO-2026-5932](https://pkg.go.dev/vuln/GO-2026-5932) applies only to OpenPGP,
which is absent from this binary. A build assertion checks its absence.
The statement is scoped to this Go project and exact x/crypto version;
it is not a blanket advisory exclusion. Security CI scans every severity,
including unfixed findings, and applies this reviewed statement.

Remove the two JOSE patches when v3 includes them or its dependency moves to v4.
