#!/usr/bin/env node

/**
 * Submit an Android App Bundle (.aab) to Google Play Console's internal testing track.
 *
 * This script uploads directly via the Google Play Developer Publishing API —
 * no EAS service required.
 *
 * Prerequisites:
 *   1. Create a Google Play service account:
 *      - Google Play Console → Setup → API access
 *      - Link a Google Cloud project (or create one)
 *      - Create a service account with a JSON key
 *      - Grant it "Release to production, exclude devices, and use Play App Signing"
 *        permission on your app
 *   2. Place the JSON key at the project root as:
 *      google-play-service-account.json   (already .gitignored)
 *   3. You must have already uploaded your first AAB manually via Google Play Console.
 *
 * Usage:
 *   npm run submit:android              # submits the latest .aab in the project
 *   npm run submit:android -- path.aab  # submits a specific .aab
 *   npm run submit:android -- --release-status=draft
 *   PLAY_RELEASE_STATUS=draft npm run submit:android
 */

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const PACKAGE_NAME = "systems.lockdown.cydmobile";
const SERVICE_ACCOUNT_KEY_PATH = path.resolve(
  __dirname,
  "..",
  "google-play-service-account.json",
);
const TRACK = "internal";

function parseReleaseStatus(argv) {
  const statusArg = argv.find((arg) => arg.startsWith("--release-status="));
  const statusFromArg = statusArg?.split("=")[1]?.trim();
  const statusFromEnv = process.env.PLAY_RELEASE_STATUS?.trim();
  const candidate = (
    statusFromArg ||
    statusFromEnv ||
    "completed"
  ).toLowerCase();

  const allowedStatuses = new Set([
    "draft",
    "inprogress",
    "halted",
    "completed",
  ]);

  if (!allowedStatuses.has(candidate)) {
    console.error(
      `Error: Invalid release status "${candidate}". Expected one of: draft, inProgress, halted, completed.`,
    );
    process.exit(1);
  }

  return candidate;
}

function isDraftAppStatusError(err) {
  const apiError = err?.response?.data?.error;
  if (!apiError) {
    return false;
  }

  const combinedMessage = [
    apiError.message,
    ...(Array.isArray(apiError.errors)
      ? apiError.errors.map((e) => `${e.message} ${e.reason}`)
      : []),
  ]
    .join(" ")
    .toLowerCase();

  return combinedMessage.includes(
    "only releases with status draft may be created on draft app",
  );
}

async function updateTrackReleaseStatus({
  androidPublisher,
  editId,
  versionCode,
  releaseStatus,
}) {
  await androidPublisher.edits.tracks.update({
    packageName: PACKAGE_NAME,
    editId,
    track: TRACK,
    requestBody: {
      track: TRACK,
      releases: [
        {
          versionCodes: [String(versionCode)],
          status: releaseStatus,
        },
      ],
    },
  });
}

async function main() {
  // --- Validate service account key ---
  if (!fs.existsSync(SERVICE_ACCOUNT_KEY_PATH)) {
    console.error(
      `Error: Google Play service account key not found at:\n  ${SERVICE_ACCOUNT_KEY_PATH}\n`,
    );
    console.error("To set up automated Android submissions:");
    console.error("  1. Go to Google Play Console → Setup → API access");
    console.error("  2. Create a service account with a JSON key");
    console.error(
      "  3. Save the JSON key as: google-play-service-account.json",
    );
    process.exit(1);
  }

  // --- Find the .aab ---
  const cliArgs = process.argv.slice(2);
  const aabArg = cliArgs.find((arg) => !arg.startsWith("--"));
  let aabPath = aabArg;
  let releaseStatus = parseReleaseStatus(cliArgs);

  if (!aabPath) {
    // Find the most recently modified .aab in the project root
    const projectRoot = path.resolve(__dirname, "..");
    const aabFiles = fs
      .readdirSync(projectRoot)
      .filter((f) => f.endsWith(".aab"))
      .map((f) => ({
        name: f,
        fullPath: path.join(projectRoot, f),
        mtime: fs.statSync(path.join(projectRoot, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (aabFiles.length === 0) {
      console.error("Error: No .aab file found in the project directory.");
      console.error(
        "Run 'npm run build:android' first, or pass the path as an argument.",
      );
      process.exit(1);
    }

    aabPath = aabFiles[0].fullPath;
  }

  if (!fs.existsSync(aabPath)) {
    console.error(`Error: File not found: ${aabPath}`);
    process.exit(1);
  }

  const aabSize = (fs.statSync(aabPath).size / (1024 * 1024)).toFixed(1);
  console.log(
    `Uploading ${path.basename(aabPath)} (${aabSize} MB) to Google Play Console...`,
  );
  console.log(`  Package: ${PACKAGE_NAME}`);
  console.log(`  Track:   ${TRACK}`);
  console.log(`  Status:  ${releaseStatus}`);
  console.log();

  // --- Authenticate with service account ---
  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_KEY_PATH,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });

  const androidPublisher = google.androidpublisher({
    version: "v3",
    auth,
  });

  try {
    // 1. Create a new edit
    console.log("Creating edit...");
    const editResponse = await androidPublisher.edits.insert({
      packageName: PACKAGE_NAME,
    });
    const editId = editResponse.data.id;

    // 2. Upload the AAB
    console.log("Uploading bundle (this may take a moment)...");
    const uploadResponse = await androidPublisher.edits.bundles.upload({
      packageName: PACKAGE_NAME,
      editId,
      media: {
        mimeType: "application/octet-stream",
        body: fs.createReadStream(aabPath),
      },
    });
    const versionCode = uploadResponse.data.versionCode;
    console.log(`  Bundle uploaded — versionCode: ${versionCode}`);

    // 3. Assign to the internal track
    console.log(`Assigning to "${TRACK}" track...`);
    try {
      await updateTrackReleaseStatus({
        androidPublisher,
        editId,
        versionCode,
        releaseStatus,
      });
    } catch (trackErr) {
      if (releaseStatus !== "draft" && isDraftAppStatusError(trackErr)) {
        console.log(
          '  App appears to still be in draft state. Retrying with release status "draft"...',
        );
        releaseStatus = "draft";
        await updateTrackReleaseStatus({
          androidPublisher,
          editId,
          versionCode,
          releaseStatus,
        });
      } else {
        throw trackErr;
      }
    }

    // 4. Commit the edit
    console.log("Committing edit...");
    try {
      await androidPublisher.edits.commit({
        packageName: PACKAGE_NAME,
        editId,
      });
    } catch (commitErr) {
      if (releaseStatus !== "draft" && isDraftAppStatusError(commitErr)) {
        console.log(
          '  Commit rejected for draft app. Switching release status to "draft" and retrying...',
        );
        releaseStatus = "draft";
        await updateTrackReleaseStatus({
          androidPublisher,
          editId,
          versionCode,
          releaseStatus,
        });
        console.log("Retrying commit...");
        await androidPublisher.edits.commit({
          packageName: PACKAGE_NAME,
          editId,
        });
      } else {
        throw commitErr;
      }
    }

    console.log();
    console.log(
      `Upload complete! Version code ${versionCode} is now on the "${TRACK}" track with status "${releaseStatus}".`,
    );
  } catch (err) {
    console.error();
    console.error("Google Play API error:");
    if (err.response?.data?.error) {
      const apiError = err.response.data.error;
      console.error(`  ${apiError.code} ${apiError.message}`);
      if (apiError.errors) {
        for (const e of apiError.errors) {
          console.error(`  - ${e.message} (${e.reason})`);
        }
      }
    } else {
      console.error(err.message || err);
    }
    process.exit(1);
  }
}

main();
