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
  const asset = html.match(/src="([^"]+\.js)"/)[1];
  assert((await fetch(base + asset)).ok);
  assert((await fetch(base + "/maps/12345678-1234-4234-8234-123456789012")).ok);
  const summary = await request("/api/maps", "POST", {
    title: "Compose persistence verification",
  });
  let map = await request(`/api/maps/${summary.id}`);
  map.root.children.push({
    id: "12345678-1234-4234-8234-123456789099",
    text: "Survives recreation",
    collapsed: false,
    children: [],
  });
  map = await request(`/api/maps/${summary.id}`, "PUT", map);
  assert.equal(map.revision, 2);
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
  await compose("restart");
  await ready();
  assert.deepEqual(await request(`/api/maps/${map.id}`), map);
  assert.deepEqual(await request(`/api/maps/${copy.id}`), copy);
  await compose("up", "-d", "--no-build", "--force-recreate");
  await ready();
  assert.deepEqual(await request(`/api/maps/${map.id}`), map);
  assert.deepEqual(await request(`/api/maps/${copy.id}`), copy);
  await request(`/api/maps/${map.id}`, "DELETE");
  assert.equal((await request("/api/trash")).length, 1);
  await request(`/api/trash/${map.id}/restore`, "POST");
  assert.deepEqual(await request(`/api/maps/${map.id}`), map);
  console.log(
    "PASS: Compose build, static assets, SPA fallback, API, duplication, bind-mounted JSON, restart, recreation, trash and restoration.",
  );
} finally {
  await compose("down", "--remove-orphans");
  await rm(directory, { recursive: true, force: true });
}
