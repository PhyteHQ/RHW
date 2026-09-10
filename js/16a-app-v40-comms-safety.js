/* ==========================================================================
   RHW WEB APP · V4.0 COMMS SAFETY + FINAL RC POLISH
   Keeps Ticker Builder output inside the stable Newswire parser contract and
   applies non-destructive release-candidate readability / COMMS enhancements.
   ========================================================================== */
(function initRhwV4CommsSafety() {
  'use strict';
  const app = window.RHWV4;
  if (!app) return;

  const MAX_TAG = 40;
  const MAX_MESSAGE = 240;
  const LOG_TEMPLATE_KEY = 'communication-log';
  let previewObserver = null;
  let currencyObserver = null;
  let previewQueued = false;

  function installCommunicationLogTemplate() {
    if (app.config.templates.some(template => template.key === LOG_TEMPLATE_KEY)) return;
    const logTemplate = Object.freeze({
      key: LOG_TEMPLATE_KEY,
      label: 'COMMUNICATION LOG',
      documentLabel: 'RHW COMMUNICATION LOG',
      description: 'Informal or internal channel traffic, chatter, contact logs and recorded exchanges.',
      recipient: 'RHW / BMM Internal Traffic',
      encryption: 'RHW-RESOLUTION/V · KEY NEW-LONDON-06',
      classification: 'RHW INTERNAL',
      closing: 'For Resolution Heavy Works,',
      salutation: '__none__',
      accent: '#7da7ea',
      subjectPlaceholder: 'Communication log / channel subject'
    });
    app.config = Object.freeze({
      ...app.config,
      templates: Object.freeze([...app.config.templates, logTemplate])
    });
  }

  function installPolishStyles() {
    if (document.getElementById('rhwV40ReleasePolishStyle')) return;
    const style = document.createElement('style');
    style.id = 'rhwV40ReleasePolishStyle';
    style.dataset.stylesheet = '35-app-interface-cleanup.css';
    document.head.appendChild(style);
  }

  function normalizeTag(value) {
    return String(value || '')
      .replace(/[\[\]|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_TAG);
  }

  function normalizeMessage(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_MESSAGE);
  }

  /* While the user is typing, preserve ordinary and trailing spaces. The
     strict normalizers above are applied on change/save/export instead. */
  function typingSafeTag(value) {
    return String(value || '')
      .replace(/[\[\]|]/g, ' ')
      .replace(/[\r\n\t]+/g, ' ')
      .slice(0, MAX_TAG);
  }

  function typingSafeMessage(value) {
    return String(value || '')
      .replace(/[\r\n\t]+/g, ' ')
      .slice(0, MAX_MESSAGE);
  }

  function sanitizeField(field, finalize = false) {
    if (!field) return false;
    const next = field.id === 'v40TickerTag'
      ? (finalize ? normalizeTag(field.value) : typingSafeTag(field.value))
      : (finalize ? normalizeMessage(field.value) : typingSafeMessage(field.value));
    if (field.value === next) return false;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    field.value = next;
    if (!finalize && Number.isInteger(start) && Number.isInteger(end)) {
      try { field.setSelectionRange(Math.min(start, next.length), Math.min(end, next.length)); } catch {}
    }
    return true;
  }

  function wrapSelection(kind) {
    const area = document.getElementById('commsMessage');
    if (!area) return;
    const wrappers = {
      italic: ['[i]', '[/i]'],
      underline: ['[u]', '[/u]'],
      strike: ['[s]', '[/s]'],
      quote: ['[quote]', '[/quote]'],
      list: ['[list]\n[*]', '\n[/list]'],
      log: ['[spoiler=COMMUNICATION LOG]', '[/spoiler]'],
      blur: ['[sp2]', '[/sp2]']
    };
    const pair = wrappers[kind];
    if (!pair) return;
    const start = area.selectionStart ?? area.value.length;
    const end = area.selectionEnd ?? start;
    const selected = area.value.slice(start, end);
    const inserted = `${pair[0]}${selected}${pair[1]}`;
    area.setRangeText(inserted, start, end, 'end');
    if (!selected) {
      const cursor = start + pair[0].length;
      area.setSelectionRange(cursor, cursor);
    }
    area.focus();
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function enhanceToolbar() {
    const toolbar = document.querySelector('.comms-editor-toolbar');
    if (!toolbar || toolbar.dataset.v40OfficialBbcode === 'true') return;
    toolbar.dataset.v40OfficialBbcode = 'true';
    const existingBold = toolbar.querySelector('[data-format="bold"]');
    if (existingBold) existingBold.title = 'Generates [b]…[/b] in the forum BBCode';
    const existingList = toolbar.querySelector('[data-format="list"]');
    if (existingList) { existingList.textContent = 'BULLET'; existingList.title = 'RHW quick bullet'; }
    const extras = [
      ['italic', 'ITALIC', '[i]…[/i]'],
      ['underline', 'UNDERLINE', '[u]…[/u]'],
      ['strike', 'STRIKE', '[s]…[/s]'],
      ['quote', 'QUOTE', '[quote]…[/quote]'],
      ['list', 'BB LIST', '[list][*]…[/list]'],
      ['log', 'COMM LOG', '[spoiler=COMMUNICATION LOG]…[/spoiler]'],
      ['blur', 'BLUR', '[sp2]…[/sp2]']
    ];
    const more = document.createElement('details');
    more.className = 'comms-format-more';
    more.innerHTML = '<summary>MORE</summary><div class="comms-format-options"></div>';
    toolbar.appendChild(more);
    extras.forEach(([kind, label, title]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.rhwFormat = kind;
      button.textContent = label;
      button.title = title;
      more.querySelector('.comms-format-options').appendChild(button);
    });
    toolbar.addEventListener('click', event => {
      const button = event.target.closest('[data-rhw-format]');
      if (button) wrapSelection(button.dataset.rhwFormat);
    });
  }

  function enhancePreviewBody() {
    const body = document.querySelector('#forumLivePreview .forum-preview-body');
    if (!body) return;
    let html = body.innerHTML;
    const before = html;
    html = html.replace(/\[spoiler=([^\]]+)\]([\s\S]*?)\[\/spoiler\]/gi, '<details class="forum-preview-spoiler"><summary>$1</summary><div>$2</div></details>');
    html = html.replace(/\[sp2\]([\s\S]*?)\[\/sp2\]/gi, '<span class="forum-preview-blur" tabindex="0" title="Blur spoiler — hover to reveal">$1</span>');
    html = html.replace(/\[quote\]([\s\S]*?)\[\/quote\]/gi, '<blockquote class="forum-preview-quote">$1</blockquote>');
    html = html.replace(/\[list\]([\s\S]*?)\[\/list\]/gi, (_match, inner) => {
      const items = String(inner).split(/\[\*\]/i).slice(1).map(item => item.trim()).filter(Boolean);
      return items.length ? `<ul class="forum-preview-bb-list">${items.map(item => `<li>${item}</li>`).join('')}</ul>` : inner;
    });
    html = html.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>');
    html = html.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>');
    html = html.replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>');
    html = html.replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<s>$1</s>');
    if (html !== before) body.innerHTML = html;
  }

  function queuePreviewEnhancement() {
    if (previewQueued) return;
    previewQueued = true;
    queueMicrotask(() => { previewQueued = false; enhancePreviewBody(); });
  }

  function installPreviewObserver() {
    const preview = document.getElementById('forumLivePreview');
    if (!preview || preview.dataset.v40BbcodePreview === 'true') return;
    preview.dataset.v40BbcodePreview = 'true';
    previewObserver = new MutationObserver(queuePreviewEnhancement);
    previewObserver.observe(preview, { childList: true, subtree: true, characterData: true });
    queuePreviewEnhancement();
  }

  function installPreviewCopy() {
    const head = document.querySelector('.preview-panel .comms-panel-head');
    if (!head || document.getElementById('copyBbcodePreviewBtn')) return;
    const small = head.querySelector('small');
    const actions = document.createElement('div');
    actions.className = 'comms-panel-head-actions';
    if (small) actions.appendChild(small);
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'copyBbcodePreviewBtn';
    button.className = 'comms-preview-copy';
    button.textContent = 'COPY BB CODE';
    button.addEventListener('click', async () => {
      const copied = await app.util.copy(app.comms?.buildBbcode?.() || '');
      app.notify(copied ? 'BB CODE COPIED TO CLIPBOARD' : 'COPY FAILED', copied ? 'good' : 'warn');
    });
    actions.appendChild(button);
    head.appendChild(actions);
  }

  function replaceCreditText(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      const raw = node.nodeValue || '';
      let next = raw;
      if (raw.trim() === 'CR') next = raw.replace('CR', '$');
      next = next.replace(/([0-9][0-9,]*(?:\.[0-9]+)?)\s+CR\b/g, (_match, amount) => `$${amount}`);
      if (next !== raw) node.nodeValue = next;
    });
  }

  function polishOperations() {
    const workspace = document.getElementById('workspaceOperations');
    if (!workspace) return;
    replaceCreditText(workspace);
    if (workspace.dataset.v40DollarObserver === 'true') return;
    workspace.dataset.v40DollarObserver = 'true';
    currencyObserver = new MutationObserver(() => replaceCreditText(workspace));
    currencyObserver.observe(workspace, { childList: true, subtree: true, characterData: true });
  }

  function initTickerGuard() {
    const workspace = document.getElementById('workspaceComms');
    const tag = document.getElementById('v40TickerTag');
    const message = document.getElementById('v40TickerMessage');
    if (!workspace || !tag || !message || workspace.dataset.v40TickerGuard === 'true') return;
    workspace.dataset.v40TickerGuard = 'true';
    tag.maxLength = MAX_TAG;
    message.maxLength = MAX_MESSAGE;

    /* Input sanitation keeps parser-breaking characters/newlines out without
       trimming the ordinary spaces the user is actively typing. */
    const inputGuard = event => {
      const target = event.target;
      if (target?.id === 'v40TickerTag' || target?.id === 'v40TickerMessage') sanitizeField(target, false);
    };
    const changeGuard = event => {
      const target = event.target;
      if (target?.id === 'v40TickerTag' || target?.id === 'v40TickerMessage') sanitizeField(target, true);
    };
    workspace.addEventListener('input', inputGuard, true);
    workspace.addEventListener('change', changeGuard, true);

    const changed = sanitizeField(tag, true) || sanitizeField(message, true);
    if (changed) message.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function selfTest() {
    const failures = [];
    if (!document.getElementById('rhwV40ReleasePolishStyle')) failures.push('typography-style');
    if (!app.config.templates.some(template => template.key === LOG_TEMPLATE_KEY)) failures.push('communication-log-template');
    if (!document.getElementById('copyBbcodePreviewBtn')) failures.push('preview-copy');
    if (typingSafeMessage('RHW ') !== 'RHW ' || typingSafeTag('RHW ') !== 'RHW ') failures.push('ticker-space-typing');
    if (normalizeMessage('RHW   OPERATIONS ') !== 'RHW OPERATIONS' || normalizeTag('RHW   OPS ') !== 'RHW OPS') failures.push('ticker-final-normalize');
    const toolbar = document.querySelector('.comms-editor-toolbar');
    ['italic', 'underline', 'strike', 'quote', 'list', 'log', 'blur'].forEach(kind => {
      if (!toolbar?.querySelector(`[data-rhw-format="${kind}"]`)) failures.push(`toolbar:${kind}`);
    });
    const operations = document.getElementById('workspaceOperations');
    if (operations && [...operations.querySelectorAll('.ops-price-input-wrap>span')].some(node => node.textContent.trim() === 'CR')) failures.push('currency-symbol');
    return failures;
  }

  function init() {
    initTickerGuard();
    enhanceToolbar();
    installPreviewObserver();
    installPreviewCopy();
    polishOperations();
  }

  installCommunicationLogTemplate();
  installPolishStyles();

  app.commsSafety = {
    init,
    selfTest,
    polishOperations,
    normalizeTag,
    normalizeMessage,
    limits: Object.freeze({ tag: MAX_TAG, message: MAX_MESSAGE }),
    forumFormatting: Object.freeze(['b', 'i', 'u', 's', 'quote', 'list', 'spoiler', 'sp2'])
  };
})();