import { readFile, readdir, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const root = new URL("../extension/", import.meta.url);
assert.equal(
  await readFile(new URL("page-media.js", root), "utf8"),
  await readFile(new URL("media.js", root), "utf8"),
  "Run npm run build after editing media.js",
);
const manifest = JSON.parse(
  await readFile(new URL("manifest.json", root), "utf8"),
);
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ["downloads"]);
for (const key of [
  "host_permissions",
  "optional_permissions",
  "update_url",
  "externally_connectable",
  "web_accessible_resources",
]) {
  assert.equal(
    manifest[key],
    undefined,
    `Unexpected access/update mechanism: ${key}`,
  );
}
const matches = [
  "https://x.com/*",
  "https://www.x.com/*",
  "https://twitter.com/*",
  "https://www.twitter.com/*",
];
for (const script of manifest.content_scripts) {
  assert.deepEqual(script.matches, matches);
  for (const file of script.js) await access(new URL(file, root));
}
await access(new URL(manifest.background.service_worker, root));
await access(new URL(manifest.action.default_popup, root));
for (const file of Object.values(manifest.icons))
  await access(new URL(file, root));
for (const name of await readdir(root)) {
  if (!name.endsWith(".js")) continue;
  const file = new URL(name, root);
  execFileSync(process.execPath, ["--check", file.pathname], {
    stdio: "inherit",
  });
  const code = await readFile(file, "utf8");
  assert.ok(
    !/\beval\s*\(|new\s+Function\s*\(|\bimport\s*\(/.test(code),
    `Dynamic code in ${name}`,
  );
}
console.log("Manifest scope, packaged files, and JavaScript syntax verified.");
