importScripts("./dist/uv.bundle.js", "./dist/uv.config.js", "./dist/uv.sw.js");

const ultraviolet = new UVServiceWorker();

self.addEventListener("fetch", (event) => {
  if (ultraviolet.route(event)) {
    event.respondWith(ultraviolet.fetch(event));
  }
});
