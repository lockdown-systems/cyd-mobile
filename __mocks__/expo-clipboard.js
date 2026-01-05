export const setStringAsync = jest.fn().mockResolvedValue(undefined);
export const getStringAsync = jest.fn().mockResolvedValue("");
export const hasStringAsync = jest.fn().mockResolvedValue(false);

const Clipboard = {
  setStringAsync,
  getStringAsync,
  hasStringAsync,
};

export default Clipboard;
