/**
 * Mock for expo-keep-awake
 */

export const useKeepAwake = jest.fn();
export const activateKeepAwake = jest.fn();
export const deactivateKeepAwake = jest.fn();
export const activateKeepAwakeAsync = jest.fn().mockResolvedValue(undefined);
export const deactivateKeepAwakeAsync = jest.fn().mockResolvedValue(undefined);
