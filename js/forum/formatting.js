/* Forum BBCode formatting, preview and communication-log template. */
(function initRhwV4CommsSafety() {
  'use strict';
  const app = window.RHWV4;
  if (!app) return;

  const LOG_TEMPLATE_KEY = 'communication-log';
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

  function installPreviewFormatting() {
    const preview = document.getElementById('forumLivePreview');
    if (!preview || preview.dataset.v40BbcodePreview === 'true') return;
    preview.dataset.v40BbcodePreview = 'true';
    app.onRender('forum-preview', enhancePreviewBody);
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

  function selfTest() {
    const failures = [];
    if (!app.config.templates.some(template => template.key === LOG_TEMPLATE_KEY)) failures.push('communication-log-template');
    if (!document.getElementById('copyBbcodePreviewBtn')) failures.push('preview-copy');
    const toolbar = document.querySelector('.comms-editor-toolbar');
    ['italic', 'underline', 'strike', 'quote', 'list', 'log', 'blur'].forEach(kind => {
      if (!toolbar?.querySelector(`[data-rhw-format="${kind}"]`)) failures.push(`toolbar:${kind}`);
    });
    const operations = document.getElementById('workspaceOperations');
    if (operations && [...operations.querySelectorAll('.ops-price-input-wrap>span')].some(node => node.textContent.trim() === 'CR')) failures.push('currency-symbol');
    return failures;
  }

  function init() {
    enhanceToolbar();
    installPreviewFormatting();
    installPreviewCopy();
  }

  installCommunicationLogTemplate();


  app.forumFormatting = {
    init,
    selfTest,
    forumFormatting: Object.freeze(['b', 'i', 'u', 's', 'quote', 'list', 'spoiler', 'sp2'])
  };
})();
