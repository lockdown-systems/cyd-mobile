/**
 * Mock for expo-video module
 */

export const useVideoPlayer = jest.fn(() => ({
  play: jest.fn(),
  pause: jest.fn(),
  seek: jest.fn(),
  currentTime: 0,
  duration: 0,
  status: "idle",
}));

export const VideoView = () => null;

export const isPictureInPictureSupported = jest.fn(() => false);
export const clearVideoCacheAsync = jest.fn();
export const setVideoCacheSizeAsync = jest.fn();
export const getCurrentVideoCacheSize = jest.fn(() => 0);
