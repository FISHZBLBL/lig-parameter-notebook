(function (root) {
  'use strict';
  const DEFAULT_FIELDS = [
    { key: 'power', label: '激光器设定', unit: '%' },
    { key: 'speed', label: '扫描速度', unit: 'mm/s' },
    { key: 'frequency', label: '重复频率', unit: 'kHz' },
    { key: 'spacing', label: '线间距', unit: 'μm' }
  ];
  const CSS = `
  dialog.lig-batch-dialog{width:820px;max-width:calc(100vw - 28px);max-height:calc(100dvh - 40px);padding:0;border:1px solid var(--line,#dce5e9);border-radius:12px;color:var(--ink,#182c30);box-shadow:0 22px 80px #132e3333;overflow:hidden}
  dialog.lig-batch-dialog::backdrop{background:#132b3259;backdrop-filter:blur(2px)}
  .lig-batch-form{display:flex;flex-direction:column;max-height:calc(100dvh - 42px);min-height:0}
  .lig-batch-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;padding:21px 24px 16px;flex:none;border-bottom:1px solid var(--line,#dce5e9)}
  .lig-batch-head h2{font-size:21px;line-height:1.4;margin:0 0 4px;letter-spacing:-.5px}.lig-batch-head p{font-size:12px;color:var(--muted,#687c86);margin:0;line-height:1.7}
  .lig-batch-scroll{padding:19px 24px 20px;overflow:auto;min-height:0;overscroll-behavior:contain}
  .lig-batch-modes{display:flex;gap:5px;background:#f2f6f6;border:1px solid var(--line,#dce5e9);padding:4px;border-radius:7px;margin-bottom:16px}
  .lig-batch-mode{flex:1;border:0;padding:9px;background:transparent;border-radius:5px;min-height:39px;font-size:12px;font-weight:600;color:#6a7f86}
  .lig-batch-mode.active{background:#fff;color:var(--accent,#167663);box-shadow:0 1px 4px #182c300e}
  .lig-batch-help{font-size:11px;color:var(--muted,#687c86);line-height:1.9;margin:0 0 14px}
  .lig-batch-help code{font:11px var(--mono,Consolas,monospace);padding:2px 5px;background:#edf4f1;border-radius:3px;color:#276b58}
  .lig-batch-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px 16px}
  .lig-batch-field{display:flex;flex-direction:column;gap:6px;font-size:11px;font-weight:550;min-width:0}
  .lig-batch-field input,.lig-batch-field textarea,.lig-batch-field select{box-sizing:border-box;width:100%;min-width:0;font:13px var(--sans,sans-serif);padding:10px 11px;color:var(--ink,#182c30);background:#fff;border:1px solid #cedbe1;border-radius:6px;min-height:42px}
  .lig-batch-field textarea{line-height:1.8;resize:vertical;min-height:145px;font-family:var(--mono,Consolas,monospace);font-size:12px}
  .lig-batch-field input:focus,.lig-batch-field textarea:focus{border-color:var(--accent,#167663);outline:none;box-shadow:0 0 0 3px #16766312}
  .lig-batch-field small{font-size:10px;line-height:1.7;font-weight:400;color:#7a8f96}
  .lig-batch-common{display:grid;grid-template-columns:minmax(0,240px);gap:13px;margin-top:17px}
  .lig-batch-power{margin-bottom:16px}.lig-batch-power [hidden]{display:none}
  .lig-batch-checkbox{display:flex;align-items:flex-start;gap:8px;font-size:11px;color:#5d747d;margin:15px 0 16px;cursor:pointer;line-height:1.8}
  .lig-batch-checkbox input{accent-color:var(--accent,#167663);width:15px;height:15px;min-height:0;margin:3px 0 0;flex:none;cursor:pointer}
  .lig-batch-preview-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.lig-batch-preview-actions .btn{font-size:12px;min-height:39px;padding:8px 13px}
  .lig-batch-tip{font-size:10px;line-height:1.8;color:#7b8e95;margin:11px 0 0}
  .lig-batch-error{font-size:12px;line-height:1.8;color:var(--danger,#b33f3f);min-height:0;margin:13px 0 0}.lig-batch-error:empty{display:none}
  .lig-batch-preview{margin-top:19px;border:1px solid var(--line,#dce5e9);border-radius:8px;background:#fbfdfc;padding:15px;min-width:0}
  .lig-batch-preview-placeholder{font-size:12px;line-height:1.8;color:#7d9199;margin:0}
  .lig-batch-preview h3{font-size:14px;margin:0 0 10px;line-height:1.5}.lig-batch-counts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid #dce8e3;background:#fff;border-radius:6px;margin-bottom:10px;overflow:hidden}
  .lig-batch-stat{padding:10px 12px;border-right:1px solid #e1ebe6}.lig-batch-stat:last-child{border:0}.lig-batch-stat dt{font-size:10px;color:#6d838b;line-height:1.7}.lig-batch-stat dd{font:650 22px var(--mono,Consolas,monospace);color:#205747;margin:4px 0 0;line-height:1.4;letter-spacing:-.5px}
  .lig-batch-skip{font-size:11px;line-height:1.8;margin:0 0 12px;color:#6f858d}
  .lig-batch-table-scroll{overflow:auto;max-width:100%;border:1px solid var(--line,#dce5e9);border-radius:6px;background:#fff;overscroll-behavior:contain}
  .lig-batch-table{border-collapse:collapse;width:100%;min-width:470px;font-size:11px;table-layout:fixed}.lig-batch-table th{font-weight:550;text-align:left;color:#5d737d;background:#f3f7f6;padding:8px 10px;border-bottom:1px solid #dce5e9;font-size:10px;white-space:nowrap}.lig-batch-table td{font-family:var(--mono,Consolas,monospace);padding:7px 10px;border-bottom:1px solid #e6ecef;white-space:nowrap}.lig-batch-table tr:last-child td{border:0}.lig-batch-table th:first-child{width:50px}
  .lig-batch-table-note{font-size:10px;line-height:1.8;color:#7b8e95;margin:9px 0 0}
  .lig-batch-footer{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:14px 24px;border-top:1px solid var(--line,#dce5e9);background:#fbfcfc;flex:none;min-height:70px}
  .lig-batch-footer .btn{font-size:12px;min-height:41px;padding:9px 14px}.lig-batch-footer-message{font-size:10px;color:#758a93;margin-right:auto;line-height:1.7;max-width:240px}
  @media(max-width:560px){dialog.lig-batch-dialog{max-width:calc(100vw - 20px);max-height:calc(100dvh - 20px);border-radius:10px}.lig-batch-form{max-height:calc(100dvh - 22px)}.lig-batch-head{padding:17px 16px 13px}.lig-batch-head h2{font-size:19px}.lig-batch-head p{font-size:10px}.lig-batch-scroll{padding:14px 15px 16px}.lig-batch-mode{font-size:11px;padding:9px 4px}.lig-batch-fields{gap:12px 10px}.lig-batch-field{font-size:10px}.lig-batch-field input{font-size:12px;padding:9px 8px}.lig-batch-field small{font-size:9px}.lig-batch-help{font-size:10px}.lig-batch-common{grid-template-columns:1fr 1fr;gap:12px 10px}.lig-batch-common .lig-batch-field:first-child{grid-column:1/-1}.lig-batch-checkbox{font-size:10px;gap:7px}.lig-batch-counts{grid-template-columns:1fr 1fr}.lig-batch-stat{padding:9px 10px;border-bottom:1px solid #e1ebe6}.lig-batch-stat:nth-child(2){border-right:0}.lig-batch-stat:nth-child(3),.lig-batch-stat:nth-child(4){border-bottom:0}.lig-batch-stat dd{font-size:21px}.lig-batch-preview{padding:12px 10px}.lig-batch-preview h3{font-size:13px}.lig-batch-skip{font-size:10px}.lig-batch-footer{padding:12px 15px;gap:8px;flex-wrap:wrap}.lig-batch-footer-message{flex-basis:100%;max-width:none;margin:0;font-size:10px}.lig-batch-footer .btn{font-size:12px;padding:9px 12px}.lig-batch-tip{font-size:9px}}
  @media(prefers-reduced-motion:reduce){.lig-batch-dialog *{transition:none!important}}
  `;
  let instanceCounter = 0;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function today() {
    const date = new Date();
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }
  function number(value) { return Number(value).toLocaleString('en-US', { maximumFractionDigits: 8 }); }
  function csvCell(value) {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function safeFilename(value) { return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 60) || 'LIG'; }
  function fingerprint(groups) {
    return JSON.stringify(groups.map(function (group) { return [group.id, group.powerMode || 'watts', group.power, group.arrayPercent, group.speed, group.frequency, group.spacing, group.isDemo]; }));
  }

  function mount(options) {
    if (!options || typeof options.getState !== 'function' || typeof options.onCreate !== 'function') throw new Error('批量建组缺少数据或创建回调');
    const mm=options.spacingUnit==='mm', FIELDS=DEFAULT_FIELDS.map(f=>f.key==='spacing'&&mm?{...f,unit:'mm'}:f);
    const displayValue=(f,value)=>f.key==='spacing'&&mm?value/1000:value;
    let defaultLens=null,plannedLens=null;
    if (!document.getElementById('lig-batch-ui-style')) {
      const style = el('style'); style.id = 'lig-batch-ui-style'; style.textContent = CSS; document.head.append(style);
    }
    const prefixId = 'lig-batch-' + (++instanceCounter) + '-';
    const dialog = el('dialog', 'lig-batch-dialog');
    dialog.setAttribute('aria-labelledby', prefixId + 'title');
    const form = el('form', 'lig-batch-form');
    const head = el('div', 'lig-batch-head'), heading = el('div');
    const title = el('h2', '', '批量添加'); title.id = prefixId + 'title';
    heading.append(title, el('p', '', options.measurements?'每组建立 3 件方阻样品，每件测量 5 次，另 1 件表征 / 备用。':'每组自动建立 5 个方阻样品和 2 个表征 / 备用样品。'));
    const close = el('button', 'icon-btn', '✕'); close.type = 'button'; close.setAttribute('aria-label', '关闭批量建组'); close.addEventListener('click', function () { dialog.close(); });
    head.append(heading, close);
    const scroll = el('div', 'lig-batch-scroll');
    const modes = el('div', 'lig-batch-modes'); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '批量建组方式');
    const modeLevels = el('button', 'lig-batch-mode active', '按档位组合'), modeTable = el('button', 'lig-batch-mode', '粘贴参数表');
    modeLevels.type = modeTable.type = 'button'; modeLevels.setAttribute('aria-pressed', 'true'); modeTable.setAttribute('aria-pressed', 'false'); modes.append(modeLevels, modeTable);
    const levelPanel = el('section'), levelHelp = el('p', 'lig-batch-help');
    levelHelp.append(document.createTextNode('各参数可填一个固定值，或用逗号分隔多个档位。范围语法为 '), el('code', '', '起点:步长:终点'), document.createTextNode('，例如 '), el('code', '', '1:0.5:3'), document.createTextNode('（仅语法示例）。将生成所填档位的组合。'));
    const fields = el('div', 'lig-batch-fields'), levels = Object.create(null);
    function field(labelText, input) {
      const label = el('label', 'lig-batch-field', labelText); label.append(input); return label;
    }
    const powerControls = el('div', 'lig-batch-fields lig-batch-power'), powerChoice = el('select');
    powerChoice.setAttribute('aria-label', '批量功率变化轴');
    [['laser', '变化激光器百分比'], ['array', '变化阵列百分比']].forEach(function (entry) {
      const option = el('option', '', entry[1]); option.value = entry[0]; powerChoice.append(option);
    });
    powerChoice.value = 'laser';
    const fixedArrayInput = el('input'), fixedLaserInput = el('input');
    [fixedArrayInput, fixedLaserInput].forEach(function (input) { input.type = 'number'; input.min = '0'; input.max = '100'; input.step = 'any'; });
    fixedArrayInput.value = '100'; fixedLaserInput.value = '';
    fixedArrayInput.setAttribute('aria-label', '批量固定阵列百分比'); fixedLaserInput.setAttribute('aria-label', '批量基准激光器百分比');
    const fixedArrayField = field('固定阵列 / %', fixedArrayInput), fixedLaserField = field('基准激光器设定 / %', fixedLaserInput);
    powerControls.append(field('批量变化参数', powerChoice), fixedArrayField, fixedLaserField);
    let powerLevelField;
    FIELDS.forEach(function (definition) {
      const input = el('input'); input.type = 'text'; input.autocomplete = 'off'; input.maxLength = 2000; input.id = prefixId + definition.key;
      input.setAttribute('aria-label', '批量' + definition.label + '档位 / ' + definition.unit);
      input.placeholder = '逗号多值，或 起点:步长:终点';
      const wrapper = field(definition.label + ' / ' + definition.unit, input);
      if (definition.key === 'power') powerLevelField = wrapper;
      wrapper.append(el('small', '', '固定该参数时只填一个值'));
      fields.append(wrapper); levels[definition.key] = input;
    });
    levelPanel.append(levelHelp, fields);
    const tablePanel = el('section'); tablePanel.hidden = true;
    const tableHelp = el('p', 'lig-batch-help'); tablePanel.append(tableHelp);
    const tableInput = el('textarea'); tableInput.rows = 6; tableInput.maxLength = 200000; tableInput.spellcheck = false; tableInput.setAttribute('aria-label', '粘贴四列或五列百分比参数表');
    tablePanel.append(field('参数表 · 每行一组', tableInput));
    const common = el('div', 'lig-batch-common'), dateInput = el('input');
    dateInput.type = 'date'; dateInput.value = today(); dateInput.setAttribute('aria-label', '批量加工日期');
    const lensSelect=el('select');lensSelect.setAttribute('aria-label','批量镜头');lensSelect.addEventListener('change',()=>invalid('镜头已变化，请重新预览。'));
    common.append(field('加工日期', dateInput),field('镜头',lensSelect));
    const duplicateLabel = el('label', 'lig-batch-checkbox'), duplicateInput = el('input'); duplicateInput.type = 'checkbox'; duplicateInput.setAttribute('aria-label', '保留重复组合（用于重复批次）');
    duplicateLabel.append(duplicateInput, el('span', '', '保留重复组合（用于重复批次）'));
    const previewActions = el('div', 'lig-batch-preview-actions'), previewButton = el('button', 'btn quiet', '预览参数计划'), exportButton = el('button', 'btn', '下载参数计划 CSV');
    previewButton.type = exportButton.type = 'button'; exportButton.disabled = true; previewActions.append(previewButton, exportButton);
    const tip = el('p', 'lig-batch-tip', '激光器%与阵列%分别保存。每行实测功率可在创建后单独补录（mW）；'+(options.measurements?'每件保留五次原始读数。':'每片默认录入一个方阻值。'));
    const error = el('p', 'lig-batch-error'); error.setAttribute('role', 'alert');
    const preview = el('section', 'lig-batch-preview'); preview.setAttribute('aria-label', '批量参数计划预览'); preview.setAttribute('aria-live', 'polite');
    scroll.append(modes, powerControls, levelPanel, tablePanel, common, duplicateLabel, previewActions, tip, error, preview);
    const footer = el('div', 'lig-batch-footer'), footerMessage = el('span', 'lig-batch-footer-message', '预览通过后才能创建；当前记录保持不变。');
    const cancelButton = el('button', 'btn', '取消'), createButton = el('button', 'btn primary', '添加这些记录'); cancelButton.type = 'button'; createButton.type = 'submit'; createButton.disabled = true; cancelButton.addEventListener('click', function () { dialog.close(); }); footer.append(footerMessage, cancelButton, createButton);
    form.append(head, scroll, footer); dialog.append(form); document.body.append(dialog);
    let mode = 'levels', currentPlan = null, version = 0, plannedFingerprint = '', previewing = false;

    function invalid(message) {
      version++; currentPlan = null; plannedFingerprint = ''; exportButton.disabled = true; createButton.disabled = true; createButton.textContent = '添加这些记录';
      footerMessage.textContent = '预览通过后才能创建；当前记录保持不变。';
      preview.replaceChildren(el('p', 'lig-batch-preview-placeholder', message || '填写参数后点击“预览参数计划”，查看将要创建的数量与组合。'));
      error.textContent = '';
    }
    invalid();
    function powerOptions() {
      return powerChoice.value === 'array'
        ? { powerMode: 'percent', inputPower: 'array', laserPercent: fixedLaserInput.value,spacingUnit:mm?'mm':'um' }
        : { powerMode: 'percent', inputPower: 'laser', arrayPercent: fixedArrayInput.value,spacingUnit:mm?'mm':'um' };
    }
    function syncPowerControls() {
      const selected = powerChoice.value, label = selected === 'array' ? '阵列 / %' : '激光器设定 / %';
      fixedArrayField.hidden = selected !== 'laser'; fixedArrayInput.disabled = selected !== 'laser'; fixedArrayInput.required = selected === 'laser';
      fixedLaserField.hidden = selected !== 'array'; fixedLaserInput.disabled = selected !== 'array'; fixedLaserInput.required = selected === 'array';
      powerLevelField.firstChild.nodeValue = label;
      levels.power.setAttribute('aria-label', '批量' + label + '档位');
      const header = selected === 'array' ? 'array_percent' : 'laser_percent';
      tableInput.placeholder = header + '\tspeed_mm_s\tfrequency_khz\tspacing_'+(mm?'mm':'um')+'\n保留四列顺序粘贴参数；也可粘贴导出的百分比五列计划。';
      tableHelp.textContent = '四列依次为' + label + '、扫速(mm/s)、重频(kHz)、线间距('+(mm?'mm':'μm')+')。含表头时以表头单位为准。';
    }
    syncPowerControls();
    powerChoice.addEventListener('change', function () { syncPowerControls(); invalid('批量变化参数已切换，请重新预览。'); });
    function setMode(next) {
      mode = next; levelPanel.hidden = mode !== 'levels'; tablePanel.hidden = mode !== 'table';
      modeLevels.classList.toggle('active', mode === 'levels'); modeTable.classList.toggle('active', mode === 'table');
      modeLevels.setAttribute('aria-pressed', String(mode === 'levels')); modeTable.setAttribute('aria-pressed', String(mode === 'table'));
      invalid('建组方式已变化，请重新预览参数计划。');
    }
    modeLevels.addEventListener('click', function () { if (mode !== 'levels') setMode('levels'); });
    modeTable.addEventListener('click', function () { if (mode !== 'table') setMode('table'); });
    [dateInput, fixedArrayInput, fixedLaserInput, duplicateInput, tableInput].concat(Object.values(levels)).forEach(function (input) {
      input.addEventListener('input', function () { invalid('输入已变化，请重新预览后再创建或下载计划。'); });
      input.addEventListener('change', function () { invalid('输入已变化，请重新预览后再创建或下载计划。'); });
    });

    function publicFieldsValid() {
      if (!dateInput.checkValidity()) { dateInput.reportValidity(); throw new Error('请填写有效的加工日期。'); }
      if (!form.checkValidity()) { form.reportValidity(); throw new Error('请检查表单中的必填内容。'); }
    }
    function renderPlan(plan) {
      preview.replaceChildren(); preview.append(el('h3', '', '将创建 ' + number(plan.groupCount) + ' 组参数，共 ' + number(plan.sampleCount) + ' 个 LIG 样品'));
      const counts = el('dl', 'lig-batch-counts');
      [['参数组', plan.groupCount], ['LIG 样品总数', plan.sampleCount], ['电学样品', plan.electricalCount], ['表征 / 备用样品', plan.characterizationCount]].forEach(function (entry) {
        const box = el('div', 'lig-batch-stat'); box.append(el('dt', '', entry[0]), el('dd', '', number(entry[1]))); counts.append(box);
      });
      preview.append(counts);
      preview.append(el('p', 'lig-batch-skip', '输入组合 ' + number(plan.inputCount) + ' 组 · 跳过表内重复 ' + number(plan.skippedInput) + ' 组 · 跳过已有组合 ' + number(plan.skippedExisting) + ' 组。' + (duplicateInput.checked ? '当前保留重复组合，用于不同批次。' : '相同四参数组合默认只创建一次。')));
      if (!plan.rows.length) preview.append(el('p', 'lig-batch-preview-placeholder', '没有新增组合。可调整输入，或勾选保留重复组合以建立另一个批次。'));
      else {
        const tableScroll = el('div', 'lig-batch-table-scroll'); tableScroll.tabIndex = 0; tableScroll.setAttribute('aria-label', '参数计划前十二行，可横向滚动');
        const table = el('table', 'lig-batch-table'), caption = el('caption', 'sr-only', '参数计划预览，最多显示前十二组。下载 CSV 包含完整计划。'); table.append(caption);
        const thead = el('thead'), header = el('tr'); header.append(el('th', '', '序号'));
        header.append(el('th', '', '激光器 / %'), el('th', '', '阵列 / %'));
        FIELDS.slice(1).forEach(function (f) { header.append(el('th', '', f.label + ' / ' + f.unit)); }); thead.append(header); table.append(thead);
        const tbody = el('tbody'); plan.rows.slice(0, 12).forEach(function (row, index) {
          const tr = el('tr'); tr.append(el('td', '', String(index + 1).padStart(3, '0')), el('td', '', number(row.power)));
          tr.append(el('td', '', number(row.arrayPercent)));
          FIELDS.slice(1).forEach(function (f) { tr.append(el('td', '', number(displayValue(f,row[f.key])))); }); tbody.append(tr);
        }); table.append(tbody); tableScroll.append(table); preview.append(tableScroll);
      }
      preview.append(el('p', 'lig-batch-table-note', plan.rows.length > 12 ? '这里只预览前 12 组，其余 ' + number(plan.rows.length - 12) + ' 组未展开。下载参数计划 CSV 会导出全部 ' + number(plan.rows.length) + ' 组。' : options.measurements?'预览已显示全部组合。每组 E01—E03 各保留五次读数，M01 不参与平均。':'预览已显示全部组合。生成后每组都有 E01—E05 和 M01—M02，测量值保持空白。'));
      createButton.textContent = plan.groupCount ? '确认添加 ' + number(plan.groupCount) + ' 行' : '没有新增记录';
      footerMessage.textContent = plan.groupCount ? '将新增 ' + number(plan.sampleCount) + ' 个空白样品记录。' : '请调整输入后重新预览。';
    }
    previewButton.addEventListener('click', async function () {
      if (previewing) return;
      invalid(); const requestVersion = version;
      try {
        publicFieldsValid();
        if (!root.LIGBatchCore) throw new Error('批量参数组件尚未就绪，请稍后重试。');
        previewing = true; previewButton.disabled = true; previewButton.textContent = '正在计算计划…';
        const input = {}; FIELDS.forEach(function (f) { input[f.key] = levels[f.key].value; });
        const rows = mode === 'levels' ? await root.LIGBatchCore.fromLevels(input, powerOptions()) : await root.LIGBatchCore.parseTable(tableInput.value, powerOptions());
        if (rows.some(function (row) { return row.powerMode !== 'percent'; })) throw new Error('批量参数表请使用激光器%与阵列%；实测功率可在创建后逐行补录 mW。');
        const groups = options.getState().groups || [];
        plannedLens=lensSelect.value==='__default__'?defaultLens:(options.getState().lenses||[]).find(l=>l.id===lensSelect.value)||null;
        const plan = await root.LIGBatchCore.plan(rows, groups, { allowDuplicates: duplicateInput.checked,lensKey:JSON.stringify(plannedLens),measurements:options.measurements });
        if (requestVersion !== version) return;
        if (!plan || !Array.isArray(plan.rows)) throw new Error('参数计划格式不正确。');
        currentPlan = plan; plannedFingerprint = fingerprint(groups); renderPlan(plan);
        exportButton.disabled = !plan.rows.length; createButton.disabled = !plan.rows.length;
      } catch (problem) { if (requestVersion === version) error.textContent = problem.message || '未能生成参数计划，请检查输入。'; }
      finally { previewing = false; previewButton.disabled = false; previewButton.textContent = '预览参数计划'; }
    });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      try {
        publicFieldsValid();
        if (!currentPlan || !currentPlan.rows.length) throw new Error('请先预览参数计划。');
        if (fingerprint(options.getState().groups || []) !== plannedFingerprint) {
          invalid('现有参数组已变化，请重新预览以核对重复组合。'); throw new Error('现有参数组已变化，请重新预览。');
        }
        const payload = {
          rows: currentPlan.rows.map(function (row) { return Object.assign({}, row); }),
          prefix: '', date: dateInput.value || today(), parentSheet: '', notes: '', allowDuplicates: duplicateInput.checked,lens:plannedLens
        };
        options.onCreate(payload);
        dialog.close(); invalid();
      } catch (problem) { error.textContent = problem.message || '未能创建，请检查参数。'; }
    });
    exportButton.addEventListener('click', function () {
      if (!currentPlan || !currentPlan.rows.length) return;
      const rows = [['laser_percent', 'array_percent', 'speed_mm_s', 'frequency_khz', mm?'spacing_mm':'spacing_um']];
      currentPlan.rows.forEach(function (row) {
        rows.push([row.power, row.arrayPercent, row.speed, row.frequency, mm?row.spacing/1000:row.spacing]);
      });
      const csv = '\uFEFF' + rows.map(function (row) { return row.map(csvCell).join(','); }).join('\r\n') + '\r\n';
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' }), url = URL.createObjectURL(blob), anchor = el('a');
      anchor.href = url; anchor.download = 'LIG_参数计划_' + dateInput.value + '.csv';
      document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    });
    return Object.freeze({
      open: function () {
        invalid();
        const seed=options.getDefaults?.(),availableLenses=(options.getState().lenses||[]).filter(l=>!l.archived);defaultLens=seed?.lens||(availableLenses.length===1?availableLenses[0]:null);
        lensSelect.replaceChildren();for(const lens of [null,...(defaultLens?[{...defaultLens,id:'__default__',name:defaultLens.name+'（沿用资料）'}]:[]),...(options.getState().lenses||[]).filter(l=>!l.archived)]){const opt=el('option','',lens?.name||'未选择镜头');opt.value=lens?.id||'';lensSelect.append(opt);}
        lensSelect.value=defaultLens?'__default__':'';
        if(seed){powerChoice.value='laser';fixedArrayInput.value=seed.arrayPercent??100;for(const f of FIELDS)levels[f.key].value=f.key==='power'&&seed.powerMode!=='percent'?'':displayValue(f,seed[f.key]);syncPowerControls();}
        if (!dateInput.value) dateInput.value = today();
        dialog.showModal();
      }
    });
  }
  root.LIGBatchUI = Object.freeze({ mount: mount });
})(globalThis);
