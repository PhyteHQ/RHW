/* ==========================================================================
   RHW WEB APP · V4.0.2 MOBILE UI
   Thumb navigation plus synchronized COMMS write / preview / BB Code lenses.
   ========================================================================== */
(function initRhwV402MobileUi() {
  'use strict';
  const app = window.RHWV4;
  if (!app?.comms || app.mobileUi) return;

  const VIEWS = Object.freeze(['write', 'preview', 'bbcode']);
  const media = window.matchMedia('(max-width: 760px)');
  const viewKey = app.config.storageKeys.commsMobileView || 'rhw-webapp-v4:comms-mobile-view';

  function safeView(value) {
    return VIEWS.includes(value) ? value : 'write';
  }

  function syncMode() {
    document.documentElement.dataset.rhwMobileUi = media.matches ? 'true' : 'false';
  }

  function setForumView(view, { focus = false } = {}) {
    const next = safeView(view);
    document.body.dataset.commsMobileView = next;
    app.store.set(viewKey, next);

    document.querySelectorAll('#commsMobileViewSwitch [data-comms-mobile-view]').forEach(button => {
      const active = button.dataset.commsMobileView === next;
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
      if (active && focus) button.focus();
    });

    if (next !== 'write') app.comms.syncFromForm?.();
    return next;
  }

  function controlsMarkup() {
    const labels = { write: 'WRITE', preview: 'PREVIEW', bbcode: 'BB CODE' };
    return `<nav id="commsMobileViewSwitch" class="comms-mobile-view-switch" aria-label="Mobile forum composer views"><div role="tablist" class="comms-mobile-view-switch-tabs" style="display:contents">${VIEWS.map(view => `<button type="button" role="tab" data-comms-mobile-view="${view}" aria-controls="${view === 'write' ? 'commsComposerPanel' : view === 'preview' ? 'forumLivePreview' : 'forumBbcodeOutput'}"><span>${labels[view]}</span></button>`).join('')}</div></nav>`;
  }

  function ensureControls() {
    const forum = document.querySelector('[data-comms-panel="forum"]');
    if (!forum) return false;
    if (!document.getElementById('commsMobileViewSwitch')) {
      forum.insertAdjacentHTML('afterbegin', controlsMarkup());
      const controls = document.getElementById('commsMobileViewSwitch');
      controls?.addEventListener('click', event => {
        const button = event.target.closest('[data-comms-mobile-view]');
        if (button) setForumView(button.dataset.commsMobileView);
      });
      controls?.addEventListener('keydown', event => {
        const button = event.target.closest('[data-comms-mobile-view]');
        if (!button || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const index = VIEWS.indexOf(button.dataset.commsMobileView);
        const offset = event.key === 'ArrowRight' ? 1 : -1;
        setForumView(VIEWS[(index + offset + VIEWS.length) % VIEWS.length], { focus: true });
      });
    }
    setForumView(app.store.get(viewKey, 'write'));
    return true;
  }

  function selfTest() {
    const failures = [];
    if (!app.config.storageKeys.commsMobileView) failures.push('missing-view-storage-key');
    if (!document.getElementById('commsMobileViewSwitch')) failures.push('missing-view-switch');
    if (document.querySelectorAll('#commsMobileViewSwitch [data-comms-mobile-view]').length !== VIEWS.length) failures.push('view-count');
    if (!VIEWS.includes(document.body.dataset.commsMobileView)) failures.push('invalid-active-view');
    return failures;
  }

  app.lifecycle.on('forum:ready', 'mobile-views', 10, ensureControls);
  app.lifecycle.on('forum:activated', 'mobile-views', 10, ({ node }) => {
    if (node === 'forum') ensureControls();
  });

  syncMode();
  media.addEventListener?.('change', syncMode);
  app.mobileUi = { ensureControls, setForumView, syncMode, selfTest, views: VIEWS };
})();
