#!/usr/bin/env node

const fs = require("fs");

const [jsonPath, platform = "artifact"] = process.argv.slice(2);

if (!jsonPath) {
  console.error(
    "Usage: node scripts/ci/extract-eas-artifact-url.js <json-path> [platform]",
  );
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const build = Array.isArray(payload) ? payload[payload.length - 1] : payload;
const artifactUrl = build?.artifacts?.buildUrl;

if (!artifactUrl) {
  console.error(
    `Missing ${platform} artifact URL in EAS build output: ${jsonPath}`,
  );
  process.exit(1);
}

process.stdout.write(artifactUrl);
