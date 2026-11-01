(function (root) {
  'use strict';
  const KEYS = ['power', 'speed', 'frequency', 'spacing'];
  const LABELS = ['功率', '扫描速度', '重频', '线间距'];
  const UNITS = ['W', 'mm/s', 'kHz', 'um'];
  const NUMBER = /^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  const ALIASES = [
    ['power', 'power_w', '功率', '激光功率'],
    ['speed', 'speed_mm_s', '扫描速度', '扫描速', '扫速'],
    ['frequency', 'frequency_khz', '重频', '重复频率'],
    ['spacing', 'spacing_um', 'spacing_mm', '线间距']
  ];

  function fail(message) { throw new Error(message); }
  function number(value, label) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    if (typeof value === 'string' && value.trim().length <= 64 && NUMBER.test(value.trim())) {
      const result = Number(value.trim());
      if (Number.isFinite(result) && result > 0) return result;
    }
    fail(label + '必须是有限正数（单元格不附加单位）');
  }
  function parts(text) {
    const split = text.replace(/^\+/, '').toLowerCase().split('e');
    const mantissa = split[0].split('.');
    const fraction = mantissa[1] || '';
    let coefficient = BigInt((mantissa[0] || '0') + fraction);
    let scale = fraction.length - Number(split[1] || 0);
    if (scale < 0) { coefficient *= 10n ** BigInt(-scale); scale = 0; }
    return { coefficient, scale };
  }
  function range(token, label) {
    const tokens = token.split(':');
    if (tokens.length !== 3) fail(label + '范围须写为 起点:正步长:终点');
    tokens.forEach(function (value) { number(value, label + '范围'); });
    const values = tokens.map(parts);
    const scale = Math.max.apply(null, values.map(function (value) { return value.scale; }));
    const integers = values.map(function (value) { return value.coefficient * 10n ** BigInt(scale - value.scale); });
    const start = integers[0], step = integers[1], end = integers[2];
    if (end < start) fail(label + '范围必须升序，步长必须为正数');
    if ((end - start) % step !== 0n) fail(label + '范围终点必须能按步长准确到达；请调整终点或步长');
    const count = (end - start) / step + 1n;
    if (count > 1000n) fail(label + '单个范围超过1000档');
    const result = [];
    for (let index = 0n; index < count; index++) {
      const value = Number(String(start + index * step) + 'e-' + scale);
      if (!Number.isFinite(value) || value <= 0) fail(label + '范围超出可用数值范围');
      if (result.length && value <= result[result.length - 1]) fail(label + '步长过小，超出当前数值精度');
      result.push(value);
    }
    return result;
  }

  function parseLevels(text, label) {
    label = label || '参数';
    if (typeof text !== 'string' || !text.trim()) fail(label + '至少填写一个档位');
    if (text.length > 100000) fail(label + '输入过长');
    const result = [], seen = new Set();
    text.trim().split(/[\s,，;；]+/).forEach(function (token) {
      const values = token.includes(':') ? range(token, label) : [number(token, label)];
      values.forEach(function (value) {
        if (!seen.has(value)) { seen.add(value); result.push(value); }
        if (result.length > 1000) fail(label + '总档位数不能超过1000');
      });
    });
    return result;
  }

  function levels(value, label) {
    if (typeof value === 'string') return parseLevels(value, label);
    if (!Array.isArray(value) || !value.length || value.length > 1000) fail(label + '须填写1—1000个档位');
    return Array.from(new Set(Array.from(value, function (entry) { return number(entry, label); })));
  }
  function percent(value, label) {
    const result = number(value, label);
    if (result > 100) fail(label + '须大于0且不超过100');
    return result;
  }
  function powerSettings(options) {
    options = options || {};
    const powerMode = options.powerMode === undefined ? 'watts' : options.powerMode;
    if (!['watts', 'percent'].includes(powerMode)) fail('功率口径须为 watts 或 percent');
    const inputPower = options.inputPower === undefined ? 'laser' : options.inputPower;
    if (!['laser', 'array'].includes(inputPower)) fail('百分比输入端须为 laser 或 array');
    if (powerMode === 'watts' && inputPower === 'array') fail('按阵列百分比变化时须使用百分比口径');
    return {
      powerMode, inputPower,
      arrayPercent: powerMode === 'percent' && inputPower === 'laser' ? percent(options.arrayPercent === undefined ? 100 : options.arrayPercent, '固定阵列百分比') : null,
      laserPercent: powerMode === 'percent' && inputPower === 'array' ? percent(options.laserPercent, '基准激光器设定百分比') : null
    };
  }
  function powerRow(value, settings) {
    if (settings.powerMode === 'watts') return { powerMode: 'watts', power: number(value, '功率录入(W)'), arrayPercent: null };
    return {
      powerMode: 'percent',
      power: settings.inputPower === 'laser' ? percent(value, '激光器设定百分比') : settings.laserPercent,
      arrayPercent: settings.inputPower === 'array' ? percent(value, '阵列百分比') : settings.arrayPercent
    };
  }
  function fromLevels(fields, options) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) fail('四参数档位格式不正确');
    const settings = powerSettings(options);
    const powerLabel = settings.powerMode === 'watts' ? '功率录入(W)' : settings.inputPower === 'array' ? '阵列(%)' : '激光器设定(%)';
    const groups = KEYS.map(function (key, index) { return levels(fields[key], index === 0 ? powerLabel : LABELS[index]); });
    if(options?.spacingUnit==='mm')groups[3]=groups[3].map(value=>number(value*1000,'线间距(mm)换算值'));
    const count = groups.reduce(function (product, values) { return product * values.length; }, 1);
    if (count > 1000) fail('将生成' + count + '组参数组合、' + count * 7 + '个样品，超过每次最多1000组；请缩小档位范围或分批规划');
    const rows = [];
    groups[0].forEach(function (power) {
      groups[1].forEach(function (speed) {
        groups[2].forEach(function (frequency) {
          groups[3].forEach(function (spacing) { rows.push(Object.assign({ speed, frequency, spacing }, powerRow(power, settings))); });
        });
      });
    });
    return rows;
  }

  function delimiter(text) {
    let quoted = false, tabs = 0, commas = 0;
    for (let index = 0; index < text.length; index++) {
      const character = text[index];
      if (character === '"') {
        if (quoted && text[index + 1] === '"') index++;
        else quoted = !quoted;
      } else if (!quoted) {
        if (character === '\n') break;
        if (character === '\t') tabs++;
        if (character === ',') commas++;
      }
    }
    if (tabs && commas) fail('首行混用了制表符和英文逗号，请使用四列Excel表格或CSV');
    return tabs ? '\t' : ',';
  }
  function records(text, separator) {
    const result = [];
    let cells = [], field = '', quoted = false, closed = false, line = 1, startLine = 1;
    function endField() { cells.push(field); field = ''; closed = false; }
    function endRecord() { endField(); result.push({ cells, line: startLine }); cells = []; startLine = line + 1; }
    for (let index = 0; index < text.length; index++) {
      const character = text[index];
      if (quoted) {
        if (character === '"') {
          if (text[index + 1] === '"') { field += '"'; index++; }
          else { quoted = false; closed = true; }
        } else { field += character; if (character === '\n') line++; }
      } else if (character === separator) endField();
      else if (character === '\n') { endRecord(); line++; }
      else if (character === '"') {
        if (closed || field.trim()) fail('第' + line + '行引号位置不正确');
        field = ''; quoted = true;
      } else {
        if (closed && !/\s/.test(character)) fail('第' + line + '行引号结束后有多余字符');
        field += character;
      }
    }
    if (quoted) fail('第' + startLine + '行的引号未闭合');
    endField(); result.push({ cells, line: startLine });
    return result;
  }
  function headerKey(text) {
    let base = text.trim(), unit = '';
    const suffix = /^(.*?)[(（\[]\s*([^()（）\[\]]+)\s*[)）\]]$/.exec(base);
    if (suffix) { base = suffix[1].trim(); unit = suffix[2].trim(); }
    base = base.toLowerCase();
    const laserAliases = ['laser_percent', '激光器设定', '激光器设定%', '激光器端', '激光器端%', '激光器', '激光器%', '激光器功率', '激光器功率%', '功率百分比'];
    const arrayAliases = ['array_percent', '阵列', '阵列%', '阵列百分比'];
    if (laserAliases.includes(base) || arrayAliases.includes(base)) {
      if (unit && unit !== '%') fail('百分比表头单位仅支持%，不支持' + unit);
      return laserAliases.includes(base) ? 'laser_percent' : 'array_percent';
    }
    if (['power_percent', '功率%'].includes(base)) {
      if (unit && unit !== '%') fail('百分比表头单位仅支持%，不支持' + unit);
      return 'power_percent';
    }
    const index = ALIASES.findIndex(function (aliases) { return aliases.includes(base); });
    if (index < 0) return null;
    if (index === 0) {
      if (base === 'power_w' && unit && unit !== 'W') fail('功率录入单位仅支持W，不支持' + unit);
      if (unit && !['W', '%'].includes(unit)) fail('功率单位仅支持W或%，不支持' + unit);
      return base === 'power_w' || unit === 'W' ? 'power_w' : unit === '%' ? 'power_percent' : 'power';
    }
    if (unit) {
      if(index===3&&((base==='spacing_mm'&&unit!=='mm')||(base==='spacing_um'&&!['um','µm','μm'].includes(unit))))fail('线间距表头单位冲突，请核对mm和μm');
      const expected = index === 3 ? ['um', 'µm', 'μm', 'mm'] : [UNITS[index]];
      if (!expected.includes(unit)) fail(LABELS[index] + '单位仅支持' + UNITS[index] + '，不支持' + unit);
    }
    return KEYS[index];
  }
  function parseTable(text, options) {
    if (typeof text !== 'string' || !text.trim()) fail('请粘贴四列参数表');
    if (text.length > 1000000) fail('参数表过长');
    const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    const parsed = records(source, delimiter(source));
    const settings = powerSettings(options);
    if (![4, 5].includes(parsed[0].cells.length)) fail('第1行必须有4列，或包含激光器%和阵列%的明确5列表头');
    const firstHeader = parsed[0].cells.map(headerKey);
    const fiveColumns = parsed[0].cells.length === 5;
    let data = parsed;
    if (fiveColumns) {
      if (settings.powerMode !== 'percent') fail('5列百分比计划须先选择激光器%或阵列%录入方式');
      if (firstHeader.join('|') !== 'laser_percent|array_percent|speed|frequency|spacing') fail('5列表头须依次为 laser_percent,array_percent,speed_mm_s,frequency_khz,spacing_um');
      data = parsed.slice(1);
    } else if (firstHeader.some(function (key) { return key !== null; })) {
      const allowedPower = settings.powerMode === 'watts' ? ['power', 'power_w'] : ['power', 'power_percent', settings.inputPower === 'array' ? 'array_percent' : 'laser_percent'];
      if (!allowedPower.includes(firstHeader[0])) fail('功率表头与当前录入口径不一致，不支持换序；请核对W、激光器%或阵列%');
      if (firstHeader.slice(1).join('|') !== 'speed|frequency|spacing') fail('表头须依次为功率、扫描速度(mm/s)、重频(kHz)、线间距(um)，不支持换序或未知列名/单位');
      data = parsed.slice(1);
    }
    if (!data.length) fail('表头下至少需要1行参数');
    const spacingHeader=data!==parsed?parsed[0].cells[parsed[0].cells.length-1].trim():'';
    const explicitMM=/spacing_mm|[(（\[]\s*mm\s*[)）\]]/i.test(spacingHeader);
    const explicitUM=/spacing_um|[(（\[]\s*[uµμ]m\s*[)）\]]/i.test(spacingHeader);
    const spacingScale=explicitMM||(!explicitUM&&options?.spacingUnit==='mm')?1000:1;
    if (data.length > 1000) fail('参数表最多1000行；当前为' + data.length + '行');
    return data.map(function (record) {
      const expectedColumns = fiveColumns ? 5 : 4;
      if (record.cells.length !== expectedColumns) fail('第' + record.line + '行必须有' + expectedColumns + '列，当前为' + record.cells.length + '列');
      if (fiveColumns) return normalizedRow({
        powerMode: 'percent', power: number(record.cells[0], '第' + record.line + '行激光器%'), arrayPercent: number(record.cells[1], '第' + record.line + '行阵列%'),
        speed: number(record.cells[2], '第' + record.line + '行扫描速度(mm/s)'), frequency: number(record.cells[3], '第' + record.line + '行重频(kHz)'), spacing: number(record.cells[4], '第' + record.line + '行线间距')*spacingScale
      }, '第' + record.line + '行');
      const row = {};
      KEYS.forEach(function (key, index) {
        const label = index === 0 && settings.powerMode === 'percent' ? (settings.inputPower === 'array' ? '阵列(%)' : '激光器设定(%)') : LABELS[index] + '(' + UNITS[index] + ')';
        row[key] = number(record.cells[index], '第' + record.line + '行' + label)*(key==='spacing'?spacingScale:1);
      });
      return Object.assign(row, powerRow(row.power, settings));
    });
  }

  function normalizedRow(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + '格式不正确');
    const row = {};
    KEYS.forEach(function (key, index) { row[key] = number(value[key], label + LABELS[index]); });
    row.powerMode = value.powerMode === undefined ? 'watts' : value.powerMode;
    if (!['percent', 'watts'].includes(row.powerMode)) fail(label + '功率口径无效');
    if (row.powerMode === 'percent') {
      row.power = percent(row.power, label + '激光器设定百分比');
      row.arrayPercent = percent(value.arrayPercent === undefined ? 100 : value.arrayPercent, label + '阵列百分比');
    } else {
      if (value.arrayPercent !== undefined && value.arrayPercent !== null) fail(label + 'W录入模式不能附带阵列百分比');
      row.arrayPercent = null;
    }
    return row;
  }
  function key(row) { return [row.powerMode, row.arrayPercent].concat(KEYS.map(function (field) { return String(row[field]); })).join('|'); }
  function plan(rows, existingGroups, options) {
    if (!Array.isArray(rows) || !rows.length || rows.length > 1000) fail('每批须有1—1000行参数');
    if (!Array.isArray(existingGroups) || existingGroups.length > 1000) fail('现有参数组格式或数量不正确');
    options = options || {};
    if (options.allowDuplicates !== undefined && typeof options.allowDuplicates !== 'boolean') fail('允许重复选项必须为布尔值');
    const allowDuplicates = options.allowDuplicates === true;
    const existing = new Set();
    if (!allowDuplicates) existingGroups.forEach(function (group, index) {
      if (group && group.isDemo === false && !group.deletedAt && (options.lensKey===undefined||JSON.stringify(group.lens||null)===options.lensKey)) existing.add(key(normalizedRow(group, '已有正式组第' + (index + 1) + '组')));
    });
    const retained = [], seen = new Set();
    let skippedInput = 0, skippedExisting = 0;
    Array.from(rows, function (row, index) { return normalizedRow(row, '第' + (index + 1) + '行'); }).forEach(function (row) {
      const identity = key(row);
      if (!allowDuplicates && seen.has(identity)) { skippedInput++; return; }
      seen.add(identity);
      if (!allowDuplicates && existing.has(identity)) { skippedExisting++; return; }
      retained.push(row);
    });
    const capacity = 1000 - existingGroups.length;
    if (retained.length > capacity) fail('计划新增' + retained.length + '组，当前仅剩' + capacity + '组容量；本批未创建，请缩小批次');
    const e=options.measurements?.electricalCount??5,m=options.measurements?.characterizationCount??2;
    if(!Number.isInteger(e)||e<1||e>12||!Number.isInteger(m)||m<0||m>12)fail('样品配置不正确');
    return {
      rows: retained, inputCount: rows.length, skippedInput, skippedExisting,
      groupCount: retained.length, sampleCount: retained.length * (e+m),
      electricalCount: retained.length * e, characterizationCount: retained.length * m
    };
  }

  root.LIGBatchCore = Object.freeze({ parseLevels, fromLevels, parseTable, plan });
})(globalThis);
