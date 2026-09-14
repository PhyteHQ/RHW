/* Utilities required while the first dashboard script is loading. */
if (typeof window.debounce !== 'function') {
  window.debounce = function debounceBootstrap(func, wait) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  };
}

/* The runtime smoke harness inlines the V4 bundle after the stable dashboard
   scripts. In that environment dynamic loading would execute the app twice. */
if (!window.__RHW_SMOKE_INLINE__) {
  /* The stylesheet and dashboard bundle load with the page. Boot workspaces
     after the dashboard mounts exist; the manifest defines deterministic order. */
  (function bootstrapRhwV4Preview() {
    const RHW_V4_ASSET_REV = window.RHW_BUILD?.revision || 'unavailable';
    const versioned = src => `${src}?v=${encodeURIComponent(RHW_V4_ASSET_REV)}`;

    window.addEventListener('DOMContentLoaded', () => {
      if (document.documentElement.dataset.rhwApp === 'v4') return;
      const files = [['./js/rhw-workspaces.js', 'rhwWorkspaces']];

      const showBootFailure = (src, reason = 'LOAD ERROR') => {
        document.documentElement.dataset.rhwBootError = 'true';
        document.documentElement.classList.remove('rhw-loading');
        document.documentElement.dataset.rhwBootAsset = src;
        let panel = document.getElementById('rhwBootFailure');
        if (!panel) {
          panel = document.createElement('aside');
          panel.id = 'rhwBootFailure';
          panel.setAttribute('role', 'alert');
          panel.style.cssText = 'position:fixed;z-index:2147483647;inset:auto 12px 12px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 16px;border:1px solid #c75e5e;background:#120b0d;color:#f0d7d7;font:700 12px/1.45 monospace;box-shadow:0 12px 40px #000';
          const copy = document.createElement('span');
          copy.dataset.bootFailureCopy = 'true';
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.textContent = 'RETRY';
          retry.style.cssText = 'min-height:44px;padding:8px 14px;border:1px solid #c75e5e;background:#2a1117;color:#fff;font:700 11px monospace;cursor:pointer';
          retry.addEventListener('click', () => window.location.reload());
          panel.append(copy, retry);
          document.body.appendChild(panel);
        }
        const copy = panel.querySelector('[data-boot-failure-copy]');
        if (copy) copy.textContent = `RHW WEB APP COULD NOT START // ${src} // ${reason}`;
      };

      if (!window.RHW_BUILD?.revision) {
        showBootFailure('./js/build-info.js', 'BUILD METADATA UNAVAILABLE');
        return;
      }

      const loadNext = index => {
        if (index >= files.length) {
          document.documentElement.dataset.rhwBootChain = 'complete';
          return;
        }
        const [src, dataKey] = files[index];
        if (window.__RHW_BOOTSTRAP_TEST__?.failAsset === src) {
          showBootFailure(src, 'SIMULATED FAILURE');
          return;
        }
        const script = document.createElement('script');
        script.src = versioned(src);
        script.dataset[dataKey] = 'true';
        const timeout = window.setTimeout(() => {
          script.remove();
          showBootFailure(src, 'LOAD TIMEOUT');
        }, 15000);
        script.addEventListener('load', () => {
          window.clearTimeout(timeout);
          loadNext(index + 1);
        }, { once: true });
        script.addEventListener('error', () => {
          window.clearTimeout(timeout);
          showBootFailure(src, 'LOAD ERROR');
        }, { once: true });
        document.body.appendChild(script);
      };
      // Fetch ahead while preserving deterministic script execution order.
      files.forEach(([src]) => {
        const preload = document.createElement('link');
        preload.rel = 'preload'; preload.as = 'script'; preload.href = versioned(src);
        document.head.appendChild(preload);
      });
      loadNext(0);
    }, { once: true });
  })();
}