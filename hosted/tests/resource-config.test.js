import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hostedRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const compose = fs.readFileSync(path.join(hostedRoot,"docker-compose.yml"), "utf8");

test("compose enforces the lightweight resource budget", () => {
  for (const expected of [
    'cpus: "0.25"',
    "mem_limit: 256m",
    "mem_reservation: 64m",
    "pids_limit: 64",
    "read_only: true",
    "name: format-inspector-lite-hosted",
    "name: hosted_format-inspector-cloud-data",
    "external: true",
    "cap_drop:",
    "- ALL",
    "no-new-privileges:true",
    'max-size: "10m"',
    'max-file: "3"',
  ]) {
    assert.ok(compose.includes(expected), expected);
  }
});
