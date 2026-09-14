/**
 * Mock for expo-sharing.
 *
 * The share sheet is the one step of an export only the operating system can
 * take, so tests stand in for it and assert what was handed over instead.
 */

export const isAvailableAsync = jest.fn().mockResolvedValue(true);
export const shareAsync = jest.fn().mockResolvedValue(undefined);
