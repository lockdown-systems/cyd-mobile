const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Handle SVG files - use inline requires for the transformer
const { transformer, resolver } = config;
config.transformer = {
  ...transformer,
  babelTransformerPath: require.resolve("react-native-svg-transformer/expo"),
};
config.resolver = {
  ...resolver,
  assetExts: resolver.assetExts.filter((ext) => ext !== "svg"),
  sourceExts: [...resolver.sourceExts, "svg"],
};

// Prefer "react-native" then "browser" exports.
// This ensures we get the browser version of "jose" (which uses WebCrypto)
// instead of the Node version (which uses node:crypto).
config.resolver.unstable_conditionNames = ["react-native", "browser"];
// Work around Metro warnings caused by package-internal cjs requires that are
// valid on disk but not listed in package "exports" maps.
config.resolver.unstable_enablePackageExports = false;

// Remap package-internal deep imports to public export subpaths.
// Some dependencies request cjs/src/* paths that are not exported, which causes
// Metro warnings before falling back to file resolution.
const packageInternalPathRemaps = {
  "multiformats/cjs/src/cid.js": "multiformats/cid",
  "multiformats/cjs/src/bases/base64.js": "multiformats/bases/base64",
  "multiformats/cjs/src/hashes/digest.js": "multiformats/hashes/digest",
  "multiformats/cjs/src/hashes/sha2-browser.js": "multiformats/hashes/sha2",
  "multiformats/cjs/src/basics.js": "multiformats/basics",
  "uint8arrays/cjs/src/from-string.js": "uint8arrays/from-string",
  "uint8arrays/cjs/src/to-string.js": "uint8arrays/to-string",
};

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const remappedModule = packageInternalPathRemaps[moduleName] ?? moduleName;

  if (originalResolveRequest) {
    return originalResolveRequest(context, remappedModule, platform);
  }

  return context.resolveRequest(context, remappedModule, platform);
};

// Ignore specific warnings in LogBox (runtime)
// Note: This doesn't stop the bundler warnings, but helps clean up the device logs.
// Bundler warnings are harder to suppress without patching Metro.

module.exports = config;
