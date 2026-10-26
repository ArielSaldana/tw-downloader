import { mkdir, readdir, rm, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  root,
  extensionUrl,
  extensionPath,
  selectedPlugins,
} from "./plugins.mjs";

for (const plugin of selectedPlugins()) {
  execFileSync(process.execPath, ["scripts/check.mjs", plugin.id], {
    cwd: fileURLToPath(root),
    stdio: "inherit",
  });
  await mkdir(new URL("dist/", root), { recursive: true });
  const manifest = JSON.parse(
    await readFile(new URL("manifest.json", extensionUrl(plugin)), "utf8"),
  );
  const output = new URL(`dist/${plugin.id}-${manifest.version}.zip`, root);
  await rm(output, { force: true });
  execFileSync(
    "zip",
    [
      "-X",
      "-q",
      fileURLToPath(output),
      ...(await readdir(extensionUrl(plugin))).sort(),
    ],
    { cwd: extensionPath(plugin) },
  );
  console.log(
    `${fileURLToPath(output)}\nSHA-256: ${createHash("sha256")
      .update(await readFile(output))
      .digest("hex")}`,
  );
}
