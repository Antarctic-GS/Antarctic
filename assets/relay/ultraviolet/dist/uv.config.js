/*global Ultraviolet*/

const configUrl = typeof document !== "undefined" && document.currentScript?.src
  ? document.currentScript.src
  : self.location.href;
const configDirectory = new URL("./", configUrl).pathname;
const relayRoot = configDirectory.endsWith("/dist/")
  ? configDirectory.slice(0, -"dist/".length)
  : configDirectory;

self.__uv$config = {
  prefix: `${relayRoot}service/`,
  encodeUrl: Ultraviolet.codec.xor.encode,
  decodeUrl: Ultraviolet.codec.xor.decode,
  handler: `${relayRoot}dist/uv.handler.js`,
  client: `${relayRoot}dist/uv.client.js`,
  bundle: `${relayRoot}dist/uv.bundle.js`,
  config: `${relayRoot}dist/uv.config.js`,
  sw: `${relayRoot}sw.js`,
};
