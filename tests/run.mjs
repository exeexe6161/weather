import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const testsDir = fileURLToPath(new URL("./", import.meta.url));
const entryPoints = {
  "api-routes.test": resolve(testsDir, "api-routes.test.ts"),
  "client-requests.test": resolve(testsDir, "client-requests.test.ts"),
  "favorites-cache.test": resolve(testsDir, "favorites-cache.test.ts"),
  "favorites.test": resolve(testsDir, "favorites.test.ts"),
  "forecast-cache.test": resolve(testsDir, "forecast-cache.test.ts"),
  "link-resolution.test": resolve(testsDir, "link-resolution.test.ts"),
  "loadError.test": resolve(testsDir, "loadError.test.ts"),
  "provider-characterization.test": resolve(testsDir, "provider-characterization.test.ts"),
};
// Diese Tests laufen direkt als TypeScript über Nodes Type Stripping (sie
// bündeln ihre Prüflinge selbst über testHarness.loadBundledModule) — nicht
// vorbündeln, sonst würde der esbuild-Import im Harness mitgebündelt.
const directTests = [
  "tempCompare.test.ts",
  "serverRoutes.test.ts",
  "weatherApiProvider.test.ts",
  "weatherQuotaGuard.test.ts",
  "weatherServiceCache.test.ts",
  "uiLabels.test.ts",
].map((name) => resolve(testsDir, name));
const outputDir = await mkdtemp(join(tmpdir(), "weatherpure-tests-"));

let exitCode = 1;
try {
  await build({
    entryPoints,
    outdir: outputDir,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "warning",
  });

  const testFiles = Object.keys(entryPoints).map((name) => join(outputDir, `${name}.js`));
  exitCode = await new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, ["--test", ...testFiles, ...directTests], { stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code) => resolveExit(code ?? 1));
  });
} finally {
  await rm(outputDir, { recursive: true, force: true });
}

process.exitCode = exitCode;
