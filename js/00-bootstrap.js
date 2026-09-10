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
  /* V4 is intentionally layered on top of the stable V3.6 command dashboard.
     Load every V4 stylesheet immediately to avoid an unstyled app-shell flash,
     but wait until the stable dashboard has initialized before booting V4 JS. */
  (function bootstrapRhwV4Preview() {
    const RHW_V4_ASSET_REV = window.RHW_BUILD?.revision || 'unavailable';
    const versioned = src => `${src}?v=${encodeURIComponent(RHW_V4_ASSET_REV)}`;

    [
      ['./css/12-app-v40.css', 'rhwV4App'],
      ['./css/13-app-v40-navigation.css', 'rhwV40Nodes'],
      ['./css/14-app-v40-composer.css', 'rhwV40Composer'],
      ['./css/15-app-v40-audit.css', 'rhwV40Polish'],
      ['./css/16-app-v40-operations.css', 'rhwV40Operations'],
      ['./css/17-app-v40-calculator-polish.css', 'rhwV40CalculatorPolish'],
      ['./css/18-app-v40-nav-hierarchy.css', 'rhwV40NavHierarchy'],
      ['./css/19-app-v402-fixes.css', 'rhwV402Fixes'],
      ['./css/20-app-v402-qol.css', 'rhwV402Qol'],
      ['./css/21-app-v402-mobile-ui.css', 'rhwV402MobileUi'],
      ['./css/22-app-pr3-command-mobile.css', 'rhwPr3CommandMobile'],
      ['./css/23-app-pr3-yard-production.css', 'rhwPr3YardProduction'],
      ['./css/24-app-pr3-operations-calculator.css', 'rhwPr3OperationsCalculator'],
      ['./css/25-app-pr3-comms-workflow.css', 'rhwPr3CommsWorkflow'],
      ['./css/26-app-pr3-newswire-manager.css', 'rhwPr3NewswireManager'],
      ['./css/27-app-pr4-pwa.css', 'rhwPr4Pwa'],
      ['./css/28-app-pr5-newswire-2.css', 'rhwPr5Newswire2'],
      ['./css/29-app-pr6-discovery-sync.css', 'rhwPr6DiscoverySync'],
      ['./css/30-app-pr7-diagnostics.css', 'rhwPr7Diagnostics'],
      ['./css/31-app-pr8-production-orders.css', 'rhwPr8ProductionOrders'],
      ['./css/32-app-pr9-transfer-center.css', 'rhwPr9TransferCenter'],
      ['./css/33-app-pr10-newswire-review.css', 'rhwPr10NewswireReview'],
      ['./css/34-app-pr11-full-audit.css', 'rhwPr11FullAudit'],
      ['./css/35-app-interface-cleanup.css', 'rhwInterfaceCleanup']
    ].forEach(([href, dataKey]) => {
      if (document.querySelector(`link[data-${dataKey.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}="true"]`)) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = versioned(href);
      link.dataset[dataKey] = 'true';
      document.head.appendChild(link);
    });

    window.addEventListener('DOMContentLoaded', () => {
      if (document.documentElement.dataset.rhwApp === 'v4') return;
      const files = [
        ['./js/12-app-config.js', 'rhwV4Config'],
        ['./js/13-app-v40.js', 'rhwV4Core'],
        ['./js/14-app-v40-cache.js', 'rhwV4Storage'],
        ['./js/15-app-v40-navigation.js', 'rhwV4Command'],
        ['./js/16-app-v40-composer.js', 'rhwV4Comms'],
        ['./js/16a-app-v40-comms-safety.js', 'rhwV4CommsSafety'],
        ['./js/16b-app-v40-newswire-manager.js', 'rhwV4NewswireManager'],
        ['./js/16c-app-v40-newswire-ordering.js', 'rhwV4NewswireOrdering'],
        ['./assets/recipes/catalog-v1-part-01.js', 'rhwV4RecipeCatalog01'],
        ['./assets/recipes/catalog-v1-part-02.js', 'rhwV4RecipeCatalog02'],
        ['./assets/recipes/catalog-v1-part-03.js', 'rhwV4RecipeCatalog03'],
        ['./assets/recipes/catalog-v1-part-04.js', 'rhwV4RecipeCatalog04'],
        ['./assets/recipes/catalog-v1-part-05.js', 'rhwV4RecipeCatalog05'],
        ['./assets/recipes/catalog-v1-part-06.js', 'rhwV4RecipeCatalog06'],
        ['./js/17-app-v40-operations-core.js', 'rhwV4OperationsCore'],
        ['./js/18-app-v40-operations-ui.js', 'rhwV4OperationsUi'],
        ['./js/18a-app-v40-nav-hierarchy.js', 'rhwV4NavHierarchy'],
        ['./js/18b-app-v40-production-pricing.js', 'rhwV4ProductionPricing'],
        ['./js/18c-app-v40-recipe-corrections.js', 'rhwV4RecipeCorrections'],
        ['./js/18d-app-v40-final-ui-polish.js', 'rhwV4FinalUiPolish'],
        ['./js/20-app-v402-fixes.js', 'rhwV402Fixes'],
        ['./js/21-app-v402-qol.js', 'rhwV402Qol'],
        ['./js/22-app-v402-mobile-ui.js', 'rhwV402MobileUi'],
        ['./js/23-app-v40-pwa.js', 'rhwV40Pwa'],
        ['./js/24-app-v40-newswire-2.js', 'rhwPr5Newswire2'],
        ['./js/25-app-v40-discovery-status.js', 'rhwPr6DiscoveryStatus'],
        ['./js/26-app-v40-diagnostics.js', 'rhwPr7Diagnostics'],
        ['./js/27-app-v40-production-orders.js', 'rhwPr8ProductionOrders'],
        ['./js/28-app-v40-transfer-center.js', 'rhwPr9TransferCenter'],
        ['./js/29-app-v40-newswire-review.js', 'rhwPr10NewswireReview'],
        ['./js/30-app-v40-full-audit.js', 'rhwPr11FullAudit'],
        ['./js/31-app-command-rework.js', 'rhwCommandRework'],
        ['./js/32-app-unified-workspaces.js', 'rhwUnifiedWorkspaces'],
        ['./js/33-app-ui-polish-fix.js', 'rhwUiPolishFix'],
        ['./js/34-app-stability-polish.js', 'rhwStabilityPolish'],
        ['./js/35-app-command-compact-polish.js', 'rhwCommandCompactPolish'],
        ['./js/36-app-focus-pass.js', 'rhwFocusPass'],
        ['./js/37-app-price-check.js', 'rhwPriceCheck'],
        ['./js/19-app-v40-runtime.js', 'rhwV4Runtime']
      ];

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