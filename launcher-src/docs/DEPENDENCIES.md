# Security dependency adapters

The 0.1.25 build uses minimatch 11.0.4 and glob 14.0.3 to remove
GHSA-g3hv-75wg-m249 and GHSA-3g3m-2fjr-6pw4. ASAR is upgraded to 4.3.1;
Node 22.12 or newer is required for build tools.

`scripts/patch-build-dependencies.cjs` runs on a clean npm install. It adapts
dir-compare's old callable minimatch import and moves temp's literal-path
cleanup to Node's fs.rm. Unexpected upstream source changes fail installation
so the adapters must be reviewed. Tests exercise filtered comparisons and
both cleanup APIs; all three platform builds verify ASAR packaging.

These adapters can be removed when upstream dir-compare/temp migrate their
APIs. Security audits remain enabled, without new advisory exceptions.
