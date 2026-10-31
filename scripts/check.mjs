import { readFile, readdir, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { redditBundle } from "./reddit-bundle.mjs";
import { root, extensionUrl, selectedPlugins } from "./plugins.mjs";

for (const plugin of selectedPlugins()) {
  const directory = extensionUrl(plugin);
  assert.equal(
    await readFile(new URL("page-media.js", directory), "utf8"),
    await readFile(new URL("media.js", directory), "utf8"),
    `Run npm run build for ${plugin.id}`,
  );
  for (const file of ["popup.html", "popup.js", "popup.css"]) {
    assert.equal(
      await readFile(new URL(file, directory), "utf8"),
      await readFile(new URL(`shared/${file}`, root), "utf8"),
      `Generated UI drift: ${plugin.id}/${file}`,
    );
  }
  const manifest = JSON.parse(
    await readFile(new URL("manifest.json", directory), "utf8"),
  );
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, plugin.permissions || ["downloads"]);
  assert.deepEqual(manifest.host_permissions, plugin.hosts);
  if (plugin.id === "rd-downloader") {
    const bundle = await redditBundle(false);
    assert.equal(
      await readFile(new URL("mux.js", directory), "utf8"),
      bundle,
      "Run npm run build for Reddit mux code",
    );
    for (const file of [
      "offscreen.html",
      "offscreen.js",
      "redgifs.js",
      "MP4BOX-LICENSE.txt",
    ])
      await access(new URL(file, directory));
  }
  for (const key of [
    "optional_permissions",
    "update_url",
    "externally_connectable",
    "web_accessible_resources",
  ])
    assert.equal(manifest[key], undefined, `Unexpected ${key} in ${plugin.id}`);
  for (const script of manifest.content_scripts) {
    assert.deepEqual(script.matches, plugin.matches);
    for (const file of script.js) await access(new URL(file, directory));
  }
  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    "site.js",
    ...Object.values(manifest.icons),
  ])
    await access(new URL(file, directory));
  for (const name of await readdir(directory)) {
    if (!name.endsWith(".js")) continue;
    const file = new URL(name, directory);
    execFileSync(process.execPath, ["--check", file.pathname], {
      stdio: "inherit",
    });
    assert.ok(
      !/\beval\s*\(|new\s+Function\s*\(|\bimport\s*\(/.test(
        await readFile(file, "utf8"),
      ),
      `Dynamic code in ${plugin.id}/${name}`,
    );
  }
  console.log(
    `${plugin.id}: manifest scope, generated UI, packaged files and syntax verified.`,
  );
}
