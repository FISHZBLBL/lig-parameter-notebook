(function () {
  'use strict';
  const C = LIGCore, KEY = 'lig-cloud-notebook-v1', PAGE_SIZE = 50;
  const $ = id => document.getElementById(id);
  const PARAMS = ['power', 'speed', 'frequency', 'spacing'];
  const NUMBER = /^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  const DEFAULT_MEASUREMENTS={electricalCount:3,characterizationCount:1,readingsPerSample:5,measurementLayout:'sample-repeats-v4'};
  const statusLabels = {normal:'正常', open:'断路', overrange:'超量程', failed:'加工失败'};
  const drafts = new Map();
  let cloud=null, cloudReady=false, cloudHasRecords=false, pendingCloud=null;
  let cloudStatus={kind:'loading',dirty:false,revision:null};
  let state, protectUnreadable = false, storageOK = true, editId = null, detailId = null, originalRaw = null, pendingExternal = null;
  let page = 0, activeView = 'records', toastTimer, mapUI;
  let actionId=null, deleteId=null, lastDeletedId=null, editMeasuredDisplay='',editSpacingDisplay='',formLensSnapshot=null,lensUI,lensFilter='';
  const filters = {power:'', speed:'', frequency:'', spacing:''};
  let qcUI,formQCReference=null;
  let detailSampleId=null,detailRecordOrder=[];
  const compactMedia=window.matchMedia('(max-width:700px)');
  $('record-filters').open=!compactMedia.matches;
  compactMedia.addEventListener('change',event=>{$('record-filters').open=!event.matches;});
  function el(tag, cls, text) { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; }
  function option(value, label) { const node = el('option', '', label); node.value = value; return node; }
  function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function num(value, digits=6) { return value === null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('en-US', {maximumFractionDigits:digits}); }
  function meanText(value) { return value === null ? '—' : Number(value).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}); }
  function mode(g) { return g.powerMode || 'watts'; }
  function powerKey(g) { return typeof g.measuredPowerW==='number'&&Number.isFinite(g.measuredPowerW)&&g.measuredPowerW>0&&Number.isFinite(g.measuredPowerW*1000)?String(g.measuredPowerW):'unmeasured'; }
  function powerLabel(g) { return powerKey(g)==='unmeasured'?'功率未测':measuredText(g)+' mW'; }
  function milliWatts(watts) { return watts===null||watts===undefined ? null : Number(watts)*1000; }
  function measuredText(g) { return num(milliWatts(g.measuredPowerW)); }
  function spacingMM(g){return Number((g.spacing/1000).toPrecision(15));}
  function recipe(g) { return `功率 ${powerKey(g)==='unmeasured'?'未测':powerLabel(g)} · ${num(g.speed)} mm/s · ${num(g.frequency)} kHz · ${num(spacingMM(g))} mm${g.lens?' · '+g.lens.name:''}`; }
  function toast(text) { $('toast').textContent=text; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3500); }
  try {
    const raw=localStorage.getItem(KEY); originalRaw=raw;
    const parsed=raw ? JSON.parse(raw) : null;
    state=parsed ? C.validateState(parsed) : C.demoState();
    if(parsed && parsed.version < 3 && !localStorage.getItem(KEY+'-before-v3')) localStorage.setItem(KEY+'-before-v3',raw);
  } catch(error) {
    protectUnreadable=true; storageOK=false; state=C.demoState();
    $('storage-warning').hidden=false;
    $('storage-warning').textContent='原记录读取失败，已保护原存储。当前为独立演示，请先下载备份并检查原文件。';
  }
  let source=state.groups.some(g=>!g.isDemo) ? 'real' : 'demo';
  $('source-filter').value=source;
  function updateSaveStatus() {
    const labels={idle:'准备同步',loading:'读取云端记录',empty:'云端已就绪','needs-upload':'本机记录待上传',pending:'等待同步',syncing:'正在同步',synced:'云端已保存',offline:'离线 · 本机已保存','auth-required':'需要重新登录',conflict:'有修改冲突',error:'同步未完成'};
    $('save-status').classList.toggle('unsaved', !storageOK || drafts.size>0 || protectUnreadable || !!pendingCloud || ['offline','auth-required','error','conflict'].includes(cloudStatus.kind));
    $('save-text').textContent=protectUnreadable ? '原存储受保护' : pendingCloud ? '云端有更新待核对' : pendingExternal ? '其他标签页有更新' : drafts.size ? '有无效输入未保存' : storageOK ? labels[cloudStatus.kind]||'等待同步' : '保存失败，请备份';
    $('input-error').hidden=!drafts.size;
    $('input-error').textContent=drafts.size ? '红色输入尚未保存：方阻请填写有限正数，或清空留待测量。' : '';
  }
  function save() {
    try {
      if(protectUnreadable || pendingExternal || pendingCloud) throw new Error('原存储或外部更新受保护');
      localStorage.setItem(KEY,JSON.stringify(state)); storageOK=true;
      if(cloud&&cloudReady&&(cloudHasRecords||state.groups.some(g=>!g.isDemo)||state.lenses.length))cloud.queue(C.validateState(state));
    } catch(error) { storageOK=false; toast(protectUnreadable ? '原存储受保护，未覆盖。' : pendingExternal ? '其他标签页有更新，本页未覆盖它。请先下载本页备份再载入最新记录。' : '本机保存失败，请下载 JSON 备份。'); }
    updateSaveStatus();
  }
  function canLeaveInputs() {
    if(pendingCloud){toast('请先备份本机修改，再载入云端版本。');return false;}
    if(!cloudReady){toast('正在读取云端记录，请稍候。');return false;}
    if(pendingExternal){toast('请先点击上方“备份本页并载入最新”，以保留两边记录。');return false;}
    if(!drafts.size) return true;
    toast('请先修正红色方阻输入，或清空该格。');
    document.querySelector('input[aria-invalid="true"]')?.focus();
    return false;
  }
  function activeGroups() { return state.groups.filter(g=>!g.deletedAt); }
  function sourceGroups() { return activeGroups().filter(g=>source==='demo' ? g.isDemo : !g.isDemo); }
  function filteredGroups() {
    return sourceGroups().filter(g=>(!lensFilter||(g.lens?.id||'none')===lensFilter)&&PARAMS.every(key=>!filters[key] || (key==='power' ? powerKey(g) : String(g[key]))===filters[key]));
  }
  function populateFilters() {
    const groups=sourceGroups();
    PARAMS.forEach(key=>{
      const select=$('filter-'+key), levels=new Map();
      groups.forEach(g=>levels.set(key==='power' ? powerKey(g) : String(g[key]), g));
      const sorted=Array.from(levels.entries()).sort((a,b)=>key==='power' ? (a[0]==='unmeasured'?Infinity:Number(a[0]))-(b[0]==='unmeasured'?Infinity:Number(b[0])) : Number(a[0])-Number(b[0]));
      select.replaceChildren(option('','全部'));
      sorted.forEach(([value,g])=>select.append(option(value, key==='power' ? powerLabel(g) : num(key==='spacing'?spacingMM(g):g[key]))));
      if(!levels.has(filters[key])) filters[key]='';
      select.value=filters[key];
    });
    const lenses=new Map(groups.map(g=>[g.lens?.id||'none',g.lens?.name||'未选择镜头']));
    $('filter-lens').replaceChildren(option('','全部镜头'));for(const [id,name]of lenses)$('filter-lens').append(option(id,name));
    if(!lenses.has(lensFilter))lensFilter='';$('filter-lens').value=lensFilter;
    const selected=PARAMS.filter(key=>filters[key]).length+(lensFilter?1:0);
    $('filter-summary').textContent=selected?`已选 ${selected} 项`:'全部记录';
  }
  function updateQCContext(){
    const qc=C.latestQC(state,today()),node=$('current-qc-summary');
    if(source==='demo'){node.textContent='演示记录';node.title='演示数据与真实实验分开保存';return;}
    const mean=qc?C.groupStats(qc).mean:null;
    node.textContent=qc?'今日QC · '+(mean===null?'待录入方阻':meanText(mean)+' Ω/□'):'今日QC · 尚未记录';
    node.title=qc?qc.id+' · '+recipe(qc):'当天尚无日常QC；仍可继续记录实验';
  }
  function updateMean(row,g) {
    const stats=C.groupStats(g), progress=C.groupProgress(g);
    row.querySelector('.mean-value').textContent=meanText(stats.mean);
    const sub=row.querySelector('.mean-meta');
    sub.textContent=stats.n===progress.total ? '已完成 · '+stats.n+'件' : `${progress.complete?'已处理':'暂均值'} · ${stats.n}/${progress.total} 件测齐`;
    sub.classList.toggle('partial',stats.n<progress.total);
    row.querySelector('.mean-value').title=stats.sd===null ? '' : `样品间 SD ${meanText(stats.sd)} Ω/□；CV ${meanText(stats.cv)}%`;
    row.querySelectorAll('[data-summary-sample]').forEach(button=>{const index=g.electrical.findIndex(s=>s.id===button.dataset.summarySample),sample=g.electrical[index];button.querySelector('span').textContent=sample.status==='normal'?meanText(C.sampleMean(sample)):statusLabels[sample.status];button.querySelector('small').textContent=row.tagName==='ARTICLE'?`样品${index+1} · ${sample.status==='normal'?sample.values.filter(Boolean).length+'/'+sample.values.length:'查看'}`:sample.status==='normal'?`${sample.values.filter(Boolean).length}/${sample.values.length} 次读数`:'查看详情';});
    const resultLabel=row.querySelector('.card-result-label');if(resultLabel)resultLabel.textContent=stats.mean===null?'方阻 Ω/□':stats.n===progress.total?'平均方阻 Ω/□':'暂均值 Ω/□';
    if(row.tagName==='TR'){const card=document.querySelector(`[data-card-group="${g.id}"]`);if(card)updateMean(card,g);}
    if(detailId===g.id && $('details-dialog').open) updateDetailStats(g);
  }
  function draftKey(g,s,index) { return `${g.id}|${s.id}|${index}`; }
  function makeReading(g,s,index,label) {
    const input=el('input','reading'); input.type='text'; input.inputMode='decimal'; input.autocomplete='off'; input.spellcheck=false; input.maxLength=64;
    input.placeholder='—'; input.setAttribute('aria-label',label);
    const key=draftKey(g,s,index);
    input.value=drafts.has(key) ? drafts.get(key) : s.values[index];
    input.setAttribute('aria-invalid',String(drafts.has(key)));
    input.dataset.group=g.id; input.dataset.sample=s.id; input.dataset.index=String(index);
    input.addEventListener('focus',()=>{if(input.closest('#details-dialog'))setDetailSample(s.id);});
    input.addEventListener('input',()=>{
      if(!cloudReady||pendingCloud){input.value=s.values[index];toast('请先等待云端读取完成或处理更新冲突。');return;}
      const value=input.value.trim();
      const valid=value==='' || (NUMBER.test(value)&&Number.isFinite(Number(value))&&Number(value)>0);
      input.setAttribute('aria-invalid',String(!valid));
      if(!valid) { drafts.set(key,input.value); updateSaveStatus(); return; }
      drafts.delete(key); s.values[index]=value; save();
      const row=document.querySelector(`tr[data-group="${g.id}"]`); if(row) updateMean(row,g);else if(detailId===g.id)updateDetailStats(g);
    });
    input.addEventListener('keydown',event=>{
      if(event.key!=='Enter') return;
      event.preventDefault(); if(!canLeaveInputs()) return;
      const container=input.closest('dialog') || $('record-body');
      const all=Array.from(container.querySelectorAll('input.reading:not(:disabled)'));
      const inputs=container.id==='details-dialog'?all.filter(node=>node.dataset.sample===s.id):all.filter(node=>node.getClientRects().length);
      let next=inputs[inputs.indexOf(input)+(event.shiftKey?-1:1)];
      if(!next&&container.id==='details-dialog'){
        const index=g.electrical.findIndex(sample=>sample.id===s.id)+(event.shiftKey?-1:1),target=g.electrical[index];
        if(target){setDetailSample(target.id);const candidates=all.filter(node=>node.dataset.sample===target.id);next=event.shiftKey?candidates.at(-1):candidates[0];}
      }
      if(next){next.focus();next.select();}
    });
    return input;
  }
  function renderRecords() {
    populateFilters();
    const rows=filteredGroups(), total=sourceGroups().length;
    const pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE)); page=Math.max(0,Math.min(page,pages-1));
    const count=Math.max(3,...rows.map(g=>g.electrical.length)),head=$('record-head'),cols=$('record-cols');
    head.querySelectorAll('.sample-head').forEach(node=>node.remove());cols.replaceChildren(...['id-col','power-col','param-col','param-col','param-col','param-col','mean-col','more-col'].map(name=>el('col',name)));
    for(let i=0;i<count;i++){const th=el('th','sample-head');th.scope='col';th.append(el('span','','样品'+(i+1)),el('small','','均值 / Ω/□'));head.insertBefore(th,head.querySelector('.group-mean-head'));const col=el('col','read-col');cols.insertBefore(col,cols.querySelector('.mean-col'));}
    $('record-caption').textContent='一行一组参数，样品列显示各独立样品的均值；点开录入每件的多次原始读数。';
    $('record-count').replaceChildren(el('strong','',`当前 ${rows.length} / ${total} 行`),document.createTextNode(source==='demo'?' · 演示记录':' · 我的记录'));
    $('source-badge').hidden=source!=='demo';
    const body=$('record-body'),cards=$('record-cards'); body.replaceChildren();cards.replaceChildren();
    rows.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).forEach(g=>{
      const row=el('tr'); row.dataset.group=g.id;
      const idCell=el('td','record-id'),idButton=el('button','record-open',g.id);idButton.type='button';idButton.setAttribute('aria-label',g.id+' 查看详情');idButton.onclick=()=>openDetails(g.id);idCell.append(idButton);
      if(g.qc){row.classList.add('qc-row');idCell.append(el('span','qc-badge',g.qc.referenceId+' · '+(g.qc.kind==='reference'?'QC参考':'QC记录')));}
      row.append(idCell);
      const powerCell=el('td','param-value',powerKey(g)==='unmeasured'?'未测':measuredText(g));powerCell.title=powerLabel(g);row.append(powerCell);
      for(const key of ['speed','frequency','spacing']) row.append(el('td','param-value',num(key==='spacing'?spacingMM(g):g[key])));
      const lensCell=el('td','lens-cell',g.lens?.name||'—');lensCell.title=g.lens?`焦距 ${g.lens.focalLengthMM??'—'} mm · 实测光斑 ${g.lens.spotDiameterUM??'—'} μm`:'';row.append(lensCell);
      for(let index=0;index<count;index++){
        const sample=g.electrical[index];
        const cell=el('td');
        if(!sample){cell.textContent='—';row.append(cell);continue;}
        if(sample.status==='normal' && sample.values.length===1) cell.append(makeReading(g,sample,0,`${g.id} 第${index+1}片方阻`));
        else {
          const button=el('button','reading-summary'+(sample.status==='normal'?'':' excluded'));button.dataset.summarySample=sample.id;button.append(el('span','',sample.status==='normal'?meanText(C.sampleMean(sample)):statusLabels[sample.status]));
          button.type='button'; button.setAttribute('aria-label',`${g.id} 第${index+1}片${sample.status==='normal'?'原始读数':'状态详情'}`);
          button.append(el('small','',sample.status==='normal'?`${sample.values.filter(Boolean).length}/${sample.values.length} 次读数`:'查看详情'));
          button.addEventListener('click',()=>openDetails(g.id,sample.id)); cell.append(button);
        }
        row.append(cell);
      }
      const average=el('td'); average.append(el('div','mean-value'),el('div','mean-meta')); row.append(average);
      const action=el('td'), button=el('button','icon-btn row-details','···'); button.type='button';button.setAttribute('aria-label',`${g.id} 操作`);button.addEventListener('click',()=>openRowActions(g.id));action.append(button);row.append(action);body.append(row);cards.append(makeRecordCard(g));updateMean(row,g);
    });
    $('table-empty').hidden=rows.length>0;
    $('table-empty').replaceChildren(el('p','',total ? '没有同时满足这些条件的记录。' : source==='demo' ? '暂无演示数据。' : '还没有实验记录，添加一行开始填写。'));
    if(!rows.length) {const b=el('button','btn',total?'清空筛选':'＋ 新增记录');b.addEventListener('click',()=>total?clearFilters():openGroup());$('table-empty').append(b);}
    $('page-label').textContent=`${page+1} / ${pages}`;$('page-prev').disabled=page===0;$('page-next').disabled=page>=pages-1;
    $('footer-count').textContent=rows.length?`${page*PAGE_SIZE+1}—${Math.min(rows.length,(page+1)*PAGE_SIZE)} 行`:'';
    updateSaveStatus();updateTrashUI();updateQCContext();
  }
  function makeRecordCard(g){
    const card=el('article','record-card'+(g.qc?' qc-card':''));card.dataset.cardGroup=g.id;card.setAttribute('aria-label',g.id+' 实验记录');
    const head=el('div','record-card-head'),identity=el('div','record-card-id'),open=el('button','record-open',g.id);open.type='button';open.setAttribute('aria-label',g.id+' 查看详情');open.onclick=()=>openDetails(g.id);identity.append(open);
    if(g.qc)identity.append(el('span','qc-badge',g.qc.referenceId+' · '+(g.qc.kind==='reference'?'QC参考':'QC记录')));
    const result=el('div','record-card-result');result.append(el('small','card-result-label','平均方阻 Ω/□'),el('div','mean-value'),el('div','mean-meta'));
    const menu=el('button','icon-btn card-menu','···');menu.type='button';menu.setAttribute('aria-label',g.id+' 操作');menu.onclick=()=>openRowActions(g.id);head.append(identity,result,menu);card.append(head);
    const params=el('div','record-card-params');for(const [name,value]of [['功率',powerLabel(g)],['扫速',num(g.speed)+' mm/s'],['重频',num(g.frequency)+' kHz'],['间距',num(spacingMM(g))+' mm']]){const item=el('span','',name+' ');item.append(el('strong','',value));params.append(item);}card.append(params);
    const samples=el('div','record-card-samples');g.electrical.forEach((sample,index)=>{const button=el('button','reading-summary'+(sample.status==='normal'?'':' excluded'));button.type='button';button.dataset.summarySample=sample.id;button.setAttribute('aria-label',`${g.id} 第${index+1}片${sample.status==='normal'?'原始读数':'状态详情'}`);button.append(el('span','',sample.status==='normal'?meanText(C.sampleMean(sample)):statusLabels[sample.status]),el('small','',`样品${index+1} · ${sample.values.filter(Boolean).length}/${sample.values.length}`));button.onclick=()=>openDetails(g.id,sample.id);samples.append(button);});card.append(samples,el('div','record-card-meta',g.date+(g.lens?' · '+g.lens.name:'')));return card;
  }
  function openRowActions(id) {
    if(!canLeaveInputs())return;
    const group=state.groups.find(g=>g.id===id&&!g.deletedAt);if(!group)return;
    actionId=id;$('row-action-title').textContent=`${id} · 记录操作`;$('row-action-recipe').textContent=recipe(group);$('row-action-dialog').showModal();
    $('row-action-qc-reference').hidden=!!group.qc||group.isDemo;
    $('row-action-qc-unmark').hidden=!group.qc;
  }
  $('row-action-details').addEventListener('click',()=>{const id=actionId;$('row-action-dialog').close();openDetails(id);});
  $('row-action-copy').addEventListener('click',()=>{const id=actionId;$('row-action-dialog').close();openGroup(null,id);});
  $('row-action-delete').addEventListener('click',()=>requestDelete(actionId));
  $('row-action-qc-reference').addEventListener('click',()=>{const id=actionId;$('row-action-dialog').close();qcUI.setReference(id);});
  $('row-action-qc-unmark').addEventListener('click',()=>{const id=actionId;$('row-action-dialog').close();qcUI.unmark(id);});
  function updateTrashUI() {
    const removed=state.groups.filter(g=>g.deletedAt);
    $('open-trash').textContent=`回收站（${removed.length}）`;
    const last=removed.find(g=>g.id===lastDeletedId);
    $('delete-notice').hidden=!last;
    if(last)$('delete-notice-text').textContent=`${last.id} 已移入回收站。`;
    if($('trash-dialog').open)renderTrash();
  }
  function commitRecordChange(next) {
    const normalized=C.validateState(next);
    localStorage.setItem(KEY,JSON.stringify(normalized));
    state=normalized;storageOK=true;
    if(cloud&&cloudReady&&(cloudHasRecords||state.groups.some(g=>!g.isDemo)||state.lenses.length))cloud.queue(normalized);
    updateSaveStatus();
  }
  function requestDelete(id) {
    if(!canLeaveInputs()||protectUnreadable)return;
    const group=state.groups.find(g=>g.id===id&&!g.deletedAt);if(!group)return;
    deleteId=id;$('delete-title').textContent=`删除 ${id}？`;$('delete-recipe').textContent=recipe(group);
    $('delete-error').textContent='';
    for(const dialog of [$('row-action-dialog'),$('details-dialog')])if(dialog.open)dialog.close();
    $('delete-dialog').showModal();
  }
  $('delete-confirm').addEventListener('click',()=>{
    if(!canLeaveInputs()||protectUnreadable)return;
    try {
      const group=state.groups.find(g=>g.id===deleteId&&!g.deletedAt);if(!group)throw new Error('这条记录已更新，请关闭后重新选择。');
      const groups=state.groups.map(g=>g.id===deleteId?{...g,deletedAt:new Date().toISOString()}:g);
      const selected=groups.find(g=>!g.deletedAt&&g.isDemo===group.isDemo)||groups.find(g=>!g.deletedAt)||groups[0];
      commitRecordChange({...state,groups,selectedId:selected?.id||''});
      lastDeletedId=group.id;$('delete-dialog').close();renderRecords();if(activeView==='map')mapUI.render({preserveSlice:true});
      toast(`${group.id} 已移入回收站，可撤销或稍后恢复。`);
    } catch(error) {$('delete-error').textContent='删除未完成：'+error.message;}
  });
  function restoreGroup(id) {
    if(!canLeaveInputs()||protectUnreadable)return;
    try {
      const group=state.groups.find(g=>g.id===id&&g.deletedAt);if(!group){toast('这条记录已恢复或已被其他设备更新。');return;}
      commitRecordChange({...state,groups:state.groups.map(g=>g.id===id?{...g,deletedAt:null}:g),selectedId:id});
      source=group.isDemo?'demo':'real';$('source-filter').value=source;PARAMS.forEach(key=>filters[key]='');
      page=Math.floor(sourceGroups().findIndex(g=>g.id===id)/PAGE_SIZE);renderRecords();if(activeView==='map')mapUI.render({preserveSlice:true});
      toast(`${id} 已恢复，编号、参数和原始读数均保留。`);
    } catch(error) {toast('恢复未完成：'+error.message);}
  }
  function renderTrash() {
    const groups=state.groups.filter(g=>g.deletedAt).sort((a,b)=>Date.parse(b.deletedAt)-Date.parse(a.deletedAt));
    $('trash-count').textContent=`共 ${groups.length} 条；恢复后保留原编号、参数与全部样品读数。`;
    const list=$('trash-list');list.replaceChildren();
    if(!groups.length){list.append(el('p','field-help','回收站为空。'));return;}
    for(const group of groups) {
      const row=el('div','trash-row'), content=el('div','trash-info');
      content.append(el('strong','',group.id+(group.isDemo?' · 演示数据':'')),el('p','',recipe(group)),el('small','',`删除于 ${new Date(group.deletedAt).toLocaleString('zh-CN')}`));
      const button=el('button','btn','恢复');button.type='button';button.setAttribute('aria-label',`恢复 ${group.id}`);button.addEventListener('click',()=>restoreGroup(group.id));row.append(content,button);list.append(row);
    }
  }
  $('open-trash').addEventListener('click',()=>{if(!canLeaveInputs())return;$('more-menu').open=false;renderTrash();$('trash-dialog').showModal();});
  $('undo-delete').addEventListener('click',()=>restoreGroup(lastDeletedId));
  $('dismiss-delete').addEventListener('click',()=>{lastDeletedId=null;updateTrashUI();});
  function clearFilters() { if(!canLeaveInputs()) return; PARAMS.forEach(k=>filters[k]='');lensFilter='';page=0;renderRecords(); }
  $('filter-lens').addEventListener('change',event=>{if(!canLeaveInputs()){event.target.value=lensFilter;return;}lensFilter=event.target.value;page=0;renderRecords();});
  PARAMS.forEach(key=>$('filter-'+key).addEventListener('change',event=>{if(!canLeaveInputs()){event.target.value=filters[key];return;}filters[key]=event.target.value;page=0;renderRecords();}));
  $('clear-filters').addEventListener('click',clearFilters);
  $('source-filter').addEventListener('change',event=>{if(!canLeaveInputs()){event.target.value=source;return;}source=event.target.value;PARAMS.forEach(k=>filters[k]='');lensFilter='';page=0;renderRecords();});
  $('page-prev').addEventListener('click',()=>{if(canLeaveInputs()){page--;renderRecords();}});
  $('page-next').addEventListener('click',()=>{if(canLeaveInputs()){page++;renderRecords();}});
  function defaultRecipe(){const g=activeGroups().find(g=>!g.isDemo&&g.id===state.selectedId)||activeGroups().filter(g=>!g.isDemo).at(-1)||null;return g?.lens&&state.lenses.find(l=>l.id===g.lens.id)?.archived?{...g,lens:null}:g;}
  function refreshLensOptions(selected){
    const select=$('field-lens'),previous=selected??select.value;select.replaceChildren(option('','未选择镜头'));
    if(formLensSnapshot)select.append(option('__snapshot__',formLensSnapshot.name+'（沿用资料）'));
    for(const lens of state.lenses.filter(l=>!l.archived))select.append(option(lens.id,lens.name));
    select.value=Array.from(select.options).some(o=>o.value===previous)?previous:'';
  }
  function openGroup(id,copyId,blank=false,qcReference=null) {
    if(!canLeaveInputs()) return;
    if(protectUnreadable){toast('原存储无法读取，当前禁止覆盖。');return;}
    const existing=id ? state.groups.find(item=>item.id===id&&!item.deletedAt) : null;if(id&&!existing){toast('记录已删除，请先从回收站恢复。');return;}editId=existing?.id || null;
    formQCReference=qcReference;
    const g=existing||qcReference?.snapshot||(!blank?(copyId?activeGroups().find(item=>item.id===copyId):defaultRecipe()):null);
    $('group-form').reset();$('group-form-error').textContent='';
    $('group-dialog-title').textContent=existing?`${existing.id} · 编辑参数`:'新增记录';$('group-submit').textContent=existing?'保存参数':'创建记录';
    $('group-form-hint').textContent=existing?'修改参数保留原始方阻。':g?`已沿用 ${g.id} 的加工参数与镜头；实测功率和方阻留空。`:'编号留空自动生成，也可填写自己的编号。';
    $('field-id').value=existing?.id||'';
    $('field-id').placeholder=qcReference?'自动生成QC编号':'留空自动生成';
    $('field-electricalCount').value=existing?.electrical.length??DEFAULT_MEASUREMENTS.electricalCount;
    $('field-characterizationCount').value=existing?.characterization.length??DEFAULT_MEASUREMENTS.characterizationCount;
    $('field-readingsPerSample').value=existing?.measurementPlan.readingsPerSample??DEFAULT_MEASUREMENTS.readingsPerSample;
    const legacy=existing&&mode(existing)==='watts';
    $('field-power').value=g&&mode(g)==='percent'?g.power:'';$('field-power').required=!legacy;
    $('field-arrayPercent').value=g&&mode(g)==='percent'?(g.arrayPercent??100):100;
    for(const key of ['speed','frequency'])$('field-'+key).value=g?(g[key]??''):'';
    editSpacingDisplay=g?String(spacingMM(g)):'';$('field-spacing').value=editSpacingDisplay;$('field-date').value=existing?existing.date:today();
    formLensSnapshot=g?.lens||null;refreshLensOptions(formLensSnapshot?'__snapshot__':'');
    const availableLenses=state.lenses.filter(l=>!l.archived);if(!existing&&!qcReference&&!blank&&!formLensSnapshot&&availableLenses.length===1)$('field-lens').value=availableLenses[0].id;
    editMeasuredDisplay=existing&&existing.measuredPowerW!==null&&existing.measuredPowerW!==undefined&&Number.isFinite(milliWatts(existing.measuredPowerW))?String(milliWatts(existing.measuredPowerW)):'';
    $('field-measuredPowerMW').value=editMeasuredDisplay;
    $('legacy-power-note').hidden=!legacy;
    $('legacy-power-note').textContent=legacy?`旧记录功率录入：${num(milliWatts(existing.power))} mW。百分比留空会保留原记录；补填后会同时保留旧功率值。`:'';
    for(const key of ['power','arrayPercent','speed','frequency','spacing'])$('field-'+key).readOnly=!!qcReference;
    $('field-lens').disabled=!!qcReference;$('form-lenses').hidden=!!qcReference;$('clear-group-params').hidden=!!qcReference;
    for(const [key,count]of [['electricalCount',1],['characterizationCount',0],['readingsPerSample',5]]){$('field-'+key).readOnly=!!qcReference;if(qcReference)$('field-'+key).value=count;}
    if(qcReference){$('group-dialog-title').textContent='记录今日QC · '+qcReference.id;$('group-submit').textContent='添加QC记录';$('group-form-hint').textContent='固定加工参数来自QC参考；本次实测功率和方阻重新填写。';$('field-power').required=qcReference.snapshot.powerMode==='percent';}
    $('measurement-settings').open=false;$('measurement-settings').querySelector('summary span:last-child').textContent=qcReference?'查看测量安排':'调整测量安排';updateMeasurementSummary();
    renderQCLink($('form-qc-link'),existing,$('field-date').value,!!qcReference||!!existing?.qc,link=>{ $('form-qc-link')._selection=link; });
    $('group-dialog').showModal();
  }
  function renderQCLink(container,group,day,hidden,onChange){
    container.replaceChildren();container.hidden=hidden;container._selection=group?.qcLink||null;if(hidden)return;
    const runs=state.groups.filter(g=>!g.isDemo&&!g.deletedAt&&C.isQCOnly(g)).sort((a,b)=>Date.parse(b.qc.createdAt)-Date.parse(a.qc.createdAt));
    const initial=group?group.qcLink:null,dayQC=C.latestQC(state,day),latest=group?null:dayQC;
    container._selection=initial||(latest?C.qcLinkFor(latest):null);
    const label=el('label','field','关联QC'),select=el('select');select.setAttribute('aria-label','关联QC');select.append(option('','未关联QC'));
    for(const run of runs)select.append(option(run.qc.uid,run.id+' · '+run.date));
    if(initial&&!runs.some(run=>run.qc.uid===initial.runUid))select.append(option(initial.runUid,initial.runId+'（历史关联）'));
    select.value=container._selection?.runUid||'';
    select.onchange=()=>{const run=runs.find(g=>g.qc.uid===select.value),link=run?C.qcLinkFor(run):select.value?initial:null;container._selection=link;onChange(link);};label.append(select);container.append(label);
    container.append(el('p','field-help',latest||initial?'可改选对应的实际QC记录；关联仅保存在完整记录中。':dayQC?'此记录尚未关联QC，可选择对应的实际QC记录。':'当天尚无QC记录，关联暂留空；可以继续记录实验。'));
  }
  $('field-date').addEventListener('change',()=>{if(!editId&&!formQCReference)renderQCLink($('form-qc-link'),null,$('field-date').value,false,link=>{$('form-qc-link')._selection=link;});});
  $('new-group').addEventListener('click',()=>openGroup());
  function updateMeasurementSummary(){$('form-measurement-summary').textContent=`${$('field-electricalCount').value}件 × ${$('field-readingsPerSample').value}次，${$('field-characterizationCount').value}件表征/备用`;}
  for(const id of ['field-electricalCount','field-readingsPerSample','field-characterizationCount'])$(id).addEventListener('input',updateMeasurementSummary);
  $('group-form').addEventListener('invalid',event=>{if(event.target.closest('#measurement-settings'))$('measurement-settings').open=true;},true);
  $('clear-group-params').addEventListener('click',()=>{if(editId){for(const key of ['power','speed','frequency','spacing','measuredPowerMW'])$('field-'+key).value='';$('field-arrayPercent').value=100;$('field-lens').value='';}else{$('group-dialog').close();openGroup(null,null,true);}});
  lensUI=LIGLensLibrary.mount({getState:()=>state,onChange:(lenses,selected)=>{if(!canLeaveInputs())throw new Error('请先处理未保存输入或同步冲突。');commitRecordChange({...state,lenses});renderRecords();refreshLensOptions(selected);}});
  for(const id of ['open-lenses','form-lenses'])$(id).addEventListener('click',()=>{if(canLeaveInputs()){$('more-menu').open=false;lensUI.open();}});
  const backupUI=LIGBackupUI.mount({beforeCreate:async()=>{if(!canLeaveInputs())return false;await cloud.flush();if(cloud.status().dirty)throw new Error('还有读数未同步，请先完成同步后备份。');return true;}});
  $('open-backups').addEventListener('click',()=>{if(canLeaveInputs()){$('more-menu').open=false;backupUI.open();}});
  qcUI=LIGQCUI.mount({getState:()=>state,canChange:canLeaveInputs,recipe,toast,onRecord:ref=>openGroup(null,null,false,ref),commit:next=>{commitRecordChange(next);renderRecords();if(activeView==='map')mapUI.render({preserveSlice:true});},exportQC:ref=>{
    const groups=state.groups.filter(g=>!g.deletedAt&&g.qc?.kind==='run'&&g.qc.referenceId===ref.id);
    if(!groups.length)throw new Error('还没有这套参考对应的日常QC记录。');
    const cell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
    const rows=[['QC编号','加工日期','参考方阻(Ω/□)','本次方阻(Ω/□)','差值(Ω/□)','变化(%)','实测功率(mW)']];
    for(const g of groups){const mean=C.groupStats(g).mean,base=g.qc.baseline.mean,delta=mean!==null&&base!==null?mean-base:null;rows.push([g.id,g.date,base,mean,delta,delta===null?null:delta/base*100,milliWatts(g.measuredPowerW)]);}
    download('\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n','text/csv;charset=utf-8',ref.id+'_QC对照_'+today()+'.csv');
  }});
  $('record-qc').addEventListener('click',()=>qcUI.open(true));
  $('open-qc').addEventListener('click',()=>{$('more-menu').open=false;qcUI.open();});
  $('group-form').addEventListener('submit',event=>{
    event.preventDefault();
    try {
      if(protectUnreadable) throw new Error('原存储无法读取，未覆盖。');
      if(!canLeaveInputs())return;
      const fields=Object.fromEntries(new FormData(event.currentTarget).entries());
      const existing=state.groups.find(g=>g.id===editId&&!g.deletedAt);
      if(formQCReference){
        const measured=fields.measuredPowerMW.trim();if(measured!==''&&(!NUMBER.test(measured)||!Number.isFinite(Number(measured))||Number(measured)<=0||Number(measured)/1000<=0))throw new Error('实测功率请填有限正数，未测可留空。');
        const next=C.createQCRun(state,formQCReference.id,{id:fields.id.trim(),date:fields.date,measuredPowerW:measured===''?null:Number(measured)/1000});
        commitRecordChange(next);source='real';$('source-filter').value=source;PARAMS.forEach(key=>filters[key]='');lensFilter='';page=Math.floor(sourceGroups().findIndex(g=>g.id===next.selectedId)/PAGE_SIZE);$('group-dialog').close();setView('records');openDetails(next.selectedId);toast('已创建本次QC：1件样品，5次读数。');return;
      }
      if(editId&&!existing)throw new Error('记录已删除，请关闭后重新选择。');
      fields.id=fields.id.trim()||(existing?.id||'');
      const spacing=fields.spacing.trim();
      fields.spacing=existing&&spacing===editSpacingDisplay?existing.spacing:Number(spacing)*1000;
      if(!NUMBER.test(spacing)||!Number.isFinite(fields.spacing)||fields.spacing<=0)throw new Error('线间距请填写大于0的 mm 数值。');
      fields.lens=$('field-lens').value==='__snapshot__'?formLensSnapshot:state.lenses.find(l=>l.id===$('field-lens').value)||null;
      const measured=fields.measuredPowerMW.trim();
      if(measured!==''&&(!NUMBER.test(measured)||!Number.isFinite(Number(measured))||Number(measured)<=0||!Number.isFinite(Number(measured)/1000)||Number(measured)/1000<=0))throw new Error('实测功率请填写大于 0 的 mW 数值，未测可留空。');
      fields.measuredPowerW=existing&&measured===editMeasuredDisplay?existing.measuredPowerW:measured===''?null:Number(measured)/1000;
      fields.powerMode=existing&&mode(existing)==='watts'&&!fields.power.trim()?'watts':'percent';
      if(fields.powerMode==='watts'){fields.power=existing.power;fields.arrayPercent=null;}
      fields.legacyPowerW=existing?.legacyPowerW??(existing&&mode(existing)==='watts'&&fields.powerMode==='percent'?existing.power:null);
      for(const key of ['name','parentSheet','calibrationId'])fields[key]=existing?.[key]||'';
      let group;
      if(existing) {
        const resized=C.resizeMeasurements(existing,fields);
        const normalized=C.createGroup({...fields,mode:existing.measurementPlan.mode,positionDescription:existing.measurementPlan.positionDescription},state.groups.filter(g=>g.id!==editId));
        for(const key of ['id','lens','powerMode','power','arrayPercent','measuredPowerW','legacyPowerW','calibrationId','speed','frequency','spacing','date']) resized[key]=normalized[key];
        if(Number(fields.electricalCount)!==existing.electrical.length||Number(fields.characterizationCount)!==existing.characterization.length||Number(fields.readingsPerSample)!==existing.measurementPlan.readingsPerSample)resized.measurementLayout='sample-repeats-v4';
        Object.assign(existing,resized);
        group=existing;
      } else {
        group=C.createGroup({...DEFAULT_MEASUREMENTS,...fields},state.groups);state.groups.push(group);
      }
      if(!group.qc){const link=$('form-qc-link')._selection;if(link)group.qcLink=link;else delete group.qcLink;}
      state.selectedId=group.id;
      const returnToMap=!!existing&&activeView==='map';
      if(!returnToMap){source=group.isDemo?'demo':'real';$('source-filter').value=source;PARAMS.forEach(k=>filters[k]='');lensFilter='';page=Math.floor(sourceGroups().findIndex(g=>g.id===group.id)/PAGE_SIZE);}
      save();if(returnToMap)mapUI.render({preserveSlice:true});else setView('records');$('group-dialog').close();
      toast(existing?'参数与测量安排已更新，原始读数保留。':`已添加 ${group.id}：${group.electrical.length} 件样品，每件 ${group.measurementPlan.readingsPerSample} 次读数。`);
    } catch(error) { $('group-form-error').textContent=error.message; }
  });
  function updateDetailStats(g) {
    const stats=C.groupStats(g);$('detail-stats').replaceChildren();
    for(const [label,value] of [[stats.n===g.electrical.length?'组平均':'组暂均值',meanText(stats.mean)+' Ω/□'],['测齐',stats.n+'/'+g.electrical.length+' 件']]) {const span=el('span','',label+' ');span.append(el('strong','',value));$('detail-stats').append(span);}
    $('detail-samples').querySelectorAll('[data-sample-mean]').forEach(node=>{const sample=g.electrical.find(s=>s.id===node.dataset.sampleMean);node.textContent=meanText(C.sampleMean(sample));});
    qcUI.comparison(g,$('detail-qc-comparison'));
    if(g.qc?.kind==='run')updateQCContext();
  }
  function setDetailSample(id){
    detailSampleId=id;
    $('detail-samples').querySelectorAll('[data-sample-column]').forEach(node=>node.classList.toggle('sample-current',node.dataset.sampleColumn===id));
    $('detail-sample-tabs').querySelectorAll('[role="tab"]').forEach(node=>{const selected=node.dataset.sample===id;node.setAttribute('aria-selected',String(selected));node.tabIndex=selected?0:-1;});
  }
  function navigateDetail(direction){if(!canLeaveInputs())return;const index=detailRecordOrder.indexOf(detailId),id=detailRecordOrder[index+direction];if(id)openDetails(id);}
  $('detail-prev').onclick=()=>navigateDetail(-1);$('detail-next').onclick=()=>navigateDetail(1);
  function openDetails(id,sampleId) {
    if(!canLeaveInputs()) return;
    const g=state.groups.find(item=>item.id===id&&!item.deletedAt);if(!g)return;detailId=id;state.selectedId=id;save();
    const candidates=activeView==='map'?Array.from($('map-panel').querySelectorAll('[data-map-group]')).map(button=>button.dataset.mapGroup):filteredGroups().map(group=>group.id);
    detailRecordOrder=candidates.includes(id)?candidates:activeGroups().filter(group=>group.isDemo===g.isDemo).map(group=>group.id);
    const position=detailRecordOrder.indexOf(id);$('detail-prev').disabled=position<=0;$('detail-next').disabled=position<0||position>=detailRecordOrder.length-1;
    $('details-dialog').classList.toggle('is-qc-reference',g.qc?.kind==='reference');
    $('detail-title').textContent=`${g.id} · 方阻记录`;$('detail-recipe').textContent=recipe(g);updateDetailStats(g);
    renderQCLink($('detail-qc-link'),g,g.date,!!g.qc,link=>{if(!canLeaveInputs())return;if(link)g.qcLink=link;else delete g.qcLink;save();});
    $('detail-samples').replaceChildren();$('detail-more').open=false;$('detail-qc-link').closest('details').open=false;
    const wrap=el('div','measurement-scroll'),table=el('table','measurement-table');table.setAttribute('aria-label',`方阻原始读数表，每件${g.measurementPlan.readingsPerSample}次`);
    const header=el('tr');header.append(el('th','','测量次数'));g.electrical.forEach((s,i)=>header.append(el('th','','样品'+(i+1)+' · '+s.id)));table.append(header);
    for(let index=0;index<g.measurementPlan.readingsPerSample;index++){const row=el('tr');row.append(el('th','','第'+(index+1)+'次'));g.electrical.forEach(sample=>{const td=el('td'),input=makeReading(g,sample,index,`${g.id} ${sample.id} 第${index+1}次读数`);input.disabled=sample.status!=='normal';td.append(input);row.append(td);});table.append(row);}
    const means=el('tr','measurement-means');means.append(el('th','','样品均值'));g.electrical.forEach(sample=>{const td=el('td','',meanText(C.sampleMean(sample)));td.dataset.sampleMean=sample.id;means.append(td);});table.append(means);
    const statuses=el('tr');statuses.append(el('th','','状态'));g.electrical.forEach(sample=>{const td=el('td'),select=el('select');select.setAttribute('aria-label',`${g.id} ${sample.id} 状态`);for(const [value,label]of Object.entries(statusLabels))select.append(option(value,label));select.value=sample.status;select.onchange=()=>{if(!canLeaveInputs()){select.value=sample.status;return;}sample.status=select.value;table.querySelectorAll('input.reading').forEach(input=>{if(input.dataset.sample===sample.id)input.disabled=sample.status!=='normal';});save();const row=document.querySelector(`tr[data-group="${g.id}"]`);if(row)updateMean(row,g);else updateDetailStats(g);};td.append(select);statuses.append(td);});table.append(statuses);
    const notes=el('tr');notes.append(el('th','','样品备注'));g.electrical.forEach(sample=>{const td=el('td'),note=el('input','sample-note');note.type='text';note.maxLength=1500;note.placeholder='选填';note.value=sample.note;note.setAttribute('aria-label',`${g.id} ${sample.id} 备注`);note.oninput=()=>{sample.note=note.value;save();};td.append(note);notes.append(td);});table.append(notes);
    for(const row of table.rows)Array.from(row.children).slice(1).forEach((cell,index)=>{cell.dataset.sampleColumn=g.electrical[index].id;});
    table.style.minWidth=(72+g.electrical.length*120)+'px';
    const tabs=$('detail-sample-tabs');tabs.replaceChildren();tabs.hidden=g.electrical.length<2;
    g.electrical.forEach((sample,index)=>{const tab=el('button','sample-tab','样品'+(index+1));tab.type='button';tab.setAttribute('role','tab');tab.dataset.sample=sample.id;tab.onclick=()=>setDetailSample(sample.id);tab.onkeydown=event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const target=g.electrical[index+(event.key==='ArrowRight'?1:-1)];if(target){setDetailSample(target.id);tabs.querySelector(`[data-sample="${target.id}"]`).focus();}};tabs.append(tab);});
    setDetailSample(sampleId&&g.electrical.some(s=>s.id===sampleId)?sampleId:g.electrical[0].id);
    wrap.append(table);$('detail-samples').append(el('p','detail-sample-help','单位 Ω/□ · 自动保存 · Enter沿当前样品向下录入'),wrap);
    setDetailSample(detailSampleId);
    $('detail-characterization').replaceChildren();
    for(const sample of g.characterization) {
      const row=el('div','m-row'), select=el('select'), note=el('input');
      for(const [value,label] of [['pending','待表征'],['reserved','备用'],['raman','Raman 已完成'],['sem','SEM 已完成'],['done','表征已完成']])select.append(option(value,label));
      select.value=sample.status;select.setAttribute('aria-label',`${g.id} ${sample.id} 表征状态`);select.addEventListener('change',()=>{sample.status=select.value;save();});
      note.value=sample.note;note.maxLength=1500;note.placeholder='备注（选填）';note.setAttribute('aria-label',`${g.id} ${sample.id} 备注`);note.addEventListener('input',()=>{sample.note=note.value;save();});row.append(el('strong','',sample.id),select,note);$('detail-characterization').append(row);
    }
    $('detail-notes').value=g.notes;
    $('detail-meta').textContent=`日期 ${g.date}${g.parentSheet?' · 母片 '+g.parentSheet:''}${g.measuredPowerW!==null&&g.measuredPowerW!==undefined?' · 实测 '+measuredText(g)+' mW':''}${g.legacyPowerW!==null&&g.legacyPowerW!==undefined?' · 旧功率录入 '+num(milliWatts(g.legacyPowerW))+' mW':''}${g.calibrationId?' · 标定 '+g.calibrationId:''}${g.name?' · 原名称：'+g.name:''}${g.isDemo?' · 演示数据':''}`;
    $('detail-plan-note').textContent=`每件 ${g.measurementPlan.readingsPerSample} 次，填齐后计算该件均值，再按 ${g.electrical.length} 件等权平均。${g.characterization.length} 件表征/备用样品不参与平均。`+(g.measurementArchive?' 旧版五格已转为样品1的五次读数，转换前数据保存在完整 JSON 备份中。':'');
    if(!$('details-dialog').open)$('details-dialog').showModal();
    if(sampleId){const inputs=Array.from(table.querySelectorAll('input.reading')).filter(input=>input.dataset.sample===sampleId&&!input.disabled),target=inputs.find(input=>!input.value)||inputs[0];if(target){target.focus();target.select();}}
  }
  $('detail-notes').addEventListener('input',()=>{const g=state.groups.find(g=>g.id===detailId);if(g){g.notes=$('detail-notes').value;save();}});
  $('detail-edit').addEventListener('click',()=>{if(!canLeaveInputs())return;const id=detailId;$('details-dialog').close();openGroup(id);});
  $('detail-delete').addEventListener('click',()=>requestDelete(detailId));
  $('details-dialog').addEventListener('close',()=>{if($('details-dialog').open)return;detailId=null;detailSampleId=null;if(activeView==='map')mapUI.render({preserveSlice:true});else renderRecords();});
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>{if(!canLeaveInputs())return;$(button.dataset.close).close();}));
  document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('cancel',event=>{if(!canLeaveInputs())event.preventDefault();}));
  function download(content,type,name) {const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),anchor=el('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  function exportCandidates() {return $('export-scope').value==='all'?activeGroups().filter(g=>!g.isDemo):$('export-scope').value==='source'?sourceGroups():filteredGroups();}
  function exportGroups() {return exportCandidates().filter(g=>!C.isQCOnly(g)&&mode(g)===$('export-power-mode').value);}
  function updateExportCount() {
    const candidates=exportCandidates(), modes=new Set(candidates.map(mode)), select=$('export-power-mode'), previous=select.value;
    select.replaceChildren();
    for(const value of ['percent','watts']) if(modes.has(value)) select.append(option(value,value==='percent'?'激光器与阵列百分比':'功率录入 W'));
    if(modes.has(previous))select.value=previous;
    $('export-power-field').hidden=modes.size<=1;
    const groups=exportGroups(), measured=groups.filter(g=>Number.isFinite(C.groupStats(g).mean));
    const partial=measured.filter(g=>C.groupStats(g).n<g.electrical.length).length, missing=groups.length-measured.length, demo=groups.some(g=>g.isDemo);
    const includeOutcome=$('export-outcome').checked,count=includeOutcome?groups.length:measured.length;
    $('export-count').textContent=`将导出 ${count} 行${demo?'（演示数据，不能用作实验训练数据）':''}。${partial?'其中 '+partial+' 行的均值来自部分测齐样品。':''}${includeOutcome?'保留异常和待测行，增加逐件状态、备注；无有效方阻的均值留空。':missing?'跳过 '+missing+' 行尚无均值的记录；勾选“包含异常／待测结果”可保留。':''}`;
    $('export-submit').disabled=!count;
    $('export-submit').textContent=demo?'下载演示 CSV':'下载 CSV';
    $('export-preview').textContent='编号 · '+(select.value==='percent'?'激光器设定 (%) · 阵列 (%) · 实测功率 (mW)':'功率录入 (W)')+' · 扫速 (mm/s) · 重频 (kHz) · 线间距 (mm) · 镜头资料（有记录时） · 平均方阻 (Ω/□)'+(includeOutcome?' · 记录结果 · 逐件状态与备注':'');
  }
  function openExport() {if(!canLeaveInputs())return;$('more-menu').open=false;$('export-scope').options[0].textContent='记录表当前筛选结果';$('export-scope').options[1].textContent='记录表当前来源的全部记录';$('export-scope').value='filtered';$('export-error').textContent=activeView==='map'?'导出范围以记录表为准；地图切片不影响导出。':'';updateExportCount();$('export-dialog').showModal();}
  for(const id of ['export-csv','footer-export','menu-export'])$(id).addEventListener('click',openExport);
  $('export-form').addEventListener('change',updateExportCount);
  $('export-form').addEventListener('submit',event=>{event.preventDefault();try{if(!canLeaveInputs())return;const groups=exportGroups(),includeOutcome=$('export-outcome').checked,count=includeOutcome?groups.length:groups.filter(g=>Number.isFinite(C.groupStats(g).mean)).length;if(!count)throw new Error('当前范围没有可导出的记录。');const subset={version:3,groups,selectedId:groups[0].id}, includeDemo=groups.every(g=>g.isDemo);download(C.exportMeanCSV(subset,{includeDemo,includeOutcome,spacingUnit:'mm',includeLens:true}),'text/csv;charset=utf-8',`LIG_${includeDemo?'演示_':''}参数与${includeOutcome?'测量结果':'平均方阻'}_${today()}.csv`);toast(`已导出 ${count} 行${includeOutcome?'测量结果':'参数与平均方阻'}。`);$('export-dialog').close();}catch(error){$('export-error').textContent=error.message;}});
  $('export-json').addEventListener('click',()=>{
    if(protectUnreadable){if(originalRaw===null){toast('未能取得原始存储，无法下载原记录。');return;}download(originalRaw,'application/json',`LIG_原始存储待检查_${today()}.json`);$('more-menu').open=false;toast('已下载未经改动的原始存储内容。');return;}
    if(!canLeaveInputs())return;download(JSON.stringify(state,null,2),'application/json',`LIG_完整备份_${today()}.json`);$('more-menu').open=false;toast('已下载完整 JSON 备份。');
  });
  $('import-json').addEventListener('click',()=>{if(!canLeaveInputs())return;if(protectUnreadable){toast('原记录读取失败，暂不允许追加覆盖。');return;}$('json-file').value='';$('json-file').click();$('more-menu').open=false;});
  $('json-file').addEventListener('change',async event=>{
    const file=event.target.files[0];if(!file)return;
    try {
      if(file.size>10*1024*1024)throw new Error('备份文件超过 10 MB。');
      const incoming=C.validateState(JSON.parse((await file.text()).replace(/^\uFEFF/,'')));
      if(pendingExternal || pendingCloud || protectUnreadable)throw new Error('本机记录正在保护中，请先处理其他设备的更新。');
      const latestRaw=localStorage.getItem(KEY), latest=latestRaw?C.validateState(JSON.parse(latestRaw)):state;
      if(!incoming.groups.length&&!incoming.lenses.length)throw new Error('备份中没有记录或镜头资料。');
      if(latest.groups.length+incoming.groups.length>1000)throw new Error('合并后超过 1000 行上限。');
      const next=C.mergeNotebook(latest,incoming),added=next.groups.slice(latest.groups.length);
      localStorage.setItem(KEY,JSON.stringify(next));state=next;storageOK=true;cloud?.queue(C.validateState(state));if(added.length)source=added[0].isDemo?'demo':'real';$('source-filter').value=source;PARAMS.forEach(k=>filters[k]='');lensFilter='';page=0;renderRecords();toast(`已追加 ${added.length} 行及镜头资料；重名编号自动调整，原有记录保留。`);
    } catch(error) {toast('导入失败：'+error.message);}
  });
  $('help-button').addEventListener('click',()=>{$('more-menu').open=false;$('help-dialog').showModal();});
  function setView(view) {if(!canLeaveInputs())return;activeView=view;$('records-panel').hidden=view!=='records';$('map-panel').hidden=view!=='map';$('source-filter').parentElement.hidden=view==='map';for(const [id,name]of[['view-records','records'],['view-map','map']]){$(id).classList.toggle('active',view===name);$(id).setAttribute('aria-pressed',String(view===name));}if(view==='map')mapUI.render();else renderRecords();}
  mapUI=LIGParameterMap.mount($('map-panel'),{spacingUnit:'mm',getState:()=>({...state,groups:activeGroups().filter(g=>!C.isQCOnly(g)&&(!lensFilter||(g.lens?.id||'none')===lensFilter)).map(g=>({...g,spacing:spacingMM(g)}))}),onSelect:id=>{if(state.groups.some(g=>g.id===id&&!g.deletedAt))openDetails(id);}});
  $('view-records').addEventListener('click',()=>setView('records'));$('view-map').addEventListener('click',()=>setView('map'));
  const batchUI=LIGBatchUI.mount({spacingUnit:'mm',measurements:DEFAULT_MEASUREMENTS,getDefaults:defaultRecipe,getState:()=>state,onCreate:payload=>{
    if(protectUnreadable)throw new Error('原记录无法读取，当前禁止覆盖。');
    if(!canLeaveInputs())throw new Error('请先修正方阻输入。');
    let latest=state;
    try{const raw=localStorage.getItem(KEY);if(raw)latest=C.validateState(JSON.parse(raw));}catch(error){throw new Error('无法读取现有记录，未生成。');}
    const checked=LIGBatchCore.plan(payload.rows,latest.groups,{allowDuplicates:!!payload.allowDuplicates,lensKey:JSON.stringify(payload.lens||null)});
    if(checked.groupCount!==payload.rows.length)throw new Error('现有记录发生变化，请重新预览。');
    if(!checked.groupCount)throw new Error('没有可新增的组合。');
    const added=[];
    checked.rows.forEach(row=>{const qc=C.latestQC(latest,payload.date),group=C.createGroup({...DEFAULT_MEASUREMENTS,...row,lens:payload.lens||null,name:payload.prefix||'',date:payload.date,parentSheet:payload.parentSheet||'',notes:payload.notes||'',qcLink:qc?C.qcLinkFor(qc):undefined},latest.groups.concat(added));added.push(group);});
    const next=C.validateState({...latest,groups:latest.groups.concat(added),selectedId:added[0].id});
    try{localStorage.setItem(KEY,JSON.stringify(next));}catch(error){throw new Error('本机存储不足，本批未创建，请先备份。');}
    state=next;storageOK=true;cloud?.queue(C.validateState(state));source='real';$('source-filter').value=source;PARAMS.forEach(k=>filters[k]='');lensFilter='';page=Math.floor(sourceGroups().findIndex(g=>g.id===added[0].id)/PAGE_SIZE);setView('records');toast(`已添加 ${added.length} 行，共 ${added.length*4} 个 LIG 样品。`);
  }});
  for(const id of ['batch-groups','menu-batch'])$(id).addEventListener('click',()=>{if(canLeaveInputs()){$('more-menu').open=false;batchUI.open();}});
  function showExternalConflict(incoming) {
    pendingExternal=incoming;storageOK=false;
    document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());
    const box=$('storage-warning');box.hidden=false;box.replaceChildren(el('span','','其他标签页已更新，本页暂停写入以保留对方数据。 '));
    const button=el('button','btn','备份本页并载入最新');button.type='button';
    button.addEventListener('click',()=>{
      download(JSON.stringify({...state,unsavedInputs:Array.from(drafts.entries())},null,2),'application/json',`LIG_本页修改备份_${today()}.json`);
      let latest;
      try{const raw=localStorage.getItem(KEY);if(!raw)throw new Error('未读取到最新记录');latest=C.validateState(JSON.parse(raw));}catch(error){toast('已下载本页备份，但最新存储无法读取，请保留备份后刷新检查。');return;}
      state=latest;pendingExternal=null;drafts.clear();storageOK=true;
      document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());box.hidden=true;renderRecords();if(activeView==='map')mapUI.render();toast('已下载本页修改备份，并载入另一标签页的最新记录。');
    });box.append(button);updateSaveStatus();
  }
  window.addEventListener('storage',event=>{if(event.key!==KEY||event.newValue===null)return;try{const incoming=C.validateState(JSON.parse(event.newValue));if(drafts.size||pendingExternal){showExternalConflict(incoming);return;}state=incoming;renderRecords();if(activeView==='map')mapUI.render();if($('details-dialog').open){$('details-dialog').close();toast('已更新其他标签页保存的记录，请重新打开详情。');}else toast('已更新其他标签页保存的记录。');}catch(error){toast('其他标签页的记录格式无效，当前未替换。');}});
  window.addEventListener('beforeunload',event=>{if(drafts.size||!storageOK){event.preventDefault();event.returnValue='';}});
  renderRecords();if(!protectUnreadable)save();else updateSaveStatus();
})();
