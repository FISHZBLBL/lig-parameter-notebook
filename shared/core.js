(function (root) {
  'use strict';

  const ELECTRICAL_STATUSES = ['normal', 'open', 'overrange', 'failed'];
  const CHARACTERIZATION_STATUSES = ['pending', 'reserved', 'raman', 'sem', 'done'];
  const MEASUREMENT_MODES = ['same_contact', 'recontact', 'spatial'];
  const DECIMAL = /^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  const PARAMS = ['power', 'speed', 'frequency', 'spacing'];
  const STATUS_LABELS = {
    normal: '正常', open: '断路', overrange: '超量程', failed: '加工失败',
    pending: '待安排', reserved: '备用', raman: 'Raman', sem: 'SEM', done: '已完成'
  };

  function fail(message) { throw new Error(message); }
  function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + '格式不正确');
    return value;
  }
  function string(value, label, maximum, optional) {
    if (value === undefined && optional) return '';
    if (typeof value !== 'string') fail(label + '必须是文本');
    if (value.length > maximum) fail(label + '过长（最多' + maximum + '字）');
    return value.trim();
  }
  function positive(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text || text.length > 64 || !DECIMAL.test(text)) return null;
    const number = Number(text);
    return Number.isFinite(number) && number > 0 ? number : null;
  }
  function localDate() {
    const now = new Date();
    return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  }
  function date(value) {
    const text = string(value, '日期', 10, false);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) fail('日期须采用 YYYY-MM-DD 格式');
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const parsed = new Date(0);
    parsed.setUTCFullYear(year, month - 1, day);
    if (year < 1900 || year > 9999 || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) fail('日期不存在');
    return text;
  }

  function deletionTime(value, label) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') fail(label + '删除时间须为空或合法ISO日期时间');
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
    if (!match) fail(label + '删除时间须为空或合法ISO日期时间（含时区）');
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const parsed = new Date(0);
    parsed.setUTCFullYear(year, month - 1, day);
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day
      || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59
      || (match[8] && (Number(match[9]) > 23 || Number(match[10]) > 59))
      || !Number.isFinite(Date.parse(value))) fail(label + '删除时间不是合法ISO日期时间');
    return value;
  }

  function validatePlan(value, label) {
    const plan = object(value, label + '测量计划');
    if (!MEASUREMENT_MODES.includes(plan.mode)) fail(label + '测量模式无效');
    if (!Number.isInteger(plan.readingsPerSample) || plan.readingsPerSample < 1 || plan.readingsPerSample > 12) fail(label + '每片读数次数必须为1—12的整数');
    return {
      mode: plan.mode,
      readingsPerSample: plan.readingsPerSample,
      positionDescription: string(plan.positionDescription, label + '测量位置说明', 1000, false)
    };
  }

  function validateGroup(value, index, version) {
    const group = object(value, '第' + (index + 1) + '个参数组');
    const id = recordId(group.id);
    const name = string(group.name === null ? '' : group.name, id + '名称', 120, true);
    const normalized = { id, name, date: date(group.date) };
    PARAMS.forEach(function (key) {
      const number = positive(group[key]);
      if (number === null) fail(id + '的加工参数必须为有限正数');
      normalized[key] = number;
    });
    normalized.powerMode = version < 3 ? 'watts' : group.powerMode;
    if (!['percent', 'watts'].includes(normalized.powerMode)) fail(id + '功率口径须为 percent 或 watts');
    if (normalized.powerMode === 'percent') {
      if (normalized.power > 100) fail(id + '激光器设定百分比须大于0且不超过100');
      const arrayPercent = group.arrayPercent === undefined ? 100 : positive(group.arrayPercent);
      if (arrayPercent === null || arrayPercent > 100) fail(id + '阵列百分比须大于0且不超过100');
      normalized.arrayPercent = arrayPercent;
    } else {
      if (version === 3 && group.arrayPercent !== undefined && group.arrayPercent !== null) fail(id + '瓦数录入模式的阵列百分比应为空');
      normalized.arrayPercent = null;
    }
    const measured = version < 3 ? null : group.measuredPowerW;
    normalized.measuredPowerW = measured === undefined || measured === null || measured === '' ? null : positive(measured);
    if (normalized.measuredPowerW === null && measured !== undefined && measured !== null && measured !== '') fail(id + '实测功率须为空或有限正数');
    const legacyPower = group.legacyPowerW;
    normalized.legacyPowerW = legacyPower === undefined || legacyPower === null ? null : positive(legacyPower);
    if (normalized.legacyPowerW === null && legacyPower !== undefined && legacyPower !== null) fail(id + '旧功率录入须为空或有限正数（W）');
    normalized.calibrationId = version < 3 ? '' : string(group.calibrationId, id + '功率校准记录', 120, true);
    normalized.parentSheet = string(group.parentSheet, id + '母片编号', 120, true);
    normalized.notes = string(group.notes, id + '备注', 3000, true);
    if (typeof group.isDemo !== 'boolean') fail(id + '缺少演示数据标识');
    normalized.isDemo = group.isDemo;
    normalized.deletedAt = deletionTime(group.deletedAt, id);
    normalized.lens = group.lens === undefined || group.lens === null ? null : validateLens(group.lens);
    if (group.qc !== undefined && group.qc !== null) normalized.qc = validateQC(group.qc);
    if (group.qcLink !== undefined && group.qcLink !== null) normalized.qcLink = validateQCLink(group.qcLink);
    normalized.measurementPlan = version === 1
      ? { mode: 'same_contact', readingsPerSample: 3, positionDescription: '' }
      : validatePlan(group.measurementPlan, id);
    if(group.measurementLayout!==undefined){if(group.measurementLayout!=='sample-repeats-v4')fail('未知测量布局');normalized.measurementLayout=group.measurementLayout;}
    if (!Array.isArray(group.electrical) || group.electrical.length < 1 || group.electrical.length > 12) fail(id + '电学样品数必须为1—12');
    normalized.electrical = group.electrical.map(function (value, sampleIndex) {
      const sample = object(value, id + '电学样品');
      const expectedId = 'E' + String(sampleIndex + 1).padStart(2, '0');
      if (sample.id !== expectedId) fail(id + '电学样品编号须从 E01 依次排列');
      if (!ELECTRICAL_STATUSES.includes(sample.status)) fail(id + '-' + expectedId + '状态无效');
      if (!Array.isArray(sample.values) || sample.values.length !== normalized.measurementPlan.readingsPerSample) fail(id + '-' + expectedId + '必须保留测量计划规定的' + normalized.measurementPlan.readingsPerSample + '个读数位置');
      const values = Array.from(sample.values, function (reading) {
        if (reading === '') return '';
        if (typeof reading === 'string' && !reading.trim()) return '';
        if (positive(reading) === null) fail(id + '-' + expectedId + '读数必须为空或有限正数');
        return String(reading).trim();
      });
      return { id: expectedId, values, status: sample.status, note: string(sample.note, id + '-' + expectedId + '备注', 1500, true) };
    });
    if (!Array.isArray(group.characterization) || group.characterization.length > 12) fail(id + '表征/备用样品数必须为0—12');
    normalized.characterization = group.characterization.map(function (value, sampleIndex) {
      const sample = object(value, id + '表征样品');
      const expectedId = 'M' + String(sampleIndex + 1).padStart(2, '0');
      if (sample.id !== expectedId) fail(id + '表征样品编号须从 M01 依次排列');
      if (!CHARACTERIZATION_STATUSES.includes(sample.status)) fail(id + '-' + expectedId + '状态无效');
      return { id: expectedId, status: sample.status, note: string(sample.note, id + '-' + expectedId + '备注', 1500, true) };
    });
    if (group.measurementArchive !== undefined) {
      const archive = object(group.measurementArchive, id + '转换前测量备份');
      if (archive.kind !== 'five-readings-one-sample-v1') fail('未知测量转换类型');
      const convertedAt = deletionTime(archive.convertedAt, id + '转换');
      if (!convertedAt) fail('测量转换缺少时间');
      const snapshot = validateGroup({ ...group, measurementPlan: archive.measurementPlan, electrical: archive.electrical, characterization: archive.characterization, measurementArchive: undefined }, index, 3);
      normalized.measurementArchive = { kind: archive.kind, convertedAt, measurementPlan: snapshot.measurementPlan, electrical: snapshot.electrical, characterization: snapshot.characterization };
    }
    return normalized;
  }

  function validateState(value) {
    const state = object(value, '记录文件');
    if (![1, 2, 3].includes(state.version)) fail('不支持此记录文件的版本');
    if (!Array.isArray(state.groups) || state.groups.length > 1000) fail('参数组必须为数组且不能超过1000组');
    const groups = state.groups.map(function (group, index) { return validateGroup(group, index, state.version); });
    const ids = new Set();
    groups.forEach(function (group) {
      if (ids.has(group.id.toLocaleLowerCase())) fail('参数组编号重复：' + group.id + '；未导入，已有记录未被覆盖');
      ids.add(group.id.toLocaleLowerCase());
    });
    const selectedId = string(state.selectedId, '当前参数组编号', 40, false);
    if (groups.length ? !groups.some(g=>g.id===selectedId) : selectedId !== '') fail('当前参数组编号不存在');
    const lenses=state.lenses===undefined?[]:state.lenses;
    if(!Array.isArray(lenses)||lenses.length>100)fail('镜头库最多保存100个镜头');
    const normalizedLenses=lenses.map(validateLens), lensIds=new Set();
    normalizedLenses.forEach(lens=>{if(lensIds.has(lens.id))fail('镜头编号重复');lensIds.add(lens.id);});
    const references=state.qcReferences===undefined?[]:state.qcReferences;
    if(!Array.isArray(references)||references.length>100)fail('QC参考库最多保存100条参考');
    const qcReferences=references.map(validateQCReference),referenceIds=new Set(),runIds=new Set();
    qcReferences.forEach(ref=>{if(referenceIds.has(ref.id))fail('QC参考编号重复');referenceIds.add(ref.id);});
    groups.forEach(group=>{if(group.qc){if(!referenceIds.has(group.qc.referenceId))fail('QC参考资料缺失：'+group.qc.referenceId);if(group.qc.kind==='run'){if(runIds.has(group.qc.uid))fail('QC记录身份重复');runIds.add(group.qc.uid);}}});
    return { version: 3, groups, selectedId, lenses:normalizedLenses, qcReferences };
  }

  function recordId(value) {
    const id=string(value,'记录编号',40,false);
    if(!/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,39}$/u.test(id))fail('编号须为1—40字，可用文字、数字、点、短横线和下划线');
    return id;
  }
  function validateLens(value) {
    const lens=object(value,'镜头资料');
    const id=string(lens.id,'镜头编号',40,false);
    if(!/^[A-Za-z0-9_-]{1,40}$/.test(id))fail('镜头编号格式不正确');
    const name=string(lens.name,'镜头名称/型号',100,false);if(!name)fail('请填写镜头名称/型号');
    const result={id,name};
    for(const key of ['focalLengthMM','spotDiameterUM','magnification','numericalAperture']){
      const raw=lens[key];result[key]=raw===undefined||raw===null||raw===''?null:positive(raw);
      if(result[key]===null&&raw!==undefined&&raw!==null&&raw!=='')fail('焦距与光斑直径须为空或有限正数');
    }
    if(lens.archived!==undefined&&typeof lens.archived!=='boolean')fail('镜头停用标记不正确');
    result.notes=string(lens.notes,'镜头备注',1500,true);result.archived=lens.archived===true;
    return result;
  }

  function createGroup(fields, existingGroups) {
    object(fields, '参数');
    if (!Array.isArray(existingGroups)) fail('已有参数组格式不正确');
    if (existingGroups.length >= 1000) fail('最多支持1000个参数组，请先导出备份');
    const maximumId = existingGroups.reduce(function (maximum, group) {
      const match = /^C(\d+)$/i.exec(group.id || '');
      return match&&Number.isSafeInteger(Number(match[1])) ? Math.max(maximum, Number(match[1])) : maximum;
    }, 0);
    const id = fields.id===undefined||String(fields.id).trim()===''?'C' + String(maximumId + 1).padStart(3, '0'):recordId(fields.id);
    if(existingGroups.some(group=>group.id.toLocaleLowerCase()===id.toLocaleLowerCase()))fail('编号已存在（含回收站）：'+id);
    const requestedCount = fields.readingsPerSample;
    const count = requestedCount === undefined ? 1
      : typeof requestedCount === 'number' ? requestedCount
      : typeof requestedCount === 'string' && /^\d+$/.test(requestedCount.trim()) ? Number(requestedCount) : NaN;
    const measurementPlan = validatePlan({
      mode: fields.mode === undefined ? 'same_contact' : fields.mode,
      readingsPerSample: count,
      positionDescription: fields.positionDescription === undefined ? '' : fields.positionDescription
    }, id);
    const electricalCount = countSetting(fields.electricalCount, 5, 1);
    const characterizationCount = countSetting(fields.characterizationCount, 2, 0);
    const group = {
      id,
      name: fields.name === undefined || fields.name === null ? '' : fields.name,
      date: fields.date || localDate(),
      power: fields.power, speed: fields.speed, frequency: fields.frequency, spacing: fields.spacing,
      powerMode: fields.powerMode === undefined ? 'watts' : fields.powerMode,
      arrayPercent: fields.powerMode === 'percent' ? (fields.arrayPercent === undefined || fields.arrayPercent === '' ? 100 : fields.arrayPercent) : null,
      measuredPowerW: fields.measuredPowerW === undefined ? null : fields.measuredPowerW,
      legacyPowerW: fields.legacyPowerW === undefined ? null : fields.legacyPowerW,
      calibrationId: fields.calibrationId === undefined ? '' : fields.calibrationId,
      parentSheet: fields.parentSheet || '', notes: fields.notes || '', isDemo: false, deletedAt: null,
      lens:fields.lens===undefined?null:fields.lens,
      measurementPlan,
      electrical: Array.from({ length: electricalCount }, function (_, index) {
        return { id: 'E' + String(index + 1).padStart(2, '0'), values: Array(measurementPlan.readingsPerSample).fill(''), status: 'normal', note: '' };
      }),
      characterization: Array.from({length:characterizationCount}, function (_, index) { return { id:'M'+String(index+1).padStart(2,'0'), status:'pending', note:'' }; })
    };
    if(fields.measurementLayout!==undefined)group.measurementLayout=fields.measurementLayout;
    if(fields.qc!==undefined)group.qc=fields.qc;
    if(fields.qcLink!==undefined)group.qcLink=fields.qcLink;
    return validateGroup(group, existingGroups.length, 3);
  }

  function countSetting(raw, fallback, minimum) {
    const value = raw === undefined ? fallback : typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
    if (!Number.isInteger(value) || value < minimum || value > 12) fail('样品数必须为'+minimum+'—12的整数');
    return value;
  }

  function resizeMeasurements(group, fields) {
    const next = validateGroup(group, 0, 3);
    const e = countSetting(fields.electricalCount, next.electrical.length, 1), m = countSetting(fields.characterizationCount, next.characterization.length, 0);
    const r = countSetting(fields.readingsPerSample, next.measurementPlan.readingsPerSample, 1);
    if (next.electrical.slice(e).some(s=>s.status!=='normal'||s.note||s.values.some(Boolean)) || next.characterization.slice(m).some(s=>s.status!=='pending'||s.note)) fail('减少样品数会移除已有读数、状态或备注，请先保留原记录');
    if (next.electrical.slice(0,e).some(s=>s.values.slice(r).some(Boolean))) fail('减少测量次数会移除已有读数，请先保留原记录');
    next.electrical = Array.from({length:e},(_,i)=>{
      const old=next.electrical[i];
      return old ? {...old,values:Array.from({length:r},(_,j)=>old.values[j]??'')} : {id:'E'+String(i+1).padStart(2,'0'),values:Array(r).fill(''),status:'normal',note:''};
    });
    next.characterization = Array.from({length:m},(_,i)=>next.characterization[i]||{id:'M'+String(i+1).padStart(2,'0'),status:'pending',note:''});
    next.measurementPlan.readingsPerSample=r;
    return validateGroup(next,0,3);
  }

  function canConvertLegacy(group) {
    return !group.isDemo && !group.deletedAt && !group.measurementArchive && !group.measurementLayout && group.electrical.length===5 && group.measurementPlan.readingsPerSample===1 && group.electrical.every(s=>s.status==='normal'&&s.values.length===1);
  }
  function convertLegacyReadings(group, convertedAt) {
    if (!canConvertLegacy(group)) fail('此记录不是可直接转换的旧版五格读数；含异常状态的记录须先核对');
    const next=validateGroup(group,0,3);
    next.measurementArchive={kind:'five-readings-one-sample-v1',convertedAt:convertedAt||new Date().toISOString(),measurementPlan:next.measurementPlan,electrical:next.electrical,characterization:next.characterization};
    const values=next.electrical.map(s=>s.values[0]);
    const note=next.electrical.filter(s=>s.note).map((s,i)=>s.id+'：'+s.note).join('\n');
    // The exact former notes/statuses remain in the archive even if the merged note is long.
    next.electrical=Array.from({length:3},(_,i)=>({id:'E'+String(i+1).padStart(2,'0'),values:i===0?values:Array(5).fill(''),status:'normal',note:i===0?note.slice(0,1500):''}));
    next.measurementPlan={...next.measurementPlan,readingsPerSample:5};
    next.measurementLayout='sample-repeats-v4';
    // Retain any historically annotated characterization samples; only empty extras collapse.
    const last=next.characterization.reduce((n,s,i)=>s.note||s.status!=='pending'?i+1:n,1);
    next.characterization=next.characterization.slice(0,last);
    return validateGroup(next,0,3);
  }

  function sampleMean(sample) {
    if (!sample || sample.status !== 'normal' || !Array.isArray(sample.values) || sample.values.length === 0) return null;
    const values = Array.from(sample.values, positive);
    if (values.some(function (value) { return value === null; })) return null;
    const scale = Math.max.apply(null, values);
    return scale * (values.reduce(function (sum, value) { return sum + value / scale; }, 0) / values.length);
  }

  function groupStats(group) {
    const means = group.electrical.map(function (sample) { return { id: sample.id, mean: sampleMean(sample) }; })
      .filter(function (sample) { return sample.mean !== null; });
    const n = means.length;
    if (!n) return { n: 0, mean: null, sd: null, cv: null, min: null, max: null, means };
    const values = means.map(function (sample) { return sample.mean; });
    const max = Math.max.apply(null, values), min = Math.min.apply(null, values);
    const scaledMean = values.reduce(function (sum, value) { return sum + value / max; }, 0) / n;
    const mean = max * scaledMean;
    const scaledSd = n > 1 ? Math.sqrt(values.reduce(function (sum, value) { return sum + Math.pow(value / max - scaledMean, 2); }, 0) / (n - 1)) : null;
    return { n, mean, sd: n > 1 ? max * scaledSd : null, cv: n > 1 ? scaledSd / scaledMean * 100 : null, min, max, means };
  }

  function groupProgress(group) {
    const valid = group.electrical.filter(function (sample) { return sampleMean(sample) !== null; }).length;
    const resolved = group.electrical.filter(function (sample) {
      return ['open', 'overrange', 'failed'].includes(sample.status) || sampleMean(sample) !== null;
    }).length;
    return { resolved, valid, total: group.electrical.length, complete: resolved === group.electrical.length };
  }

  function csvCell(value, numeric) {
    let text = value === null || value === undefined ? '' : String(value);
    // Text cells that spreadsheet software could interpret as formulas are escaped.
    if (!numeric && /^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function exportCSV(state) {
    const header = ['condition_id', 'condition_name', 'date', 'power_w', 'speed_mm_s', 'frequency_khz', 'spacing_um', 'parent_sheet', 'is_demo', 'group_notes', 'sample_id', 'sample_role', 'status', 'status_label', 'reading_index', 'sheet_resistance_ohm_sq_raw', 'sample_mean_ohm_sq', 'sample_notes', 'valid_sample_n', 'group_mean_ohm_sq', 'sample_sd_ohm_sq', 'cv_percent', 'measurement_mode', 'readings_per_sample', 'measurement_position_description', 'power_mode', 'power_setting', 'laser_percent', 'array_percent', 'measured_power_w', 'calibration_id', 'legacy_power_w'];
    const rows = [header.map(function (cell) { return csvCell(cell, false); }).join(',')];
    state.groups.forEach(function (group) {
      if (group.deletedAt !== undefined && group.deletedAt !== null) return;
      const stats = groupStats(group);
      const plan = group.measurementPlan || { mode: 'same_contact', readingsPerSample: 3, positionDescription: '' };
      const powerMode = group.powerMode || 'watts';
      const common = [group.id, group.name, group.date, powerMode === 'watts' ? group.power : null, group.speed, group.frequency, group.spacing, group.parentSheet, group.isDemo ? 'true' : 'false', group.notes];
      function add(sample, role, readingIndex, rawReading) {
        const mean = role === 'electrical' ? sampleMean(sample) : null;
        const row = common.concat([group.id + '-' + sample.id, role, sample.status, STATUS_LABELS[sample.status] || sample.status, readingIndex, rawReading, mean, sample.note, stats.n, stats.mean, stats.sd, stats.cv, plan.mode, plan.readingsPerSample, plan.positionDescription, powerMode, group.power, powerMode === 'percent' ? group.power : null, group.arrayPercent, group.measuredPowerW, group.calibrationId, group.legacyPowerW]);
        const numericColumns = new Set([3, 4, 5, 6, 14, 16, 18, 19, 20, 21, 23, 26, 27, 28, 29, 31]);
        rows.push(row.map(function (value, index) { return csvCell(value, numericColumns.has(index)); }).join(','));
      }
      group.electrical.forEach(function (sample) {
        const present = sample.values.map(function (value, index) { return { value, index }; })
          .filter(function (reading) { return reading.value !== '' && String(reading.value).trim() !== ''; });
        if (!present.length) add(sample, 'electrical', '', '');
        else present.forEach(function (reading) { add(sample, 'electrical', reading.index + 1, reading.value); });
      });
      group.characterization.forEach(function (sample) { add(sample, 'characterization', '', ''); });
    });
    return '\uFEFF' + rows.join('\r\n') + '\r\n';
  }

  function exportWideCSV(state) {
    function derived(value) { return value === null ? null : Number(value.toPrecision(12)); }
    const count=Math.max(5,...state.groups.map(g=>g.electrical.length)), ids=Array.from({length:count},(_,i)=>'E'+String(i+1).padStart(2,'0'));
    const header = ['编号', '日期', '功率口径', '激光器设定(%)', '阵列(%)', '功率录入(W)', '实测功率(W)', '扫描速度(mm/s)', '重频(kHz)', '线间距(μm)'].concat(ids.map(id=>id+'方阻(Ω/□)'),['有效n','平均方阻(Ω/□)','标准差SD(Ω/□)'],ids.map(id=>id+'状态'),['母片','备注','is_demo','功率校准记录','旧功率录入(W)']);
    const numeric = new Set([3,4,5,6,7,8,9,...Array.from({length:count+3},(_,i)=>10+i),header.length-1]);
    const rows = [header.map(function (cell) { return csvCell(cell, false); }).join(',')];
    state.groups.forEach(function (group) {
      if (group.deletedAt !== undefined && group.deletedAt !== null) return;
      const stats = groupStats(group), mode = group.powerMode || 'watts';
      const representatives = Array.from({length:count},function (_,i) {
        const sample=group.electrical[i];if(!sample)return null;
        const mean = sampleMean(sample);
        if (mean === null) return null;
        return sample.values.length === 1 ? sample.values[0] : derived(mean);
      });
      const statuses = Array.from({length:count},function (_,i) { const sample=group.electrical[i];return !sample?'':sample.status==='normal'&&representatives[i]===null?'待测':STATUS_LABELS[sample.status]; });
      const row = [group.id, group.date, mode === 'percent' ? '百分比设定' : 'W录入', mode === 'percent' ? group.power : null, mode === 'percent' ? group.arrayPercent : null, mode === 'watts' ? group.power : null, group.measuredPowerW, group.speed, group.frequency, group.spacing]
        .concat(representatives, [stats.n, derived(stats.mean), derived(stats.sd)], statuses, [group.parentSheet, group.notes, group.isDemo ? 'true' : 'false', group.calibrationId, group.legacyPowerW]);
      rows.push(row.map(function (cell, index) { return csvCell(cell, numeric.has(index)); }).join(','));
    });
    return '\uFEFF' + rows.join('\r\n') + '\r\n';
  }

  function exportMeanCSV(state, options) {
    object(state, '导出记录');
    if (!Array.isArray(state.groups)) fail('导出记录必须包含参数行数组');
    options = options === undefined ? {} : object(options, '导出选项');
    if (options.includeDemo !== undefined && typeof options.includeDemo !== 'boolean') fail('是否包含演示数据必须为布尔值');
    if(options.includeOutcome!==undefined&&typeof options.includeOutcome!=='boolean')fail('是否包含异常结果必须为布尔值');
    const selected = state.groups.filter(function (group) {
      return (group.deletedAt === undefined || group.deletedAt === null) && (options.includeDemo === true || group.isDemo !== true) && (options.includeQC === true || group.qc?.kind !== 'run');
    })
      .map(function (group) { return { group, mean: groupStats(group).mean }; })
      .filter(function (entry) { return options.includeOutcome===true || Number.isFinite(entry.mean); });
    if (!selected.length) fail('没有可导出的有效平均方阻；未测记录和演示数据默认不导出');
    const modes = new Set(selected.map(function (entry) { return entry.group.powerMode || 'watts'; }));
    if (Array.from(modes).some(function (mode) { return !['percent', 'watts'].includes(mode); })) fail('存在未知功率口径，请先核对记录');
    if (modes.size > 1) fail('功率口径混合，请分别选择百分比或W录入记录后分开导出');
    const mode = selected[0].group.powerMode || 'watts';
    const spacingMM=options.spacingUnit==='mm';
    const hasLens=options.includeLens===true&&selected.some(entry=>entry.group.lens);
    const header = mode === 'percent'
      ? ['编号', '激光器设定(%)', '阵列(%)', '实测功率(mW)', '扫描速度(mm/s)', '重频(kHz)', '线间距(μm)', '平均方阻(Ω/□)']
      : ['编号', '功率录入(W)', '扫描速度(mm/s)', '重频(kHz)', '线间距(μm)', '平均方阻(Ω/□)'];
    if(spacingMM)header[header.length-2]='线间距(mm)';
    if(hasLens)header.splice(header.length-1,0,'镜头','倍率(X)','数值孔径(NA)','实际焦距(mm)','实测光斑直径(μm)');
    const outcomeCount=options.includeOutcome===true?Math.max(...selected.map(entry=>entry.group.electrical.length)):0;
    if(outcomeCount){header.push('记录结果','实验备注');for(let i=0;i<outcomeCount;i++)header.push('样品'+(i+1)+'状态','样品'+(i+1)+'备注');}
    const rows = [header.map(function (cell) { return csvCell(cell, false); }).join(',')];
    selected.forEach(function (entry) {
      const group = entry.group;
      const parameters = [group.power, group.speed, group.frequency, group.spacing].map(positive);
      if (parameters.some(function (value) { return value === null; })) fail('导出记录中存在无效加工参数，请先核对');
      if(spacingMM)parameters[3]=Number((parameters[3]/1000).toPrecision(12));
      if (mode === 'percent') {
        const array = positive(group.arrayPercent);
        if (parameters[0] > 100 || array === null || array > 100) fail('导出百分比须大于0且不超过100');
        const measured = group.measuredPowerW;
        const watts = measured === undefined || measured === null || measured === '' ? null : positive(measured);
        if (watts === null && measured !== undefined && measured !== null && measured !== '') fail('导出记录中实测功率须为空或有限正数');
        const milliwatts = watts === null ? null : watts * 1000;
        if (milliwatts !== null && !Number.isFinite(milliwatts)) fail('实测功率换算为mW后超出有限数值范围');
        parameters.splice(1, 0, array, milliwatts === null ? null : Number(milliwatts.toPrecision(12)));
      }
      parameters.push(Number.isFinite(entry.mean)?Number(entry.mean.toPrecision(12)):null);
      const cells=parameters.map(cell=>csvCell(cell,true));
      if(hasLens){const lens=group.lens;cells.splice(cells.length-1,0,csvCell(lens?.name||'',false),csvCell(lens?.magnification,true),csvCell(lens?.numericalAperture,true),csvCell(lens?.focalLengthMM,true),csvCell(lens?.spotDiameterUM,true));}
      if(outcomeCount){
        const stats=groupStats(group),abnormal=group.electrical.some(s=>s.status!=='normal');
        cells.push(csvCell(stats.n===group.electrical.length?'全部测齐':stats.n?'部分测齐':abnormal?'异常/无有效均值':'待测/录入中',false),csvCell(group.notes,false));
        for(let i=0;i<outcomeCount;i++){const sample=group.electrical[i];const status=!sample?'':sample.status!=='normal'?STATUS_LABELS[sample.status]:sampleMean(sample)!==null?'测齐':sample.values.some(Boolean)?'待录完':'待测';cells.push(csvCell(status,false),csvCell(sample?.note||'',false));}
      }
      rows.push([csvCell(group.id, false)].concat(cells).join(','));
    });
    return '\uFEFF' + rows.join('\r\n') + '\r\n';
  }

  function demoState() {
    const groups = [];
    function demo(fields, targetMeans) {
      const group = createGroup(Object.assign({ date: '2026-10-27', parentSheet: 'PI-DEMO-01', notes: '仅用于界面演示；参数和读数均为虚构示例，不是推荐配方或实验结果。' }, fields), groups);
      group.isDemo = true;
      targetMeans.forEach(function (mean, index) { group.electrical[index].values = [String(mean)]; });
      groups.push(group);
      return group;
    }
    const first = demo({ name: '基准条件', power: 1.5, speed: 100, frequency: 100, spacing: 25 }, [117, 120, 124]);
    first.notes += '每个读数代表一个独立LIG样品的方阻。';
    first.characterization[0].status = 'raman';
    first.characterization[0].note = '演示：待做 Raman';
    first.characterization[1].status = 'reserved';
    demo({ name: '线间距探索', power: 1.5, speed: 100, frequency: 100, spacing: 35 }, []);
    const third = demo({ name: '另一加工条件', power: 1.2, speed: 120, frequency: 100, spacing: 25 }, [170, 174, 169, 176, 171]);
    third.characterization[0].status = 'done';
    third.characterization[0].note = '演示：表征完成';
    third.characterization[1].status = 'reserved';
    return validateState({ version: 3, groups, selectedId: first.id });
  }

  function qcReferenceId(value){const id=string(value,'QC参考编号',20,false);if(!/^QC-[1-9]\d{0,8}$/.test(id))fail('QC参考编号格式不正确');return id;}
  function qcUID(value){const id=string(value,'QC记录身份',64,false);if(!/^[A-Za-z0-9_-]{1,64}$/.test(id))fail('QC记录身份格式不正确');return id;}
  function qcTime(value){const time=deletionTime(value,'QC');if(!time)fail('QC记录缺少创建时间');return time;}
  function optionalQCNumber(value){if(value===null||value===undefined)return null;const number=positive(value);if(number===null)fail('QC参考方阻与功率须为空或有限正数');return number;}
  function validateQC(value){
    const qc=object(value,'QC标记'),referenceId=qcReferenceId(qc.referenceId);
    if(qc.kind==='reference')return {kind:'reference',referenceId};
    if(qc.kind!=='run')fail('QC用途无效');
    const baseline=object(qc.baseline,'QC对照资料');
    return {kind:'run',referenceId,uid:qcUID(qc.uid),createdAt:qcTime(qc.createdAt),baseline:{sourceId:recordId(baseline.sourceId),date:date(baseline.date),mean:optionalQCNumber(baseline.mean),measuredPowerW:optionalQCNumber(baseline.measuredPowerW)}};
  }
  function validateQCLink(value){const link=object(value,'关联QC');return {runUid:qcUID(link.runUid),runId:recordId(link.runId),referenceId:qcReferenceId(link.referenceId),date:date(link.date)};}
  function validateQCReference(value){
    const ref=object(value,'QC参考');if(typeof ref.archived!=='boolean')fail('QC参考停用标记无效');
    const raw=object(ref.snapshot,'QC参考原始记录');
    if(raw.qc||raw.qcLink)fail('QC参考快照不应嵌套QC关联');
    return {id:qcReferenceId(ref.id),createdAt:qcTime(ref.createdAt),archived:ref.archived,snapshot:validateGroup(raw,0,3)};
  }
  function isQCOnly(group){return group.qc?.kind==='run';}
  function nextQCReferenceId(references){return 'QC-'+(Math.max(0,...references.map(ref=>Number(ref.id.slice(3))))+1);}
  function addQCReference(value,sourceId,createdAt){
    const state=validateState(value),group=state.groups.find(g=>g.id===sourceId&&!g.deletedAt);
    if(!group||group.isDemo)fail('请从实际实验记录中选择QC参考');
    if(group.qc)fail('此记录已有QC用途，请先取消标记');
    if(state.qcReferences.length>=100)fail('QC参考库已达100条上限');
    const snapshot=JSON.parse(JSON.stringify(group));delete snapshot.qc;delete snapshot.qcLink;
    const ref={id:nextQCReferenceId(state.qcReferences),createdAt:createdAt||new Date().toISOString(),archived:false,snapshot};
    state.qcReferences.push(ref);group.qc={kind:'reference',referenceId:ref.id};
    return validateState(state);
  }
  function qcLinkFor(group){if(!isQCOnly(group))fail('请选择实际加工的QC记录');return {runUid:group.qc.uid,runId:group.id,referenceId:group.qc.referenceId,date:group.date};}
  function latestQC(value,day){return value.groups.filter(g=>!g.deletedAt&&!g.isDemo&&isQCOnly(g)&&g.date===day).sort((a,b)=>Date.parse(b.qc.createdAt)-Date.parse(a.qc.createdAt)||b.id.localeCompare(a.id))[0]||null;}
  function createQCRun(value,referenceId,fields,createdAt){
    const state=validateState(value),ref=state.qcReferences.find(item=>item.id===referenceId&&!item.archived);if(!ref)fail('QC参考已停用或不存在，请重新选择');
    fields=fields||{};const day=date(fields.date||localDate()),prefix=ref.id+'-'+day.replace(/-/g,'')+'-';
    let sequence=1;while(state.groups.some(g=>g.id.toLowerCase()===(prefix+String(sequence).padStart(2,'0')).toLowerCase()))sequence++;
    const snapshot=ref.snapshot;
    const group=createGroup({...snapshot,id:fields.id||prefix+String(sequence).padStart(2,'0'),date:day,name:'',notes:'',parentSheet:'',calibrationId:'',measuredPowerW:fields.measuredPowerW??null,electricalCount:1,characterizationCount:0,readingsPerSample:5,measurementLayout:'sample-repeats-v4',qc:{kind:'run',referenceId:ref.id,uid:root.crypto.randomUUID(),createdAt:createdAt||new Date().toISOString(),baseline:{sourceId:snapshot.id,date:snapshot.date,mean:groupStats(snapshot).mean,measuredPowerW:snapshot.measuredPowerW}}},state.groups);
    state.groups.push(group);state.selectedId=group.id;return validateState(state);
  }
  function unmarkQC(value,id){
    const state=validateState(value),group=state.groups.find(g=>g.id===id);if(!group?.qc)fail('此记录没有QC标记');
    if(group.qc.kind==='reference'){const ref=state.qcReferences.find(r=>r.id===group.qc.referenceId);if(ref)ref.archived=true;}
    delete group.qc;return validateState(state);
  }
  function mergeNotebook(value,addition){
    const state=validateState(value),incoming=validateState(addition),added=[],idMap=new Map(),refMap=new Map(),uidMap=new Map();
    for(const ref of incoming.qcReferences){
      const existing=state.qcReferences.find(r=>r.id===ref.id);
      if(existing&&JSON.stringify(existing.snapshot)===JSON.stringify(ref.snapshot)&&existing.createdAt===ref.createdAt){refMap.set(ref.id,existing.id);continue;}
      const copy=JSON.parse(JSON.stringify(ref));copy.id=existing?nextQCReferenceId(state.qcReferences):ref.id;refMap.set(ref.id,copy.id);state.qcReferences.push(copy);
    }
    for(const original of incoming.groups){
      const all=state.groups.concat(added),duplicate=all.some(g=>g.id.toLocaleLowerCase()===original.id.toLocaleLowerCase());
      const group=createGroup({...original,id:duplicate?'':original.id,electricalCount:original.electrical.length,characterizationCount:original.characterization.length,readingsPerSample:original.measurementPlan.readingsPerSample,mode:original.measurementPlan.mode,positionDescription:original.measurementPlan.positionDescription},all);
      group.electrical=original.electrical;group.characterization=original.characterization;group.isDemo=original.isDemo;group.deletedAt=original.deletedAt;if(original.measurementArchive)group.measurementArchive=original.measurementArchive;
      idMap.set(original.id,group.id);
      if(group.qc){group.qc.referenceId=refMap.get(group.qc.referenceId);if(group.qc.kind==='run'){const old=group.qc.uid;group.qc.uid=root.crypto.randomUUID();uidMap.set(old,group.qc.uid);}}
      added.push(group);
    }
    for(const group of added)if(group.qcLink){group.qcLink={...group.qcLink,runUid:uidMap.get(group.qcLink.runUid)||group.qcLink.runUid,runId:idMap.get(group.qcLink.runId)||group.qcLink.runId,referenceId:refMap.get(group.qcLink.referenceId)||group.qcLink.referenceId};}
    const lenses=state.lenses.concat(incoming.lenses.filter(l=>!state.lenses.some(existing=>existing.id===l.id)));
    return validateState({...state,lenses,groups:state.groups.concat(added),selectedId:added[0]?.id||state.selectedId});
  }
  root.LIGCore = Object.freeze({ demoState, createGroup, sampleMean, groupStats, groupProgress, exportCSV, exportWideCSV, exportMeanCSV, validateState,validateLens,resizeMeasurements,canConvertLegacy,convertLegacyReadings,addQCReference,createQCRun,unmarkQC,latestQC,qcLinkFor,isQCOnly,mergeNotebook });
})(globalThis);
