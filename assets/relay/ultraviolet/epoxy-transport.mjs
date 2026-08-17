import "../package/dist/epoxy-transport.js?antarctic-local-cert-fix=1";

const EpoxyTransport = globalThis.EpoxyTransport.default;

export default class UltravioletEpoxyTransport {
  constructor(wisp) {
    this.transport = new EpoxyTransport({ wisp });
  }

  get ready() {
    return this.transport.ready;
  }

  init() {
    return this.transport.init();
  }

  meta() {
    return this.transport.meta();
  }

  request(remote, method, body, headers, signal) {
    const entries = headers instanceof Headers
      ? [...headers]
      : Array.isArray(headers)
        ? headers
        : Object.entries(headers || {});
    return this.transport.request(remote, method, body, entries, signal);
  }

  connect(url, _origin, protocols, requestHeaders, onopen, onmessage, onclose, onerror) {
    return this.transport.connect(
      url,
      protocols,
      Array.isArray(requestHeaders) ? requestHeaders : Object.entries(requestHeaders || {}),
      onopen,
      onmessage,
      onclose,
      onerror
    );
  }
}
