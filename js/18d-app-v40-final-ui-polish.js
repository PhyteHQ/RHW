/* ==========================================================================
   RHW WEB APP · V4.0.1 UI CORRECTION
   Guarantees distinct recipe variant labels, makes per-unit costing the
   consistent primary quote metric and puts System Clock in the top-left
   position of the uplink information grid.
   ========================================================================== */
(function initRhwV4FinalUiPolish() {
  'use strict';
  const app = window.RHWV4;
  const core = app?.operationsCore;
  if (!app || !core || app.finalUiPolish) return;

  const STYLE_ID = 'rhwV40FinalUiPolishStyle';
  const KNOWN_FINAL_LABELS = Object.freeze({
    recipe_gold_basic: 'Gold refining · Basic',
    recipe_gold_advanced: 'Gold refining · Advanced',
    recipe_gold_adv: 'Gold refining · Advanced',
    recipe_gold_bulk: 'Gold refining · Bulk',
    recipe_gold_wildcat_conversion: 'Wildcat Gold reprocessing',
    recipe_diamonds_basic: 'Diamonds refining · Basic',
    recipe_diamonds_advanced: 'Diamonds refining · Advanced',
    recipe_diamonds_adv: 'Diamonds refining · Advanced',
    recipe_diamonds_bulk: 'Diamonds refining · Bulk'
  });

  let labelMap = new Map();
  let labelCatalogRef = null;
  let calculatorObserver = null;
  let polishQueued = false;

  const normalize = value => app.util.normalize(String(value || ''));

  function baseRecipeName(recipe) {
    if (!recipe) return 'UNKNOWN RECIPE';
    const alias = app.operations?.recipeAliases?.[recipe.id];
    const output = recipe.outputs?.[0];
    const product = output ? core.product(output.id) : null;
    return alias?.name || product?.name || output?.name || recipe.name || recipe.id || 'UNKNOWN RECIPE';
  }

  function prettyToken(value) {
    return String(value || '')
      .replace(/[_-]+/g, ' ')
      .replace(/\badv\b/gi, 'advanced')
      .replace(/\bmk\s*(\d+)\b/gi, 'Mk $1')
      .replace(/\bv\s*(\d+)\b/gi, 'V$1')
      .replace(/\b\w/g, char => char.toUpperCase())
      .trim();
  }

  function variantFromId(recipe, baseName) {
    const id = String(recipe?.id || '').toLowerCase();
    const suffixes = [
      [/(?:_|-)basic$/, 'Basic'],
      [/(?:_|-)(?:advanced|adv)$/, 'Advanced'],
      [/(?:_|-)bulk$/, 'Bulk'],
      [/(?:_|-)conversion$/, 'Conversion'],
      [/(?:_|-)reprocessing$/, 'Reprocessing'],
      [/(?:_|-)standard$/, 'Standard'],
      [/(?:_|-)small$/, 'Small'],
      [/(?:_|-)medium$/, 'Medium'],
      [/(?:_|-)large$/, 'Large'],
      [/(?:_|-)heavy$/, 'Heavy'],
      [/(?:_|-)light$/, 'Light'],
      [/(?:_|-)(mk\d+)$/, null],
      [/(?:_|-)(v\d+)$/, null]
    ];
    for (const [pattern, fixed] of suffixes) {
      const match = id.match(pattern);
      if (match) return fixed || prettyToken(match[1]);
    }

    const craftType = String(recipe?.craftType || '').trim();
    if (craftType && normalize(craftType) !== normalize(baseName)) return prettyToken(craftType);

    const recipeName = String(recipe?.name || '').trim();
    if (recipeName && normalize(recipeName) !== normalize(baseName)) return recipeName;

    const cleaned = id
      .replace(/^(?:recipe|module|ship_assembly|assembly)_/, '')
      .split('_')
      .filter(Boolean);
    const baseWords = new Set(normalize(baseName).split(/\s+/).filter(Boolean));
    const remainder = cleaned.filter(token => !baseWords.has(normalize(token)));
    if (remainder.length) return prettyToken(remainder.join(' '));

    if (Number(recipe?.reqLevel) > 0) return `Level ${Number(recipe.reqLevel)}`;
    return String(recipe?.id || 'recipe');
  }

  function buildLabelMap() {
    const catalog = core.state.catalog;
    if (!catalog?.recipes) return new Map();
    if (labelCatalogRef === catalog && labelMap.size === catalog.recipes.length) return labelMap;

    const recipes = [...catalog.recipes];
    const baseNames = new Map(recipes.map(recipe => [recipe.id, baseRecipeName(recipe)]));
    const grouped = new Map();
    recipes.forEach(recipe => {
      const key = normalize(baseNames.get(recipe.id));
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(recipe);
    });

    const final = new Map();
    grouped.forEach(group => {
      group.forEach(recipe => {
        const known = KNOWN_FINAL_LABELS[recipe.id];
        if (known) {
          final.set(recipe.id, known);
          return;
        }
        const base = baseNames.get(recipe.id);
        final.set(recipe.id, group.length > 1 ? `${base} · ${variantFromId(recipe, base)}` : base);
      });
    });

    // Absolute uniqueness guard across the whole catalog. Human-readable
    // variants are preferred; recipe id is only the final fallback.
    const collisions = new Map();
    recipes.forEach(recipe => {
      const key = normalize(final.get(recipe.id));
      if (!collisions.has(key)) collisions.set(key, []);
      collisions.get(key).push(recipe);
    });
    collisions.forEach(group => {
      if (group.length < 2) return;
      group.forEach(recipe => final.set(recipe.id, `${final.get(recipe.id)} · ${recipe.id}`));
    });

    labelCatalogRef = catalog;
    labelMap = final;
    return final;
  }

  function recipeLabel(recipe) {
    if (!recipe) return 'UNKNOWN RECIPE';
    return buildLabelMap().get(recipe.id) || KNOWN_FINAL_LABELS[recipe.id] || baseRecipeName(recipe);
  }

  function duplicateFinalLabels() {
    const recipes = core.state.catalog?.recipes || [];
    const grouped = new Map();
    recipes.forEach(recipe => {
      const label = recipeLabel(recipe);
      const key = normalize(label);
      if (!grouped.has(key)) grouped.set(key, { label, ids: [] });
      grouped.get(key).ids.push(recipe.id);
    });
    return [...grouped.values()].filter(group => group.ids.length > 1).map(group => [group.label, group.ids]);
  }

  function polishRecipeOptions() {
    const select = document.getElementById('opsRecipe');
    if (!select || !core.state.catalog) return;
    [...select.options].forEach(option => {
      const recipe = core.recipe(option.value);
      if (!recipe) return;
      const label = recipeLabel(recipe);
      if (option.textContent !== label) option.textContent = label;
      option.dataset.rhwRecipeLabel = label;
      const title = `${label} // ${recipe.id}`;
      if (option.title !== title) option.title = title;
    });
  }

  function actualOutputText() {
    const block = [...document.querySelectorAll('#workspaceOperations .ops-recipe-meta > div')]
      .find(entry => entry.querySelector('small')?.textContent?.trim() === 'ACTUAL OUTPUT');
    return block?.querySelector('strong')?.textContent?.trim() || '1';
  }

  function polishCostFlow() {
    const card = document.querySelector('#workspaceOperations .ops-flow-cost');
    if (!card) return;
    const total = card.querySelector('#opsTotalCost');
    const unit = card.querySelector('#opsUnitCost');
    if (!total || !unit) return;

    const totalText = total.textContent || '—';
    const unitText = unit.textContent || '—';
    const actual = actualOutputText();
    const alreadyPolished = card.classList.contains('v401-unit-cost-flow')
      && card.querySelector(':scope > strong#opsUnitCost')
      && card.querySelector(':scope > div b#opsTotalCost');

    if (!alreadyPolished) {
      card.classList.add('v401-unit-cost-flow');
      card.innerHTML = `<small>01 · COST / UNIT</small><strong id="opsUnitCost">${app.util.escape(unitText)}</strong><span>MANUFACTURING COST / PRODUCED UNIT</span><div><em>TOTAL BATCH COST // ${app.util.escape(actual)} PRODUCED</em><b id="opsTotalCost">${app.util.escape(totalText)}</b></div>`;
    } else {
      const small = card.querySelector(':scope > small');
      const span = card.querySelector(':scope > span');
      const em = card.querySelector(':scope > div em');
      if (small && small.textContent !== '01 · COST / UNIT') small.textContent = '01 · COST / UNIT';
      if (span && span.textContent !== 'MANUFACTURING COST / PRODUCED UNIT') span.textContent = 'MANUFACTURING COST / PRODUCED UNIT';
      const batchLabel = `TOTAL BATCH COST // ${actual} PRODUCED`;
      if (em && em.textContent !== batchLabel) em.textContent = batchLabel;
    }

    const margin = document.querySelector('#workspaceOperations .ops-flow-margin');
    if (margin) {
      const small = margin.querySelector(':scope > small');
      const paragraph = margin.querySelector(':scope > p');
      if (small && small.textContent !== '02 · TARGET PROFIT MARGIN') small.textContent = '02 · TARGET PROFIT MARGIN';
      const marginCopy = 'PROFIT SHARE OF SELL PRICE // CALCULATED PER UNIT';
      if (paragraph && paragraph.textContent !== marginCopy) paragraph.textContent = marginCopy;
    }

    const sell = document.querySelector('#workspaceOperations .ops-flow-sell');
    if (sell) {
      const small = sell.querySelector(':scope > small');
      const span = sell.querySelector(':scope > span');
      const em = sell.querySelector(':scope > div em');
      const b = sell.querySelector(':scope > div b');
      if (small && small.textContent !== '03 · RECOMMENDED SALE / UNIT') small.textContent = '03 · RECOMMENDED SALE / UNIT';
      if (span && span.textContent !== 'SELL PRICE / PRODUCED UNIT') span.textContent = 'SELL PRICE / PRODUCED UNIT';
      if (em && em.textContent !== 'MARGIN APPLIED TO UNIT QUOTE') em.textContent = 'MARGIN APPLIED TO UNIT QUOTE';
      if (b && b.textContent !== 'UNIT QUOTE') b.textContent = 'UNIT QUOTE';
    }
  }

  function fixHeaderClockLayout() {
    const grid = document.querySelector('.uplink-grid');
    if (!grid) return;
    const stats = [...grid.children].filter(node => node.classList.contains('uplink-stat'));
    const byLabel = new Map(stats.map(node => [node.querySelector('small')?.textContent?.trim() || '', node]));
    const order = ['SYSTEM CLOCK', 'LATEST SYNC', 'NEXT SYNC', 'REFRESH CYCLE'];
    const anchor = [...grid.children].find(node => node.classList.contains('uplink-actions')) || null;
    order.forEach(label => {
      const node = byLabel.get(label);
      if (node) grid.insertBefore(node, anchor);
    });

    const classMap = new Map([
      ['SYSTEM CLOCK', 'uplink-clock-stat'],
      ['LATEST SYNC', 'uplink-latest-stat'],
      ['NEXT SYNC', 'uplink-next-stat'],
      ['REFRESH CYCLE', 'uplink-refresh-stat']
    ]);
    classMap.forEach((className, label) => byLabel.get(label)?.classList.add(className));
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.dataset.stylesheet = '35-app-interface-cleanup.css';
    document.head.appendChild(style);
  }

  function queuePolish() {
    if (polishQueued) return;
    polishQueued = true;
    queueMicrotask(() => {
      polishQueued = false;
      polishRecipeOptions();
      polishCostFlow();
    });
  }

  function installCalculatorObserver() {
    const workspace = document.getElementById('workspaceOperations');
    if (!workspace || workspace.dataset.v40FinalUiPolish === 'true') return;
    workspace.dataset.v40FinalUiPolish = 'true';
    calculatorObserver = new MutationObserver(queuePolish);
    calculatorObserver.observe(workspace, { childList: true, subtree: true });
    workspace.addEventListener('input', queuePolish, true);
    workspace.addEventListener('change', queuePolish, true);
    queuePolish();
  }

  const baseLoadCatalog = core.loadCatalog.bind(core);
  core.loadCatalog = async function finalPolishCatalogLoad(...args) {
    const catalog = await baseLoadCatalog(...args);
    labelCatalogRef = null;
    buildLabelMap();
    return catalog;
  };

  const baseOperationsInit = app.operations?.init;
  if (typeof baseOperationsInit === 'function') {
    app.operations.init = async function finalUiPolishOperationsInit(...args) {
      const result = await baseOperationsInit.apply(this, args);
      installCalculatorObserver();
      queuePolish();
      return result;
    };
  }

  function goldLabels() {
    const ids = ['recipe_gold_basic', 'recipe_gold_advanced', 'recipe_gold_adv', 'recipe_gold_bulk', 'recipe_gold_wildcat_conversion'];
    return ids.map(id => core.recipe(id)).filter(Boolean).map(recipe => recipeLabel(recipe));
  }

  function selfTest() {
    const failures = [];
    if (core.state.catalog && duplicateFinalLabels().length) failures.push('duplicate-recipe-labels');
    const gold = goldLabels();
    if (gold.length > 1 && new Set(gold.map(normalize)).size !== gold.length) failures.push('gold-recipe-labels');

    const grid = document.querySelector('.uplink-grid');
    if (grid) {
      const labels = [...grid.children].filter(node => node.classList.contains('uplink-stat')).map(node => node.querySelector('small')?.textContent?.trim() || '');
      if (labels.slice(0, 4).join('|') !== 'SYSTEM CLOCK|LATEST SYNC|NEXT SYNC|REFRESH CYCLE') failures.push('header-clock-order');
    }

    const card = document.querySelector('#workspaceOperations .ops-flow-cost');
    if (card) {
      if (!card.querySelector(':scope > strong#opsUnitCost')) failures.push('unit-cost-primary');
      if (!card.querySelector(':scope > div b#opsTotalCost')) failures.push('batch-cost-secondary');
      if (!card.textContent.includes('COST / UNIT') || !card.textContent.includes('BATCH COST')) failures.push('cost-labels');
    }
    return failures;
  }

  installStyles();
  fixHeaderClockLayout();
  installCalculatorObserver();

  app.finalUiPolish = {
    recipeLabel,
    duplicateFinalLabels,
    polishRecipeOptions,
    polishCostCard: polishCostFlow,
    polishCostFlow,
    fixHeaderClockLayout,
    goldLabels,
    selfTest
  };
})();