(() => {
  const install = function installAntarcticLinkRewriter(backend) {
    const marker = "data-antarctic-link-rewritten";

    const encodePayload = (value) => {
      const bytes = unescape(encodeURIComponent(value));
      return btoa(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    };

    const randomPart = () => {
      try {
        return crypto.randomUUID().replaceAll("-", "").slice(0, 16);
      } catch {
        return Math.random().toString(36).slice(2, 18).padEnd(16, "0");
      }
    };

    const rewriteLinks = (root) => {
      const baseUrl = document.baseURI || location.href;
      for (const anchor of root.querySelectorAll?.("a[href]") || []) {
        if (anchor.hasAttribute(marker) || anchor.dataset.antarcticTarget) continue;

        const rawHref = anchor.getAttribute("scramjet-attr-href")
          || anchor.getAttribute("__uv-attr-href")
          || anchor.getAttribute("href");
        if (!rawHref || /^(?:#|javascript:|mailto:|tel:|data:|antarctic:)/i.test(rawHref)) continue;

        let targetUrl;
        try {
          targetUrl = new URL(rawHref, baseUrl);
        } catch {
          continue;
        }
        if (!/^https?:$/.test(targetUrl.protocol)) continue;

        const target = targetUrl.href;
        const payload = encodePayload(JSON.stringify({ backend, target }));
        anchor.dataset.antarcticTarget = target;
        anchor.setAttribute(marker, "1");
        anchor.setAttribute("href", `antarctic://relay/${randomPart()}.${payload}`);
      }
    };

    rewriteLinks(document);
    new MutationObserver(() => rewriteLinks(document)).observe(document.documentElement || document, {
      childList: true,
      subtree: true,
    });
  };

  self.antarcticLinkRewriterSource = (backend) => `(${install.toString()})(${JSON.stringify(backend)})`;
})();
