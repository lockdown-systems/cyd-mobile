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

module.exports = config;
