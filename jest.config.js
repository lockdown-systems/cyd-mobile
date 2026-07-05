module.exports = {
  testEnvironment: "node",
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": "babel-jest",
  },
  transformIgnorePatterns: [
    "node_modules/(?!(react-native|@react-native|@react-navigation|expo|@expo|@unimodules|unimodules|sentry-expo|native-base|react-native-svg|react-native-markdown-display|expo-keep-awake|expo-modules-core|@atproto|@atproto-labs|multiformats|uint8arrays|await-lock)/)",
  ],
  setupFilesAfterEnv: ["<rootDir>/jest-setup.ts"],
  collectCoverageFrom: [
    "**/*.{ts,tsx}",
    "!**/*.d.ts",
    "!**/coverage/**",
    "!**/node_modules/**",
    "!**/.expo/**",
    "!**/android/**",
    "!**/ios/**",
  ],
  moduleNameMapper: {
    "\\.(svg)$": "<rootDir>/__mocks__/svgMock.js",
    "react-native-markdown-display":
      "<rootDir>/__mocks__/react-native-markdown-display.js",
    "expo-clipboard": "<rootDir>/__mocks__/expo-clipboard.js",
    "expo-keep-awake": "<rootDir>/__mocks__/expo-keep-awake.js",
    "^multiformats$": "<rootDir>/node_modules/multiformats/dist/src/index.js",
    "^multiformats/(.*)$": "<rootDir>/node_modules/multiformats/dist/src/$1.js",
    "^uint8arrays$": "<rootDir>/node_modules/uint8arrays/dist/src/index.js",
    "^uint8arrays/(.*)$": "<rootDir>/node_modules/uint8arrays/dist/src/$1.js",
    "^await-lock$":
      "<rootDir>/node_modules/@atproto/api/node_modules/await-lock/build/AwaitLock.js",
    "^@/(.*)$": "<rootDir>/$1",
  },
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  testMatch: ["**/__tests__/**/*.test.(ts|tsx|js)"],
  modulePathIgnorePatterns: ["<rootDir>/node_modules/react-native/jest"],
};
