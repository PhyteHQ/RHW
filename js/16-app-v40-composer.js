/* ==========================================================================
   RHW WEB APP · V4.0 COMMS
   Forum composer, smart BBCode, ticker builder, drafts and sender registry.
   ========================================================================== */
(function initRhwV4Comms() {
  'use strict';
  const app = window.RHWV4;
  if (!app) return;

  const NODES = Object.freeze([
    ['forum', 'FORUM', 'TRANSMISSION COMPOSER'],
    ['ticker', 'TICKER', 'DASHBOARD BULLETIN'],
    ['drafts', 'DRAFTS', 'LOCAL ARCHIVE'],
    ['senders', 'SENDERS', 'IDENTITY REGISTRY']
  ]);

  const HEADING = Object.freeze({
    forum: ['FORUM TRANSMISSION COMPOSER', 'WRITE NORMAL TEXT // RHW BUILDS THE FORUM BB CODE'],
    ticker: ['BMM INDUSTRIAL NEWSWIRE BUILDER', 'BUILD ONE READY-TO-PASTE DASHBOARD TICKER ENTRY'],
    drafts: ['LOCAL DRAFT ARCHIVE', 'SAVED TRANSMISSIONS // CACHE EXPORT + IMPORT'],
    senders: ['SENDER IDENTITY REGISTRY', 'BUILT-IN + BROWSER-LOCAL RHW CHARACTERS']
  });

  const TICKER_TONES = Object.freeze({
    good: '#78ad8a', warn: '#c98b2c', danger: '#c75e5e', remote: '#7da7ea', lore: '#c6a75a', muted: '#8b9198'
  });

  let autosaveTimer = null;

  function senderOptions(selected = app.state.comms?.senderKey) {
    const builtIn = app.config.senders.map(sender => `<option value="${app.util.escape(sender.key)}">${app.util.escape(sender.name)} · BUILT-IN</option>`).join('');
    const local = app.state.localSenders.map(sender => `<option value="${app.util.escape(sender.key)}">${app.util.escape(sender.name)} · LOCAL</option>`).join('');
    return { html: `${builtIn}${local}<option value="__custom__">CUSTOM / TEMPORARY SENDER…</option>`, selected };
  }

  function selectOptions(entries, includeCustom = true) {
    const options = entries.map(entry => `<option value="${app.util.escape(entry.value)}">${app.util.escape(entry.label)}</option>`).join('');
    return options + (includeCustom ? '<option value="__custom__">CUSTOM…</option>' : '');
  }

  function classificationOptions() {
    return app.config.classifications.map(value => `<option value="${app.util.escape(value)}">${app.util.escape(value)}</option>`).join('');
  }

  function templateOptions() {
    return app.config.templates.map(template => `<option value="${app.util.escape(template.key)}">${app.util.escape(template.label)}</option>`).join('');
  }

  function subnavMarkup() {
    return `<nav id="commsNodeNav" class="workspace-subnav comms-subnav" aria-label="Communications tools"><div class="workspace-subnav-label">COMMS NODES</div><div class="workspace-subnav-tabs">${NODES.map(([key, label, sub]) => `<button type="button" data-comms-node="${key}"><span>${label}</span><small>${sub}</small></button>`).join('')}</div></nav>`;
  }

  function forumMarkup() {
    return `<section class="comms-node-panel" data-comms-panel="forum">
      <div class="comms-grid">
        <section class="comms-panel composer-panel" id="commsComposerPanel">
          <div class="comms-panel-head"><div><span>01</span><strong>WRITE TRANSMISSION</strong></div><small>AUTOSAVE ACTIVE</small></div>
          <div class="comms-workflow-status" id="commsWorkflowStatus" aria-live="polite"></div>
          <div class="comms-context-tools" aria-label="Forum tools"><button type="button" data-forum-tool="drafts">OPEN DRAFTS</button><button type="button" data-forum-tool="senders">MANAGE SENDERS</button></div>
          <form id="commsForm" autocomplete="off">
            <div class="comms-field-grid">
              <label class="comms-field"><span>SENDER PROFILE</span><select id="commsSender"></select><small>SENDER PROFILE CONTROLS THE SIGNATURE</small></label>
              <div class="comms-signature-auto" id="v40SignatureAuto"></div>
              <div class="comms-custom-sender" id="customSenderWrap" hidden>
                <label class="comms-field"><span>CUSTOM SENDER NAME</span><input id="customSenderName" type="text" maxlength="80" placeholder="Character name" /></label>
                <label class="comms-field"><span>SENDER ROLE / TITLE</span><input id="commsSignatureTitle" type="text" maxlength="120" placeholder="Role / organisation" /></label>
              </div>
              <label class="comms-field comms-wide"><span>RECIPIENT ID</span><input id="commsRecipient" type="text" maxlength="180" placeholder="Recipient / office / organisation" /></label>
              <label class="comms-field comms-wide"><span>SUBJECT</span><input id="commsSubject" type="text" maxlength="180" /></label>
              <div class="comms-field comms-wide message-field"><label for="commsMessage">MESSAGE</label>
                <div class="comms-editor-toolbar" role="toolbar" aria-label="Message formatting">
                  <button type="button" data-format="heading">HEADING</button><button type="button" data-format="bold">BOLD</button><button type="button" data-format="status">STATUS</button><button type="button" data-format="warning">WARNING</button><button type="button" data-format="list">LIST</button>
                </div>
                <textarea id="commsMessage" rows="14" placeholder="Write the actual forum post here — no BB code required."></textarea><small class="comms-message-help"><span>SMART MARKUP: ## HEADING · **BOLD** · !WARNING · !STATUS · - LIST</span><b id="commsMessageCount">0 CHARACTERS</b></small>
              </div>
              <label class="comms-field comms-wide"><span>DRAFT NAME</span><input id="commsDraftName" type="text" maxlength="100" placeholder="e.g. BAF Dunkirk Offer" /></label>
            </div>
            <details class="comms-advanced"><summary>TRANSMISSION SETTINGS <span id="v40DocumentControlSummary"></span></summary>
            <section class="comms-document-control">
              <div class="comms-document-control-grid">
                <label class="comms-field"><span>DOCUMENT TYPE</span><select id="commsTemplate">${templateOptions()}</select><small id="templateDescription"></small></label>
                <label class="comms-field"><span>SECURITY CLASSIFICATION</span><select id="commsClassification">${classificationOptions()}</select><small>DISPLAYED AS ITS OWN SECURITY BANNER</small></label>
              </div>
            </section>

              <div class="comms-field-grid">
              <label class="comms-field"><span>LOCATION</span><input id="commsLocation" type="text" maxlength="160" /></label>
              <label class="comms-field"><span>ENCRYPTION</span><div class="comms-inline-control"><input id="commsEncryption" type="text" maxlength="120" /><button type="button" id="randomizeCipherBtn" class="comms-mini-action">↻ ROLL CIPHER</button></div><small>RP CIPHER DESIGNATION // DOES NOT ENCRYPT THE POST</small></label>
              <label class="comms-field comms-wide"><span>SALUTATION / OPENING</span><select id="commsSalutation">${selectOptions(app.config.salutations)}</select><input id="commsSalutationCustom" type="text" maxlength="160" placeholder="Custom opening" hidden /><small>OPTIONAL OPENING BASED ON RECIPIENT CONTEXT</small></label>
              <label class="comms-field"><span>SIGN-OFF / CLOSING</span><select id="commsClosing">${selectOptions(app.config.closings)}</select><input id="commsClosingCustom" type="text" maxlength="100" placeholder="Custom sign-off" hidden /><small>PRESETS BY RECIPIENT CONTEXT</small></label>
              <label class="comms-field"><span>RP SYSTEM DATE</span><input id="commsSystemDate" type="text" maxlength="40" placeholder="05/08/836" /></label>
                <label class="comms-field comms-wide"><span>FOOTER / SECURITY STAMP</span><input id="commsFooterMotto" type="text" maxlength="180" /></label>
              </div>
            </details>
            <div class="comms-actions">
              <button class="comms-primary" type="button" id="copyBbcodeBtn"><span>COPY BB CODE</span></button>
              <button type="button" id="saveDraftBtn"><span>SAVE NAMED DRAFT</span></button>
              <button type="button" id="saveSenderBtn" hidden><span>SAVE SENDER PROFILE</span></button>
              <button type="button" id="newTransmissionBtn"><span>NEW TRANSMISSION</span></button>
              <button type="button" class="comms-next-action" data-comms-surface="preview"><span>REVIEW TRANSMISSION →</span></button>
            </div>
          </form>
        </section>

        <section class="comms-panel preview-panel">
          <div class="comms-panel-head"><div><span>02</span><strong>LIVE FORUM PREVIEW</strong></div><small>APPROXIMATE RENDER</small></div>
          <div class="forum-preview" id="forumLivePreview"></div>
          <div class="comms-surface-actions"><button type="button" data-comms-surface="write">← EDIT TRANSMISSION</button><button type="button" class="comms-primary" data-comms-surface="bbcode">REVIEW BB CODE →</button></div>
        </section>
      </div>

      <section class="comms-panel bbcode-panel">
        <div class="comms-panel-head"><div><span>03</span><strong>GENERATED BB CODE</strong></div><small>FORUM READY</small></div>
        <textarea id="forumBbcodeOutput" readonly spellcheck="false" aria-label="Generated forum BB code"></textarea>
        <div class="bbcode-hint">THE PREVIEW REPRODUCES RHW STYLING, BUT THE FORUM REMAINS THE FINAL RENDERER FOR ITS CUSTOM BB CODE.</div>
        <div class="comms-surface-actions"><button type="button" data-comms-surface="preview">← BACK TO PREVIEW</button><button type="button" class="comms-primary" data-copy-forum-bbcode>COPY FORUM BB CODE</button></div>
      </section>
    </section>`;
  }

  function tickerMarkup() {
    return `<section class="comms-node-panel" data-comms-panel="ticker" hidden>
      <section class="comms-panel v40-tool-panel">
        <div class="comms-panel-head"><div><span>NW</span><strong>BMM INDUSTRIAL NEWSWIRE BUILDER</strong></div><small>MOVING DASHBOARD TICKER</small></div>
        <div class="v40-newswire-explainer"><strong>WHAT IS THIS?</strong><span>BUILDS ONE READY-TO-PASTE ENTRY FOR THE MOVING BMM INDUSTRIAL NEWSWIRE ABOVE THE RHW APP. IT DOES NOT CREATE A FORUM POST AND IT DOES NOT PUBLISH AUTOMATICALLY.</span></div>
        <div class="v40-tool-grid">
          <label class="comms-field"><span>CATEGORY</span><select id="v40TickerCategory"><option value="market">MARKET</option><option value="regional">REGIONAL</option><option value="security">SECURITY</option><option value="operations">OPERATIONS</option><option value="corporate">CORPORATE</option></select></label>
          <label class="comms-field"><span>TONE</span><select id="v40TickerTone"><option value="good">GOOD</option><option value="warn">WARN</option><option value="danger">DANGER</option><option value="remote">REMOTE</option><option value="lore">LORE</option><option value="muted">MUTED</option></select></label>
          <label class="comms-field"><span>TAG <b id="v40TickerTagCount">14 / 40</b></span><input id="v40TickerTag" type="text" maxlength="40" value="RHW OPERATIONS" /></label>
          <label class="comms-field comms-wide"><span>MESSAGE <b id="v40TickerMessageCount">0 / 240</b></span><textarea id="v40TickerMessage" rows="5" maxlength="240" placeholder="Transmission headline..."></textarea></label>
        </div>
        <div class="ticker-builder-preview"><small>LIVE TICKER PREVIEW</small><div class="ticker-builder-bar"><span class="ticker-builder-label">BMM INDUSTRIAL NEWSWIRE</span><span class="ticker-builder-copy"><b id="v40TickerPreviewTag">RHW OPERATIONS</b><span id="v40TickerPreviewText">AWAITING BULLETIN</span></span></div></div>
        <div class="v40-generated-block"><small>TICKER SOURCE BLOCK // RHW_NEWSWIRE.MD</small><textarea id="v40TickerOutput" readonly spellcheck="false"></textarea></div>
        <div class="comms-actions"><button class="comms-primary" type="button" id="v40CopyTickerBtn"><span>COPY TICKER BLOCK</span></button></div>
      </section>
    </section>`;
  }

  function draftsMarkup() {
    return `<section class="comms-node-panel" data-comms-panel="drafts" hidden>
      <section class="comms-panel drafts-panel">
        <div class="comms-panel-head"><div><span>DR</span><strong>LOCAL DRAFT ARCHIVE</strong></div><small>LOCAL + CROSS-DEVICE</small></div>
        <div class="comms-archive-summary"><div><small>NAMED DRAFTS</small><strong id="commsDraftCount">0</strong></div><div><small>CURRENT WORK</small><strong>AUTOSAVED LOCALLY</strong></div><div><small>LATEST NAMED SAVE</small><strong id="commsDraftLatest">—</strong></div></div>
        <section id="rhwTransferCenter" class="rhw-transfer-center" aria-labelledby="rhwTransferTitle">
          <div class="rhw-transfer-intro"><span>DEVICE TRANSFER</span><strong id="rhwTransferTitle">MOVE YOUR RHW WORK SAFELY</strong><p>CREATE ONE PRIVATE BACKUP FILE FOR ANOTHER PHONE OR BROWSER. RHW NEVER UPLOADS THIS FILE TO A SERVER.</p></div>
          <div class="rhw-transfer-contents" aria-label="Backup contents"><span>DRAFTS</span><span>SENDERS</span><span>NEWSWIRE</span><span>PLANS</span><span>ORDERS</span><span>SETTINGS</span></div>
          <div class="comms-actions comms-cache-tools rhw-transfer-actions"><button class="comms-primary" type="button" id="shareCommsCacheBtn"><span>SHARE PRIVATE BACKUP</span></button><button type="button" id="exportCommsCacheBtn"><span>DOWNLOAD BACKUP</span></button><button type="button" id="importCommsCacheBtn"><span>IMPORT BACKUP</span></button><input type="file" id="importCommsCacheInput" accept="application/json,.json" hidden /></div>
          <div class="rhw-transfer-privacy"><strong>PRIVATE FILE</strong><span>THE BACKUP CAN CONTAIN MESSAGE TEXT, SENDER IDENTITIES AND UNPUBLISHED NEWSWIRE WORK. SHARE IT ONLY WITH A DEVICE YOU TRUST.</span></div>
          <div id="rhwTransferStatus" class="rhw-transfer-status" role="status" aria-live="polite">READY // NOTHING LEAVES THIS DEVICE UNTIL YOU CHOOSE SHARE OR DOWNLOAD</div>
        </section>
        <div id="commsDraftList" class="comms-draft-list"></div>
      </section>
    </section>`;
  }

  function sendersMarkup() {
    return `<section class="comms-node-panel" data-comms-panel="senders" hidden>
      <section class="comms-panel v40-tool-panel">
        <div class="comms-panel-head"><div><span>ID</span><strong>SENDER IDENTITY REGISTRY</strong></div><small>BUILT-IN + LOCAL PROFILES</small></div>
        <div class="sender-registry-intro">SENDER PROFILES OWN NAME, ROLE, LOCATION AND DEFAULT CIPHER IDENTITY. THE FORUM COMPOSER USES THEM FOR SIGNATURES.</div>
        <div id="v40SenderRegistry" class="sender-registry"></div>
        <form id="v40SenderEditor" class="sender-editor" hidden>
          <div class="sender-editor-head"><div><small>LOCAL IDENTITY EDITOR</small><strong id="v40SenderEditorTitle">NEW SENDER PROFILE</strong></div><button type="button" id="v40SenderEditorCancel">CANCEL</button></div>
          <div class="v40-tool-grid">
            <label class="comms-field"><span>NAME</span><input id="v40SenderEditName" type="text" maxlength="80" /></label>
            <label class="comms-field"><span>ROLE / TITLE</span><input id="v40SenderEditTitle" type="text" maxlength="120" /></label>
            <label class="comms-field"><span>ORGANISATION</span><input id="v40SenderEditOrganisation" type="text" maxlength="120" /></label>
            <label class="comms-field"><span>DEFAULT LOCATION</span><input id="v40SenderEditLocation" type="text" maxlength="160" /></label>
            <label class="comms-field comms-wide"><span>DEFAULT CIPHER</span><input id="v40SenderEditCipher" type="text" maxlength="120" /></label>
          </div>
          <div class="comms-actions"><button class="comms-primary" type="submit"><span>SAVE LOCAL SENDER</span></button></div>
        </form>
        <div class="comms-actions"><button class="comms-primary" type="button" id="v40CreateSenderBtn"><span>CREATE LOCAL SENDER</span></button></div>
      </section>
    </section>`;
  }

  function workspaceMarkup() {
    return `<div class="workspace-frame comms-frame">
      <header class="workspace-heading"><div><div class="workspace-kicker"><span>COMMS</span> RHW COMMUNICATION NETWORK</div><h2 id="commsWorkspaceTitle">FORUM TRANSMISSION COMPOSER</h2><p id="commsWorkspaceSubtitle">WRITE NORMAL TEXT // RHW BUILDS THE FORUM BB CODE</p></div><div class="workspace-status" id="commsStatus" data-tone="muted">LOCAL COMMAND CACHE READY</div></header>
      ${subnavMarkup()}
      <div id="commsNodeHost" class="comms-node-host">${forumMarkup()}${tickerMarkup()}${draftsMarkup()}${sendersMarkup()}</div>
    </div>`;
  }

  function resolvePresetControl(selectId, customId) {
    const select = document.getElementById(selectId);
    const custom = document.getElementById(customId);
    if (!select) return '';
    return select.value === '__custom__' ? String(custom?.value || '').trim() : select.value;
  }

  function setPresetControl(selectId, customId, value, entries) {
    const select = document.getElementById(selectId);
    const custom = document.getElementById(customId);
    if (!select) return;
    const next = String(value ?? '').trim();
    const known = entries.some(entry => entry.value === next);
    if (known) {
      select.value = next;
      if (custom) { custom.hidden = true; custom.value = ''; }
    } else {
      select.value = '__custom__';
      if (custom) { custom.hidden = false; custom.value = next; }
    }
  }

  function resolvedSalutation(state = app.state.comms) {
    const raw = String(state?.salutation || '').trim();
    if (!raw || raw === '__none__') return '';
    if (raw === '__recipient__') {
      const recipient = String(state?.recipient || '').trim();
      return recipient ? `To ${recipient},` : 'To the appropriate recipient,';
    }
    return raw;
  }

  function inlineBbcode(value) {
    return String(value || '').replace(/\*\*(.+?)\*\*/g, '[b]$1[/b]');
  }

  function bodyToBbcode(value, accent) {
    return String(value || '').replace(/\r/g, '').split('\n').map(line => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('## ')) return `[font=Agency FB][size=large][b][color=${accent}]${inlineBbcode(trimmed.slice(3))}[/color][/b][/size][/font]`;
      if (/^!warning\s+/i.test(trimmed)) return `[color=#c98b2c][b]WARNING //[/b] ${inlineBbcode(trimmed.replace(/^!warning\s+/i, ''))}[/color]`;
      if (/^!status\s+/i.test(trimmed)) return `[color=#78ad8a][b]STATUS //[/b] ${inlineBbcode(trimmed.replace(/^!status\s+/i, ''))}[/color]`;
      if (/^-\s+/.test(trimmed)) return `[b]•[/b] ${inlineBbcode(trimmed.replace(/^-\s+/, ''))}`;
      return inlineBbcode(line);
    }).join('\n');
  }

  function inlinePreview(value) {
    return app.util.escape(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  function bodyToPreview(value) {
    const blocks = [];
    let paragraph = [];
    const flush = () => {
      if (!paragraph.length) return;
      blocks.push(`<p>${paragraph.map(inlinePreview).join('<br>')}</p>`);
      paragraph = [];
    };
    String(value || '').replace(/\r/g, '').split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) { flush(); return; }
      if (trimmed.startsWith('## ')) { flush(); blocks.push(`<h3>${inlinePreview(trimmed.slice(3))}</h3>`); return; }
      if (/^!warning\s+/i.test(trimmed)) { flush(); blocks.push(`<div class="forum-preview-callout warning"><strong>WARNING //</strong> ${inlinePreview(trimmed.replace(/^!warning\s+/i, ''))}</div>`); return; }
      if (/^!status\s+/i.test(trimmed)) { flush(); blocks.push(`<div class="forum-preview-callout status"><strong>STATUS //</strong> ${inlinePreview(trimmed.replace(/^!status\s+/i, ''))}</div>`); return; }
      if (/^-\s+/.test(trimmed)) { flush(); blocks.push(`<div class="forum-preview-bullet"><b>•</b><span>${inlinePreview(trimmed.replace(/^-\s+/, ''))}</span></div>`); return; }
      paragraph.push(line);
    });
    flush();
    return blocks.join('');
  }

  function buildBbcode(state = app.state.comms) {
    const f = app.config.forum;
    const sender = app.storage.resolveSender(state);
    const template = app.template(state.templateKey);
    const accent = template.accent || f.brandColor;
    const classification = state.classification || template.classification;
    const classificationColor = app.classificationColor(classification);
    const recipient = String(state.recipient || '').trim() || 'UNSPECIFIED RECIPIENT';
    const location = String(state.location || '').trim() || 'Resolution Heavy Works, New London';
    const encryption = String(state.encryption || '').trim() || template.encryption;
    const subject = String(state.subject || '').trim() || 'UNTITLED TRANSMISSION';
    const salutation = resolvedSalutation(state);
    const body = bodyToBbcode(state.message, accent);
    const bodyWithOpening = [salutation, body].filter(Boolean).join('\n\n');
    const closing = String(state.closing || '').trim() || template.closing;
    const systemDate = String(state.systemDate || '').trim() || 'UNSET';
    const footerMotto = String(state.footerMotto || '').trim() || f.footerMotto;

    return `[align=center]\n` +
`[img]${f.logoUrl}[/img]\n` +
`[size=xx-large][font=Agency FB][b][color=${f.brandColor}]${f.organisation}[/color][/b][/font][/size]\n` +
`[size=small][font=Consolas][color=${f.mutedColor}]${f.subline}[/color][/font][/size]\n` +
`[/align]\n\n` +
`[hrc]${f.brandColor}[/hrc]\n` +
`[align=center][font=Consolas][size=x-small][color=${f.mutedColor}]${template.documentLabel} // ${template.label}[/color][/size][/font][br]\n` +
`[font=Consolas][size=small][b][color=${classificationColor}]CLASSIFICATION // ${classification}[/color][/b][/size][/font][/align]\n` +
`[hrc]${f.darkLineColor}[/hrc]\n\n` +
`[align=center]\n[table=${f.brandColor}]\n` +
`[tr]\n[td][font=Consolas][b][color=${f.brandColor}]SENDER ID:[/color][/b][/font][/td]\n[td][font=Consolas]      [/font][/td]\n[td][font=Consolas]${sender.name}[/font][/td]\n[/tr]\n` +
`[tr]\n[td][font=Consolas][b][color=${f.brandColor}]RECIPIENT ID:[/color][/b][/font][/td]\n[td][font=Consolas]      [/font][/td]\n[td][font=Consolas]${recipient}[/font][/td]\n[/tr]\n` +
`[tr]\n[td][font=Consolas][b][color=${f.brandColor}]LOCATION:[/color][/b][/font][/td]\n[td][font=Consolas]      [/font][/td]\n[td][font=Consolas]${location}[/font][/td]\n[/tr]\n` +
`[tr]\n[td][font=Consolas][b][color=${f.brandColor}]ENCRYPTION:[/color][/b][/font][/td]\n[td][font=Consolas]      [/font][/td]\n[td][font=Consolas][color=#9FB6D9]${encryption}[/color][/font][/td]\n[/tr]\n` +
`[/table]\n[/align]\n\n` +
`[hrc]${accent}[/hrc]\n` +
`[align=center][font=Consolas][size=x-small][color=${f.mutedColor}]SUBJECT[/color][/size][/font][br]\n` +
`[font=Agency FB][size=x-large][b][color=${accent}]${subject}[/color][/b][/size][/font][/align]\n` +
`[hrc]${accent}[/hrc]\n[br]\n` +
`[pi amount=12][font=Tahoma][color=${f.textColor}]\n\n${bodyWithOpening}\n\n[/color][/font][/pi]\n` +
`[br]\n[align=right]\n` +
`[font=Agency FB][size=large][i]${closing}[/i][/size][/font]\n` +
`[size=large][b][font=Agency FB][color=${f.brandColor}]${sender.name}[/color][/font][/b][/size]\n` +
`[font=Consolas][size=small][color=${f.mutedColor}]${sender.title || ''}[/color][/size][/font]\n` +
`[/align]\n\n[hrc]${f.darkLineColor}[/hrc]\n` +
`[align=center][font=Consolas][size=x-small][color=${f.footerColor}]\n${footerMotto}\nTRANSMISSION CLASS // ${classification}\n[RHW] SYSTEM TIME: ${systemDate}\n[/color][/size][/font][/align]`;
  }

  function renderPreview(state = app.state.comms) {
    const target = document.getElementById('forumLivePreview');
    if (!target || !state) return;
    const f = app.config.forum;
    const sender = app.storage.resolveSender(state);
    const template = app.template(state.templateKey);
    const classification = state.classification || template.classification;
    const salutation = resolvedSalutation(state);
    target.dataset.template = template.key;
    target.style.setProperty('--comms-accent', template.accent || f.brandColor);
    target.style.setProperty('--classification-color', app.classificationColor(classification));
    target.innerHTML = `
      <div class="forum-preview-identity">
        <div class="forum-preview-logo-wrap"><img src="${app.util.escape(f.logoUrl)}" alt="RHW communication crest" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false" /><div class="forum-preview-logo-fallback" hidden>RHW</div></div>
        <div class="forum-preview-title">${app.util.escape(f.organisation)}</div>
        <div class="forum-preview-subline">${app.util.escape(f.subline)}</div>
        <div class="forum-preview-document-type">${app.util.escape(template.documentLabel)} // ${app.util.escape(template.label)}</div>
        <div class="forum-preview-classification">CLASSIFICATION // ${app.util.escape(classification)}</div>
      </div>
      <div class="forum-preview-rule"></div>
      <div class="forum-preview-meta">
        <div class="forum-preview-meta-row"><strong>SENDER ID:</strong><span>${app.util.escape(sender.name || '—')}</span></div>
        <div class="forum-preview-meta-row"><strong>RECIPIENT ID:</strong><span>${app.util.escape(state.recipient || '—')}</span></div>
        <div class="forum-preview-meta-row"><strong>LOCATION:</strong><span>${app.util.escape(state.location || '—')}</span></div>
        <div class="forum-preview-meta-row"><strong>ENCRYPTION:</strong><span class="encryption">${app.util.escape(state.encryption || '—')}</span></div>
      </div>
      <div class="forum-preview-subject"><small>SUBJECT</small><strong>${app.util.escape(state.subject || 'UNTITLED TRANSMISSION')}</strong></div>
      <div class="forum-preview-rule"></div>
      <div class="forum-preview-body">${salutation ? `<p class="forum-preview-salutation">${app.util.escape(salutation)}</p>` : ''}${String(state.message || '').trim() ? bodyToPreview(state.message) : '<span class="preview-placeholder">AWAITING TRANSMISSION BODY</span>'}</div>
      <div class="forum-preview-signature"><em>${app.util.escape(state.closing || template.closing)}</em><strong>${app.util.escape(sender.name)}</strong><small>${app.util.escape(sender.title || '')}</small></div>
      <div class="forum-preview-footer"><span>${app.util.escape(state.footerMotto || f.footerMotto)}</span><span>TRANSMISSION CLASS // ${app.util.escape(classification)}</span><span>[RHW] SYSTEM TIME: ${app.util.escape(state.systemDate || 'UNSET')}</span></div>`;
  }

  function renderBbcode() {
    const output = document.getElementById('forumBbcodeOutput');
    if (output) output.value = buildBbcode(app.state.comms);
  }

  function refreshSenderSelect() {
    const select = document.getElementById('commsSender');
    if (!select) return;
    const current = app.state.comms?.senderKey || app.config.senders[0].key;
    select.innerHTML = senderOptions(current).html;
    select.value = [...select.options].some(option => option.value === current) ? current : app.config.senders[0].key;
  }

  function renderSignature() {
    const target = document.getElementById('v40SignatureAuto');
    const wrap = document.getElementById('customSenderWrap');
    const custom = app.state.comms?.senderKey === '__custom__';
    if (wrap) wrap.hidden = !custom;
    const saveSender = document.getElementById('saveSenderBtn');
    if (saveSender) saveSender.hidden = !custom;
    if (!target) return;
    const sender = app.storage.resolveSender(app.state.comms);
    target.innerHTML = `<small>AUTO SIGNATURE</small><strong>${app.util.escape(custom ? 'CUSTOM SENDER' : sender.name)}</strong><span>${app.util.escape(custom ? 'NAME + ROLE COME FROM THE CUSTOM FIELDS' : (sender.title || 'NO ROLE REGISTERED'))}</span>`;
  }

  function renderWorkflowStatus() {
    const target = document.getElementById('commsWorkflowStatus');
    const count = document.getElementById('commsMessageCount');
    const state = app.state.comms;
    if (!state) return;
    const sender = app.storage.resolveSender(state);
    const checks = [
      ['SENDER', Boolean(String(sender.name || '').trim())],
      ['RECIPIENT', Boolean(String(state.recipient || '').trim())],
      ['SUBJECT', Boolean(String(state.subject || '').trim())],
      ['MESSAGE', Boolean(String(state.message || '').trim())]
    ];
    if (target) {
      const ready = checks.filter(([, ok]) => ok).length;
      target.innerHTML = `<div class="comms-workflow-score"><small>TRANSMISSION READINESS</small><strong>${ready} / ${checks.length} READY</strong></div>${checks.map(([label, ok]) => `<span data-ready="${ok ? 'true' : 'false'}"><i aria-hidden="true"></i>${label}</span>`).join('')}`;
    }
    if (count) count.textContent = `${String(state.message || '').length.toLocaleString('en-US')} CHARACTERS`;
  }

  function renderDocumentSummary() {
    const target = document.getElementById('v40DocumentControlSummary');
    if (!target) return;
    const template = app.template(app.state.comms.templateKey);
    const classification = app.state.comms.classification || template.classification;
    target.textContent = `${template.label} // ${classification}`;
    target.style.setProperty('--classification-color', app.classificationColor(classification));
  }

  function renderForm() {
    const state = app.state.comms;
    if (!state) return;
    refreshSenderSelect();
    const map = {
      commsTemplate: state.templateKey, commsClassification: state.classification, customSenderName: state.customSenderName,
      commsSignatureTitle: state.signatureTitle, commsRecipient: state.recipient, commsLocation: state.location,
      commsEncryption: state.encryption, commsSubject: state.subject, commsMessage: state.message,
      commsSystemDate: state.systemDate, commsDraftName: state.draftName, commsFooterMotto: state.footerMotto
    };
    Object.entries(map).forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.value = value ?? ''; });
    setPresetControl('commsClosing', 'commsClosingCustom', state.closing, app.config.closings);
    setPresetControl('commsSalutation', 'commsSalutationCustom', state.salutation, app.config.salutations);
    const subject = document.getElementById('commsSubject');
    const description = document.getElementById('templateDescription');
    const template = app.template(state.templateKey);
    if (subject) subject.placeholder = template.subjectPlaceholder;
    if (description) description.textContent = template.description;
    renderSignature();
    renderDocumentSummary();
    renderWorkflowStatus();
    renderPreview();
    renderBbcode();
  }

  function readForm() {
    const value = id => document.getElementById(id)?.value ?? '';
    const state = app.storage.normalizeState({
      ...app.state.comms,
      templateKey: value('commsTemplate'),
      senderKey: value('commsSender'),
      customSenderName: value('customSenderName'),
      signatureTitle: value('commsSignatureTitle'),
      recipient: value('commsRecipient'),
      location: value('commsLocation'),
      encryption: value('commsEncryption'),
      classification: value('commsClassification'),
      salutation: resolvePresetControl('commsSalutation', 'commsSalutationCustom'),
      subject: value('commsSubject'),
      message: value('commsMessage'),
      closing: resolvePresetControl('commsClosing', 'commsClosingCustom'),
      systemDate: value('commsSystemDate'),
      draftName: value('commsDraftName'),
      footerMotto: value('commsFooterMotto')
    });
    return app.storage.snapshotSender(state);
  }

  function syncFromForm() {
    app.state.comms = readForm();
    renderSignature();
    renderDocumentSummary();
    renderWorkflowStatus();
    renderPreview();
    renderBbcode();
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(app.storage.saveCurrent, 320);
  }

  function applyTemplate(nextKey) {
    const previous = app.template(app.state.comms?.templateKey);
    const state = readForm();
    const next = app.template(nextKey);
    state.templateKey = next.key;
    if (!state.recipient.trim() || state.recipient === previous.recipient) state.recipient = next.recipient || '';
    if (!state.encryption.trim() || state.encryption === previous.encryption) state.encryption = next.encryption || '';
    state.classification = next.classification;
    state.salutation = next.salutation;
    state.closing = next.closing;
    app.state.comms = state;
    renderForm();
    app.storage.saveCurrent();
  }

  function applySender(key) {
    const state = readForm();
    state.senderKey = key;
    if (key === '__custom__') {
      state.customSenderName = '';
      state.signatureTitle = '';
    } else {
      const sender = app.storage.senderByKey(key);
      if (sender) {
        state.location = sender.location || state.location;
        state.signatureTitle = sender.title || '';
        state.senderSnapshotName = sender.name || '';
        state.senderSnapshotTitle = sender.title || '';
      }
    }
    app.state.comms = state;
    renderForm();
    app.storage.saveCurrent();
    if (key === '__custom__') setTimeout(() => document.getElementById('customSenderName')?.focus(), 0);
  }

  function saveCustomSender() {
    const state = readForm();
    const name = state.customSenderName.trim();
    if (!name) { app.notify('ENTER A SENDER NAME FIRST', 'warn'); return; }
    const profile = app.storage.upsertSender({
      name,
      title: state.signatureTitle.trim(),
      organisation: '',
      location: state.location.trim(),
      encryption: state.encryption.trim()
    });
    if (!profile) return;
    state.senderKey = profile.key;
    state.senderSnapshotName = profile.name;
    state.senderSnapshotTitle = profile.title;
    app.state.comms = state;
    renderForm();
    renderSenderRegistry();
    app.storage.saveCurrent();
    app.notify('LOCAL SENDER PROFILE SAVED');
  }

  function saveDraft() {
    app.state.comms = readForm();
    const name = app.storage.saveDraft(app.state.comms, app.state.comms.draftName);
    renderDrafts();
    renderForm();
    app.notify(`DRAFT SAVED // ${name.toUpperCase()}`);
  }

  function loadDraft(id) {
    const draft = app.state.drafts.find(entry => entry.id === id);
    if (!draft) return;
    app.state.comms = app.storage.normalizeState(draft.state);
    app.storage.snapshotSender(app.state.comms);
    renderForm();
    app.storage.saveCurrent();
    app.navigate('comms', 'forum');
    app.notify(`DRAFT LOADED // ${draft.name.toUpperCase()}`);
  }

  function renderDrafts() {
    const target = document.getElementById('commsDraftList');
    if (!target) return;
    const sorted = app.state.drafts.slice().sort((a, b) => b.updatedAt - a.updatedAt);
    const count = document.getElementById('commsDraftCount');
    const latest = document.getElementById('commsDraftLatest');
    if (count) count.textContent = String(sorted.length);
    if (latest) latest.textContent = sorted.length ? new Date(sorted[0].updatedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '—';
    if (!app.state.drafts.length) {
      target.innerHTML = '<div class="comms-empty-state">NO NAMED DRAFTS IN LOCAL CACHE<small>THE CURRENT TRANSMISSION IS STILL AUTOSAVED</small></div>';
      return;
    }
    target.innerHTML = sorted.map(draft => {
      const sender = app.storage.resolveSender(draft.state);
      const date = new Date(draft.updatedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
      return `<article class="comms-draft-card"><div><strong>${app.util.escape(draft.name)}</strong><small>${app.util.escape(sender.name)} // ${app.util.escape(draft.state.subject || 'NO SUBJECT')} // ${app.util.escape(date)}</small></div><div class="comms-draft-actions"><button type="button" data-load-draft="${app.util.escape(draft.id)}">LOAD IN COMPOSER</button><button type="button" class="danger" data-delete-draft="${app.util.escape(draft.id)}">DELETE</button></div></article>`;
    }).join('');
  }

  function renderTicker() {
    const category = document.getElementById('v40TickerCategory')?.value || 'operations';
    const tone = document.getElementById('v40TickerTone')?.value || 'good';
    const tag = document.getElementById('v40TickerTag')?.value.trim() || 'RHW NEWSWIRE';
    const message = document.getElementById('v40TickerMessage')?.value.trim() || 'AWAITING BULLETIN';
    const output = document.getElementById('v40TickerOutput');
    if (output) output.value = `## ${category}\n- [${tag} | ${tone}] ${message}`;
    const previewTag = document.getElementById('v40TickerPreviewTag');
    const previewText = document.getElementById('v40TickerPreviewText');
    const bar = document.querySelector('.ticker-builder-bar');
    if (previewTag) previewTag.textContent = tag;
    if (previewText) previewText.textContent = message;
    if (bar) bar.style.setProperty('--ticker-tone', TICKER_TONES[tone] || TICKER_TONES.muted);
    app.store.set(app.config.storageKeys.tickerComposer, { category, tone, tag, message });
  }

  function renderSenderRegistry() {
    const target = document.getElementById('v40SenderRegistry');
    if (!target) return;
    const profiles = [
      ...app.config.senders.map(sender => ({ ...sender, source: 'BUILT-IN' })),
      ...app.state.localSenders.map(sender => ({ ...sender, source: 'LOCAL' }))
    ];
    const activeKey = app.state.comms?.senderKey;
    target.innerHTML = profiles.map(sender => {
      const active = sender.key === activeKey;
      return `<article class="sender-registry-card${active ? ' active' : ''}"><div class="sender-registry-head"><div><small>${sender.source}</small><strong>${app.util.escape(sender.name)}</strong></div><span>${active ? 'ACTIVE PROFILE' : sender.source === 'LOCAL' ? 'LOCAL CACHE' : 'RHW REGISTRY'}</span></div><dl><div><dt>ROLE</dt><dd>${app.util.escape(sender.title || '—')}</dd></div><div><dt>ORGANISATION</dt><dd>${app.util.escape(sender.organisation || '—')}</dd></div><div><dt>LOCATION</dt><dd>${app.util.escape(sender.location || '—')}</dd></div><div><dt>DEFAULT CIPHER</dt><dd>${app.util.escape(sender.encryption || '—')}</dd></div></dl><div class="sender-registry-actions"><button type="button" data-use-sender="${app.util.escape(sender.key)}"${active ? ' disabled' : ''}>${active ? 'ACTIVE IN COMPOSER' : 'USE IN COMPOSER'}</button>${sender.source === 'LOCAL' ? `<button type="button" data-edit-sender="${app.util.escape(sender.key)}">EDIT</button><button type="button" class="danger" data-remove-sender="${app.util.escape(sender.key)}">REMOVE</button>` : ''}</div></article>`;
    }).join('');
  }

  function showForumSurface(surface) {
    const view = ['write', 'preview', 'bbcode'].includes(surface) ? surface : 'write';
    if (window.matchMedia('(max-width: 760px)').matches && app.mobileUi?.setForumView) {
      app.mobileUi.setForumView(view);
      document.getElementById('commsMobileViewSwitch')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const target = view === 'write' ? document.getElementById('commsComposerPanel') : view === 'preview' ? document.querySelector('.preview-panel') : document.querySelector('.bbcode-panel');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function copyForumBbcode() {
    syncFromForm();
    const copied = await app.util.copy(buildBbcode());
    app.notify(copied ? 'BB CODE COPIED TO CLIPBOARD' : 'COPY FAILED', copied ? 'good' : 'warn');
  }

  function openSenderEditor(key = null) {
    const form = document.getElementById('v40SenderEditor');
    if (!form) return;
    const sender = key ? app.state.localSenders.find(entry => entry.key === key) : null;
    app.state.editingSenderKey = sender?.key || null;
    form.hidden = false;
    document.getElementById('v40SenderEditorTitle').textContent = sender ? `EDIT // ${sender.name.toUpperCase()}` : 'NEW SENDER PROFILE';
    document.getElementById('v40SenderEditName').value = sender?.name || '';
    document.getElementById('v40SenderEditTitle').value = sender?.title || '';
    document.getElementById('v40SenderEditOrganisation').value = sender?.organisation || '';
    document.getElementById('v40SenderEditLocation').value = sender?.location || 'Resolution Heavy Works, New London';
    document.getElementById('v40SenderEditCipher').value = sender?.encryption || app.generateCipher('formal');
    form.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }

  function closeSenderEditor() {
    app.state.editingSenderKey = null;
    const form = document.getElementById('v40SenderEditor');
    if (form) form.hidden = true;
  }

  function saveSenderEditor(event) {
    event.preventDefault();
    const name = document.getElementById('v40SenderEditName')?.value.trim();
    if (!name) { app.notify('ENTER A SENDER NAME FIRST', 'warn'); return; }
    const profile = app.storage.upsertSender({
      name,
      title: document.getElementById('v40SenderEditTitle')?.value.trim() || '',
      organisation: document.getElementById('v40SenderEditOrganisation')?.value.trim() || '',
      location: document.getElementById('v40SenderEditLocation')?.value.trim() || '',
      encryption: document.getElementById('v40SenderEditCipher')?.value.trim() || ''
    }, app.state.editingSenderKey);
    if (!profile) return;
    if (app.state.comms?.senderKey === profile.key) {
      app.state.comms.senderSnapshotName = profile.name;
      app.state.comms.senderSnapshotTitle = profile.title;
      app.state.comms.signatureTitle = profile.title;
      app.state.comms.location = profile.location || app.state.comms.location;
      app.storage.saveCurrent();
    }
    closeSenderEditor();
    refreshSenderSelect();
    renderSenderRegistry();
    renderForm();
    app.notify(`SENDER SAVED // ${profile.name.toUpperCase()}`);
  }

  function insertFormat(kind) {
    const area = document.getElementById('commsMessage');
    if (!area) return;
    const start = area.selectionStart ?? area.value.length;
    const end = area.selectionEnd ?? start;
    const selected = area.value.slice(start, end);
    const lineStart = area.value.lastIndexOf('\n', start - 1) + 1;
    let before = '', after = '', replaceStart = start, replaceEnd = end;
    if (kind === 'bold') { before = '**'; after = '**'; }
    else {
      replaceStart = lineStart;
      const prefix = { heading: '## ', status: '!status ', warning: '!warning ', list: '- ' }[kind] || '';
      if (area.value.slice(lineStart, start).trim()) before = `\n${prefix}`;
      else before = prefix;
    }
    const inserted = before + selected + after;
    area.setRangeText(inserted, replaceStart, replaceEnd, 'end');
    area.focus();
    syncFromForm();
  }

  function bindForum() {
    const form = document.getElementById('commsForm');
    if (!form) return;
    form.addEventListener('input', event => {
      if (['commsTemplate', 'commsSender', 'commsClassification', 'commsClosing', 'commsSalutation'].includes(event.target.id)) return;
      syncFromForm();
    });
    document.getElementById('commsTemplate')?.addEventListener('change', event => applyTemplate(event.target.value));
    document.getElementById('commsSender')?.addEventListener('change', event => applySender(event.target.value));
    document.getElementById('commsClassification')?.addEventListener('change', syncFromForm);
    document.getElementById('commsClosing')?.addEventListener('change', event => {
      const custom = document.getElementById('commsClosingCustom');
      if (custom) custom.hidden = event.target.value !== '__custom__';
      if (!custom?.hidden) custom.focus();
      syncFromForm();
    });
    document.getElementById('commsSalutation')?.addEventListener('change', event => {
      const custom = document.getElementById('commsSalutationCustom');
      if (custom) custom.hidden = event.target.value !== '__custom__';
      if (!custom?.hidden) custom.focus();
      syncFromForm();
    });
    document.getElementById('randomizeCipherBtn')?.addEventListener('click', () => {
      document.getElementById('commsEncryption').value = app.generateCipher(document.getElementById('commsTemplate')?.value);
      syncFromForm();
      app.notify('NEW CIPHER DESIGNATION ISSUED');
    });
    document.querySelectorAll('[data-forum-tool]').forEach(button => button.addEventListener('click', () => app.navigate('comms', button.dataset.forumTool)));
    document.querySelector('.comms-editor-toolbar')?.addEventListener('click', event => {
      const button = event.target.closest('[data-format]');
      if (button) insertFormat(button.dataset.format);
    });
    document.getElementById('copyBbcodeBtn')?.addEventListener('click', copyForumBbcode);
    document.querySelector('[data-copy-forum-bbcode]')?.addEventListener('click', copyForumBbcode);
    document.querySelectorAll('[data-comms-surface]').forEach(button => button.addEventListener('click', () => showForumSurface(button.dataset.commsSurface)));
    document.getElementById('saveDraftBtn')?.addEventListener('click', saveDraft);
    document.getElementById('saveSenderBtn')?.addEventListener('click', saveCustomSender);
    document.getElementById('newTransmissionBtn')?.addEventListener('click', () => {
      if ((app.state.comms?.message || app.state.comms?.subject) && !window.confirm('Start a new transmission? The current transmission is autosaved.')) return;
      app.state.comms = app.storage.defaultState();
      renderForm();
      app.storage.saveCurrent();
      app.notify('NEW TRANSMISSION INITIALIZED');
    });
  }

  function bindTicker() {
    const saved = app.store.get(app.config.storageKeys.tickerComposer, {}) || {};
    ['Category', 'Tone', 'Tag', 'Message'].forEach(name => {
      const el = document.getElementById(`v40Ticker${name}`);
      const key = name.toLowerCase();
      if (el && typeof saved[key] === 'string') el.value = saved[key];
      el?.addEventListener('input', renderTicker);
      el?.addEventListener('change', renderTicker);
    });
    document.getElementById('v40CopyTickerBtn')?.addEventListener('click', async () => {
      const output = document.getElementById('v40TickerOutput');
      const copied = await app.util.copy(output?.value || '');
      app.notify(copied ? 'TICKER BLOCK COPIED' : 'COPY FAILED', copied ? 'good' : 'warn');
    });
    renderTicker();
  }

  function bindDrafts() {
    document.getElementById('commsDraftList')?.addEventListener('click', event => {
      const load = event.target.closest('[data-load-draft]');
      const remove = event.target.closest('[data-delete-draft]');
      if (load) loadDraft(load.dataset.loadDraft);
      if (remove) {
        const draft = app.state.drafts.find(entry => entry.id === remove.dataset.deleteDraft);
        if (draft && window.confirm(`Delete draft “${draft.name}” from this browser?`)) {
          app.storage.deleteDraft(draft.id);
          renderDrafts();
          app.notify('DRAFT REMOVED', 'warn');
        }
      }
    });
    document.getElementById('shareCommsCacheBtn')?.addEventListener('click', async () => {
      if (app.transferCenter?.shareBackup) await app.transferCenter.shareBackup();
      else app.notify('SHARE MODULE NOT READY // USE DOWNLOAD BACKUP', 'warn');
    });
    document.getElementById('exportCommsCacheBtn')?.addEventListener('click', () => {
      if (app.transferCenter?.downloadBackup) {
        app.transferCenter.downloadBackup();
        return;
      }
      const payload = app.storage.exportPayload();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `rhw-comms-cache-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      app.notify('LOCAL CACHE EXPORTED');
    });
    document.getElementById('importCommsCacheBtn')?.addEventListener('click', () => document.getElementById('importCommsCacheInput')?.click());
    document.getElementById('importCommsCacheInput')?.addEventListener('change', async event => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      if (!file) return;
      try {
        if (app.transferCenter?.previewFile) {
          await app.transferCenter.previewFile(file);
          return;
        }
        const result = app.storage.importPayload(JSON.parse(await file.text()));
        renderDrafts(); renderSenderRegistry(); renderForm();
        app.notify(`CACHE MERGED // ${result.drafts} DRAFTS // ${result.senders} LOCAL SENDERS`);
      } catch (error) {
        app.notify(`CACHE IMPORT FAILED // ${String(error?.message || 'INVALID FILE').toUpperCase()}`, 'danger');
      } finally { input.value = ''; }
    });
  }

  function bindSenders() {
    document.getElementById('v40SenderRegistry')?.addEventListener('click', event => {
      const use = event.target.closest('[data-use-sender]');
      const edit = event.target.closest('[data-edit-sender]');
      const remove = event.target.closest('[data-remove-sender]');
      if (use) { applySender(use.dataset.useSender); app.navigate('comms', 'forum'); app.notify('SENDER ACTIVE'); }
      if (edit) openSenderEditor(edit.dataset.editSender);
      if (remove) {
        const sender = app.state.localSenders.find(entry => entry.key === remove.dataset.removeSender);
        if (sender && window.confirm(`Remove local sender profile “${sender.name}”? Existing drafts keep a sender snapshot.`)) {
          app.storage.removeSender(sender.key);
          if (app.state.comms?.senderKey === sender.key) {
            const fallback = app.config.senders[0];
            app.state.comms.senderKey = fallback.key;
            app.state.comms.senderSnapshotName = fallback.name;
            app.state.comms.senderSnapshotTitle = fallback.title || '';
            app.state.comms.signatureTitle = fallback.title || '';
            app.state.comms.location = fallback.location || app.state.comms.location;
            app.storage.saveCurrent();
          }
          renderSenderRegistry(); renderForm();
          app.notify('LOCAL SENDER PROFILE REMOVED', 'warn');
        }
      }
    });
    document.getElementById('v40CreateSenderBtn')?.addEventListener('click', () => openSenderEditor());
    document.getElementById('v40SenderEditorCancel')?.addEventListener('click', closeSenderEditor);
    document.getElementById('v40SenderEditor')?.addEventListener('submit', saveSenderEditor);
  }

  function activate(node, { updateRoute = true } = {}) {
    const valid = NODES.some(([key]) => key === node) ? node : 'forum';
    app.state.commsNode = valid;
    app.store.set(app.config.storageKeys.commsNode, valid);
    document.body.dataset.commsNode = valid;
    document.querySelectorAll('[data-comms-panel]').forEach(panel => { panel.hidden = panel.dataset.commsPanel !== valid; });
    document.querySelectorAll('button[data-comms-node]').forEach(button => {
      const active = button.dataset.commsNode === valid;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
      if (active) requestAnimationFrame(() => button.scrollIntoView?.({ block: 'nearest', inline: 'center' }));
    });
    const copy = HEADING[valid] || HEADING.forum;
    const title = document.getElementById('commsWorkspaceTitle');
    const subtitle = document.getElementById('commsWorkspaceSubtitle');
    if (title) title.textContent = copy[0];
    if (subtitle) subtitle.textContent = copy[1];
    if (valid === 'drafts') renderDrafts();
    if (valid === 'senders') renderSenderRegistry();
    if (app.state.activeWorkspace === 'comms') {
      app.setActiveNode(`COMMS / ${valid.toUpperCase()}`);
      if (updateRoute) app.route.write('comms', valid);
    }
  }

  function init() {
    const workspace = document.getElementById('workspaceComms');
    if (!workspace || document.getElementById('commsNodeNav')) return;
    workspace.innerHTML = workspaceMarkup();
    workspace.querySelector('#commsNodeNav')?.addEventListener('click', event => {
      const button = event.target.closest('[data-comms-node]');
      if (button) app.navigate('comms', button.dataset.commsNode);
    });
    bindForum(); bindTicker(); bindDrafts(); bindSenders();
    renderForm(); renderDrafts(); renderSenderRegistry();
  }

  app.comms = { init, activate, syncFromForm, renderForm, renderPreview, renderDrafts, renderSenderRegistry, buildBbcode, resolvedSalutation, nodes: NODES };
})();
