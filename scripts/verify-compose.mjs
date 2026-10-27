import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(path.join(root, ".compose-verify-"));
const project = `maplora-verify-${Date.now()}`;
const port = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.on("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const port = probe.address().port;
    probe.close(() => resolve(port));
  });
});
const env = { ...process.env, DATA_PATH: directory, HOST_PORT: String(port) };
function compose(...args) {
  return new Promise((resolve, reject) => {
    const process = spawn("docker", ["compose", "-p", project, ...args], {
      cwd: root,
      env,
      stdio: "inherit",
    });
    process.on("error", reject);
    process.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`docker compose ${args.join(" ")} exited ${code}`)),
    );
  });
}
const base = `http://127.0.0.1:${port}`;
async function request(route, method = "GET", body) {
  const result = await fetch(base + route, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert(result.ok, `${method} ${route} returned ${result.status}`);
  return result.status === 204 ? undefined : result.json();
}
async function ready() {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(base + "/api/maps")).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Compose server did not become ready within 60 seconds");
}
try {
  await compose("build");
  await compose("up", "-d", "--no-build");
  await ready();
  const page = await fetch(base + "/");
  assert(page.ok);
  const html = await page.text();
  assert(html.includes('id="root"'));
  assert(html.includes("maplora-theme"));
  assert(html.indexOf("maplora-theme") < html.indexOf("<body>"));
  const asset = html.match(/src="([^"]+\.js)"/)[1];
  assert((await fetch(base + asset)).ok);
  assert((await fetch(base + "/maps/12345678-1234-4234-8234-123456789012")).ok);
  const summary = await request("/api/maps", "POST", {
    title: "Compose persistence verification",
  });
  let map = await request(`/api/maps/${summary.id}`);
  map.root.children.push(
    {
      id: "12345678-1234-4234-8234-123456789099",
      text: "Survives recreation",
      collapsed: false,
      style: {
        backgroundColor: "#ffcc44",
        textColor: "#123456",
        connectorColor: "#cc2277",
        connectorStyle: "dotted",
        connectorWidth: 8,
      },
      children: [
        {
          id: "12345678-1234-4234-8234-123456789097",
          text: "Moves with its parent",
          collapsed: false,
          children: [],
        },
      ],
    },
    {
      id: "12345678-1234-4234-8234-123456789098",
      text: "Reordered sibling",
      collapsed: false,
      children: [],
    },
  );
  map = await request(`/api/maps/${summary.id}`, "PUT", map);
  assert.equal(map.revision, 2);
  map.root.children.reverse();
  map = await request(`/api/maps/${summary.id}`, "PUT", map);
  assert.equal(map.revision, 3);
  assert.deepEqual(
    map.root.children.map((node) => node.text),
    ["Reordered sibling", "Survives recreation"],
  );
  const branch = map.root.children.pop();
  map.root.children[0].children.push(branch);
  map = await request(`/api/maps/${summary.id}`, "PUT", map);
  assert.equal(map.revision, 4);
  assert.equal(map.root.children.length, 1);
  assert.deepEqual(map.root.children[0].children[0], branch);
  assert.equal(
    map.root.children[0].children[0].children[0].text,
    "Moves with its parent",
  );
  assert.deepEqual(
    JSON.parse(await readFile(path.join(directory, `${map.id}.json`), "utf8")),
    map,
  );
  const duplicate = await request(`/api/maps/${map.id}/duplicate`, "POST");
  const copy = await request(`/api/maps/${duplicate.id}`);
  assert.notEqual(copy.id, map.id);
  assert.equal(copy.title, `${map.title} (Copy)`);
  assert.equal(copy.revision, 1);
  assert.notEqual(copy.root.id, map.root.id);
  assert.notEqual(copy.root.children[0].id, map.root.children[0].id);
  assert.equal(copy.root.children[0].text, map.root.children[0].text);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(directory, `${copy.id}.json`), "utf8")),
    copy,
  );
  const importedSummary = await request("/api/maps/import", "POST", map);
  const imported = await request(`/api/maps/${importedSummary.id}`);
  assert.notEqual(imported.id, map.id);
  assert.equal(imported.revision, 1);
  assert.equal(imported.createdAt, map.createdAt);
  assert.equal(imported.updatedAt, map.updatedAt);
  function compareImport(source, result) {
    assert.notEqual(result.id, source.id);
    assert.deepEqual(
      { ...result, id: source.id, children: source.children },
      source,
    );
    source.children.forEach((child, index) =>
      compareImport(child, result.children[index]),
    );
  }
  compareImport(map.root, imported.root);
  assert.deepEqual(
    JSON.parse(
      await readFile(path.join(directory, `${imported.id}.json`), "utf8"),
    ),
    imported,
  );
  await compose("restart");
  await ready();
  assert.deepEqual(await request(`/api/maps/${map.id}`), map);
  assert.deepEqual(await request(`/api/maps/${copy.id}`), copy);
  assert.deepEqual(await request(`/api/maps/${imported.id}`), imported);
  await compose("up", "-d", "--no-build", "--force-recreate");
  await ready();
  assert.deepEqual(await request(`/api/maps/${map.id}`), map);
  assert.deepEqual(await request(`/api/maps/${copy.id}`), copy);
  assert.deepEqual(await request(`/api/maps/${imported.id}`), imported);
  await request(`/api/maps/${map.id}`, "DELETE");
  assert.equal((await request("/api/trash")).length, 1);
  await request(`/api/trash/${map.id}/restore`, "POST");
  assert.deepEqual(await request(`/api/maps/${map.id}`), map);
  console.log(
    "PASS: Compose build, static assets, theme bootstrap, SPA fallback, API, duplication, JSON import with conflict replacement, sibling order, branch moves, custom styles, bind-mounted JSON, restart, recreation, trash and restoration.",
  );
} finally {
  await compose("down", "--remove-orphans");
  await rm(directory, { recursive: true, force: true });
}
