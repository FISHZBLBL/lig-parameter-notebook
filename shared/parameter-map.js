(function (root) {
  'use strict';
  const FIELDS = [
    { key: 'power', label: '功率', unit: 'mW' },
    { key: 'speed', label: '扫描速度', unit: 'mm/s' },
    { key: 'frequency', label: '重复频率', unit: 'kHz' },
    { key: 'spacing', label: '线间距', unit: 'μm' }
  ];
  const MAX_CELLS = 10000;
  const CSS = `
  .lig-map{min-width:0;color:var(--ink,#182c30)}
  .lig-map h1{margin:0 0 5px;font-size:27px;line-height:1.35;letter-spacing:-.7px}
  .lig-map-intro{color:var(--muted,#687c86);font-size:12px;margin:0 0 14px;line-height:1.8}
  .lig-map-toolbar{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding:15px 17px;background:#fff;border:1px solid var(--line,#dce5e9);border-radius:9px;margin-bottom:15px}
  .lig-map-field{display:flex;flex-direction:column;gap:6px;color:#5a717a;font-size:11px;min-width:0}
  .lig-map-basis{grid-column:span 2}
  .lig-map-field select{width:100%;padding:7px 9px;min-height:40px;font-size:12px;border:1px solid #cedbe1;border-radius:6px;background:#fff;color:var(--ink,#182c30)}
  .lig-map-field select:disabled{background:#f5f7f8;cursor:default}
  .lig-map-board{background:#fff;border:1px solid var(--line,#dce5e9);border-radius:9px;padding:20px;min-width:0}
  .lig-map-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:12px;margin-bottom:14px;line-height:1.7}
  .lig-map-summary strong{font-weight:650}.lig-map-source-label{font-size:10px;color:#876427;background:#fff6dd;padding:3px 7px;border-radius:4px}
  .lig-map-source-label.real{color:#167663;background:#e7f3ef}
  .lig-map-scroll{max-width:100%;overflow:auto;max-height:650px;border:1px solid var(--line,#dce5e9);border-radius:7px;overscroll-behavior:contain}
  .lig-map-table{border-collapse:separate;border-spacing:0;width:100%;table-layout:fixed;font-size:12px}
  .lig-map-table th,.lig-map-table td{border-right:1px solid #e2e9ec;border-bottom:1px solid #e2e9ec;padding:9px}
  .lig-map-table thead th{background:#f4f7f8;position:sticky;top:0;z-index:2;font-family:var(--mono,Consolas,monospace);font-size:11px;text-align:center;font-weight:550;height:48px}
  .lig-map-table thead th:first-child{left:0;z-index:4;width:95px;color:#5a717a;font-family:var(--sans,sans-serif);font-size:10px}
  .lig-map-table tbody th{position:sticky;left:0;z-index:1;background:#f8fafb;font-family:var(--mono,Consolas,monospace);font-size:11px;font-weight:550;text-align:center;width:95px}
  .lig-map-table tr:last-child td,.lig-map-table tr:last-child th{border-bottom:0}.lig-map-table th:last-child,.lig-map-table td:last-child{border-right:0}
  .lig-map-table td{background:#fff;vertical-align:top;min-width:138px;min-height:105px}
  .lig-map-table td.unplanned{background:repeating-linear-gradient(135deg,#fafcfc,#fafcfc 8px,#f5f8f8 8px,#f5f8f8 9px);vertical-align:middle;text-align:center;color:#93a2a8;font-size:11px;height:110px}
  .lig-map-group{width:100%;display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-start;gap:4px;text-align:left;border:1px solid #d6e4df;border-radius:6px;background:#eef7f3;padding:10px 11px;min-height:98px;color:#17392f;margin-bottom:7px;cursor:pointer;transition:box-shadow .15s,border-color .15s}
  .lig-map-group:last-child{margin-bottom:0}.lig-map-group:hover{box-shadow:0 3px 13px #182c301a;border-color:#167663}
  .lig-map-group:focus-visible{outline:2px solid #167663;outline-offset:2px}.lig-map-group.selected{outline:2px solid #167663;outline-offset:1px}
  .lig-map-group.no-data{background:#f3f6f7;border-color:#e0e6e9;color:#627a84}.lig-map-group.has-failure{border-style:dashed}
  .lig-map-group.failure-only{background:#fbf1ed;border-color:#e6cdc0;color:#8b5d46}
  .lig-map-group .map-id{font:600 11px var(--mono,Consolas,monospace);line-height:1.4}
  .lig-map-group .map-value{font:650 19px var(--mono,Consolas,monospace);line-height:1.5;letter-spacing:-.5px}
  .lig-map-group .map-value small{font:400 10px var(--sans,sans-serif);margin-left:5px;letter-spacing:0}
  .lig-map-group .map-detail{font-size:10px;line-height:1.6;opacity:.9}
  .lig-map-axis-title{text-align:center;color:#607981;font-size:11px;padding:10px 0 0}
  .lig-map-key{display:flex;align-items:center;gap:15px;flex-wrap:wrap;margin-top:18px;color:#667f87;font-size:10px;line-height:1.8}
  .lig-map-gradient-wrap{display:flex;align-items:center;gap:8px}.lig-map-gradient{height:8px;width:112px;background:linear-gradient(90deg,#e8f4ee,#167663);border-radius:3px;border:1px solid #c5dcd3;flex:none}
  .lig-map-legend-dot{width:10px;height:10px;display:inline-block;border:1px solid #d4dfe3;border-radius:2px;background:#f3f6f7;margin-right:4px;vertical-align:-1px}
  .lig-map-legend-dot.failure{background:#fbf1ed;border:1px dashed #bc8f75}.lig-map-legend-dot.empty{background:repeating-linear-gradient(135deg,#fafcfc,#fafcfc 3px,#e3ebed 3px,#e3ebed 4px)}
  .lig-map-note{font-size:10px;line-height:1.8;color:#7a9098;margin:12px 0 0}
  .lig-map-empty{padding:42px 18px;border:1px dashed #d7e2e6;border-radius:7px;text-align:center;color:#758b94;font-size:13px;line-height:1.9}
  .lig-map-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}.lig-map-list .lig-map-group{margin:0}
  .lig-map-fallback{font-size:12px;color:#876427;background:#fff6dd;border-radius:6px;padding:10px 12px;margin:0 0 15px;line-height:1.8}
  @media(max-width:1180px){.lig-map-toolbar{grid-template-columns:repeat(3,minmax(0,1fr))}.lig-map-toolbar .lig-map-field:first-child{grid-column:auto}}
  @media(max-width:560px){.lig-map h1{font-size:22px}.lig-map-intro{font-size:11px;margin-bottom:14px}.lig-map-toolbar{grid-template-columns:1fr 1fr;padding:13px;gap:12px 10px;margin-bottom:13px}.lig-map-toolbar .lig-map-field:first-child{grid-column:1/-1}.lig-map-field{font-size:10px}.lig-map-field select{min-height:42px;font-size:12px}.lig-map-board{padding:13px 10px}.lig-map-summary{font-size:11px;gap:5px;margin-bottom:12px}.lig-map-key{gap:9px 12px;margin-top:13px;font-size:10px}.lig-map-gradient{width:85px}.lig-map-table td{padding:7px}.lig-map-table thead th:first-child,.lig-map-table tbody th{width:72px}.lig-map-group{padding:9px;min-height:102px}.lig-map-group .map-value{font-size:18px}.lig-map-axis-title{font-size:10px}.lig-map-note{font-size:10px}.lig-map-scroll{max-height:530px}}
  @media print{.lig-map-toolbar{display:none}.lig-map-scroll{overflow:visible;max-height:none}.lig-map-table th{position:static!important}.lig-map-group{break-inside:avoid}}
  @media(prefers-reduced-motion:reduce){.lig-map-group{transition:none}}
  `;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function number(value, maximumFractionDigits) {
    const numeric=Number(value);
    if(numeric!==0&&Math.abs(numeric)<0.000001)return numeric.toExponential(3);
    return numeric.toLocaleString('en-US', { maximumFractionDigits: maximumFractionDigits === undefined ? 6 : maximumFractionDigits });
  }
  function resistance(value) {
    if (value >= 1000000 || value < 0.01) return value.toExponential(2);
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function color(value, minimum, maximum) {
    const fraction = maximum === minimum ? 0.65 : Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
    const start = [232, 244, 238], end = [22, 118, 99];
    const rgb = start.map(function (channel, index) { return Math.round(channel + (end[index] - channel) * fraction); });
    const linear = rgb.map(function (channel) { const s = channel / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
    const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    const darkLinear = [23, 57, 47].map(function (channel) { const s = channel / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
    const darkLuminance = 0.2126 * darkLinear[0] + 0.7152 * darkLinear[1] + 0.0722 * darkLinear[2];
    const whiteContrast = 1.05 / (luminance + 0.05), darkContrast = (luminance + 0.05) / (darkLuminance + 0.05);
    return { background: 'rgb(' + rgb.join(',') + ')', foreground: whiteContrast >= darkContrast ? '#ffffff' : '#17392f' };
  }


  const COMPACT=`
  .lig-map-board{margin-inline:auto}.lig-map-table{margin-inline:auto}
  .lig-map-table{width:max-content}.lig-map-table td{min-width:0}.lig-map-table td,.lig-map-table th{padding:6px}.lig-map-table thead th{height:40px}.lig-map-table thead th:first-child,.lig-map-table tbody th{width:88px}.lig-map-group{min-height:78px;padding:8px 9px;gap:3px;margin-bottom:5px}.lig-map-group .map-value{font-size:18px}.lig-map-group .map-id{font-size:10px;overflow-wrap:anywhere}.lig-map-table td.unplanned{height:78px}.lig-map-board{width:fit-content;max-width:100%;padding:16px}.lig-map-toolbar{grid-template-columns:repeat(auto-fit,minmax(140px,200px));gap:12px;padding:13px 16px}.lig-map-fixed{display:flex;align-items:center;min-height:40px;padding:7px 10px;border:1px solid #e2e9e5;border-radius:6px;background:#f8faf8;font:12px var(--mono,Consolas,monospace);color:#334c40}
  @media(max-width:560px){.lig-map-toolbar{grid-template-columns:1fr 1fr;padding:11px;gap:10px}.lig-map-toolbar .lig-map-field:first-child{grid-column:auto}.lig-map-board{padding:12px 9px}.lig-map-table td,.lig-map-table th{padding:5px}.lig-map-group{min-height:76px;padding:7px}.lig-map-group .map-value{font-size:17px}}
  `;
  function valueFor(group,key){
    if(key!=='power')return Number(group[key]);
    const watts=group.measuredPowerW;
    if(typeof watts!=='number'||!Number.isFinite(watts)||watts<=0||!Number.isFinite(watts*1000))return null;
    return Number((watts*1000).toPrecision(15));
  }
  function levels(groups,key){return Array.from(new Set(groups.map(g=>valueFor(g,key)))).filter(v=>v===null?key==='power':Number.isFinite(v)).sort((a,b)=>a===null?1:b===null?-1:a-b);}
  function buildSlice(groups,config){
    const source=config.source||'real',axisX=config.axisX||'spacing',axisY=config.axisY||'speed';
    if(axisX===axisY||![axisX,axisY].every(key=>FIELDS.some(f=>f.key===key)))throw new Error('地图横纵轴须为两个不同加工参数');
    const sourceGroups=groups.filter(g=>!g.deletedAt&&g.qc?.kind!=='run'&&!!g.isDemo===(source==='demo'));
    const fixed=FIELDS.filter(f=>f.key!==axisX&&f.key!==axisY),fixedValues={...config.fixedValues},choices={};let sliceGroups=sourceGroups;
    for(const f of fixed){const values=levels(sliceGroups,f.key);choices[f.key]=values;if(!values.includes(fixedValues[f.key]))fixedValues[f.key]=values[0];sliceGroups=sliceGroups.filter(g=>valueFor(g,f.key)===fixedValues[f.key]);}
    const measured=sourceGroups.map(g=>root.LIGCore.groupStats(g).mean).filter(Number.isFinite);
    return {sourceGroups,sliceGroups,fixed,fixedValues,choices,xLevels:levels(sliceGroups,axisX),yLevels:levels(sliceGroups,axisY).reverse(),scale:{minimum:measured.length?Math.min(...measured):null,maximum:measured.length?Math.max(...measured):null}};
  }
  function mount(container,options){
    if(!container||typeof options.getState!=='function'||typeof options.onSelect!=='function')throw new Error('参数地图缺少挂载容器或回调');
    if(!document.getElementById('lig-parameter-map-style')){const style=el('style');style.id='lig-parameter-map-style';style.textContent=CSS+COMPACT;document.head.append(style);}
    container.classList.add('lig-map');let axisX='spacing',axisY='speed',source=null,fixedValues={};
    const field=key=>key==='spacing'&&options.spacingUnit==='mm'?{key,label:'线间距',unit:'mm'}:FIELDS.find(f=>f.key===key);
    const label=key=>{const f=field(key);return f.label+' / '+f.unit;};
    const formatted=(key,value)=>value===null?'未测':number(value)+' '+field(key).unit;
    function makeField(title,name){const wrapper=el('label','lig-map-field',title),select=el('select');select.setAttribute('aria-label',name);wrapper.append(select);return {wrapper,select};}
    function addOption(select,value,text){const option=el('option','',text);option.value=String(value);select.append(option);}
    function groupButton(group,scale){
      const stats=root.LIGCore.groupStats(group),failed=group.electrical.filter(s=>s.status!=='normal').length;
      const classes=['lig-map-group'];if(group.id===options.getState().selectedId)classes.push('selected');if(stats.mean===null)classes.push('no-data');if(failed)classes.push('has-failure');if(stats.mean===null&&failed)classes.push('failure-only');
      const states=new Set(group.electrical.map(s=>s.status)),failureLabel=states.size===1?({open:'断路',overrange:'超量程',failed:'加工失败'}[group.electrical[0].status]||'无有效值'):'无有效值';
      const text=stats.mean===null?(failed?failureLabel:'未测'):resistance(stats.mean),button=el('button',classes.join(' '));button.type='button';
      if(stats.mean!==null){const paint=color(stats.mean,scale.minimum,scale.maximum);button.style.background=paint.background;button.style.color=paint.foreground;}
      button.append(el('span','map-id',group.id));const value=el('span','map-value',text);if(stats.mean!==null)value.append(el('small','','Ω/□'));
      const detail='测齐 '+stats.n+'/'+group.electrical.length+' 件'+(failed?' · 异常 '+failed:'')+(stats.n>0&&stats.n<group.electrical.length?' · 暂均值':'');button.append(value,el('span','map-detail',detail));
      const coordinates=FIELDS.map(f=>field(f.key).label+' '+formatted(f.key,valueFor(group,f.key))).join('；');button.setAttribute('aria-label',group.id+'，'+text+(stats.mean!==null?' 欧姆每方':'')+'，'+detail+'。'+coordinates+'。打开记录');button.title=coordinates;button.dataset.mapGroup=group.id;button.onclick=()=>options.onSelect(group.id);return button;
    }
    function render(renderOptions){
      const preserve=renderOptions?.preserveSlice===true,oldScroll=container.querySelector('.lig-map-scroll'),scrollPosition=oldScroll?{top:oldScroll.scrollTop,left:oldScroll.scrollLeft}:null;
      const state=options.getState(),groups=(Array.isArray(state.groups)?state.groups:[]).filter(g=>!g.deletedAt&&g.qc?.kind!=='run'),selected=groups.find(g=>g.id===state.selectedId);
      if(source===null){source=selected?.isDemo?'demo':'real';if(selected)for(const f of FIELDS)fixedValues[f.key]=valueFor(selected,f.key);}
      if(groups.length&&!groups.some(g=>!!g.isDemo===(source==='demo'))){source=groups[0].isDemo?'demo':'real';fixedValues={};}
      const data=buildSlice(groups,{source,axisX,axisY,fixedValues});fixedValues=data.fixedValues;
      container.replaceChildren();const title=el('h1','','参数地图');title.id='parameter-map-title';container.setAttribute('aria-labelledby',title.id);container.append(title,el('p','lig-map-intro','选择两轴比较方阻；功率使用记录的实测 mW。点击格子查看记录。'));
      const toolbar=el('div','lig-map-toolbar'),real=groups.filter(g=>!g.isDemo).length,demo=groups.filter(g=>g.isDemo).length;
      if(real&&demo){const control=makeField('数据来源','地图数据来源');addOption(control.select,'real','我的记录');addOption(control.select,'demo','演示数据');control.select.value=source;control.select.onchange=()=>{source=control.select.value;fixedValues={};render();};toolbar.append(control.wrapper);}
      const x=makeField('横轴 X','地图横轴'),y=makeField('纵轴 Y','地图纵轴');for(const f of FIELDS){addOption(x.select,f.key,label(f.key));addOption(y.select,f.key,label(f.key));}x.select.value=axisX;y.select.value=axisY;
      x.select.onchange=()=>{const old=axisX;axisX=x.select.value;if(axisY===axisX)axisY=old;render();};y.select.onchange=()=>{const old=axisY;axisY=y.select.value;if(axisX===axisY)axisX=old;render();};toolbar.append(x.wrapper,y.wrapper);
      for(const f of data.fixed){const values=data.choices[f.key],display=field(f.key);if(values.length<=1){const wrapper=el('div','lig-map-field','固定 '+display.label);wrapper.append(el('span','lig-map-fixed',values.length?formatted(f.key,values[0]):'暂无记录'));toolbar.append(wrapper);}else{const control=makeField('固定 '+label(f.key),'地图固定'+display.label);for(const value of values)addOption(control.select,value===null?'unmeasured':value,formatted(f.key,value));control.select.value=fixedValues[f.key]===null?'unmeasured':String(fixedValues[f.key]);control.select.onchange=()=>{fixedValues[f.key]=control.select.value==='unmeasured'?null:Number(control.select.value);render();};toolbar.append(control.wrapper);}}
      container.append(toolbar);const board=el('section','lig-map-board');board.setAttribute('aria-label','参数切片与方阻结果');const summary=el('div','lig-map-summary');summary.append(el('strong','',data.fixed.map(f=>field(f.key).label+' '+(fixedValues[f.key]===undefined?'—':formatted(f.key,fixedValues[f.key]))).join(' · ')),el('span','lig-map-source-label'+(source==='real'?' real':''),(source==='real'?'我的记录':'演示数据')+' · '+data.sliceGroups.length+' 条'));board.append(summary);
      if(!data.sliceGroups.length)board.append(el('div','lig-map-empty','当前没有可显示的记录，请调整固定参数或数据来源。'));
      else if(data.xLevels.length*data.yLevels.length>MAX_CELLS){board.append(el('p','lig-map-fallback','参数水平较多，已改用当前切片的紧凑列表。'));const list=el('div','lig-map-list');for(const group of data.sliceGroups){const button=groupButton(group,data.scale);button.append(el('span','map-detail',field(axisX).label+' '+formatted(axisX,valueFor(group,axisX))+' · '+field(axisY).label+' '+formatted(axisY,valueFor(group,axisY))));list.append(button);}board.append(list);}
      else{const scroll=el('div','lig-map-scroll');scroll.tabIndex=0;scroll.setAttribute('aria-label','参数水平网格，可横向滚动');const table=el('table','lig-map-table');table.style.width=(88+data.xLevels.length*164)+'px';const cols=el('colgroup'),axis=el('col');axis.style.width='88px';cols.append(axis);for(const _ of data.xLevels){const col=el('col');col.style.width='164px';cols.append(col);}table.append(cols,el('caption','sr-only',label(axisY)+'为行，'+label(axisX)+'为列；同一坐标的多条记录分别显示。'));
        const thead=el('thead'),header=el('tr'),corner=el('th','',field(axisY).label+' ↑ / '+field(axisX).label+' →');corner.scope='col';header.append(corner);for(const value of data.xLevels){const th=el('th','',formatted(axisX,value));th.scope='col';header.append(th);}thead.append(header);table.append(thead);
        const bins=new Map();for(const group of data.sliceGroups){const key=JSON.stringify([valueFor(group,axisX),valueFor(group,axisY)]);if(!bins.has(key))bins.set(key,[]);bins.get(key).push(group);}const tbody=el('tbody');for(const yValue of data.yLevels){const row=el('tr'),th=el('th','',formatted(axisY,yValue));th.scope='row';row.append(th);for(const xValue of data.xLevels){const cell=el('td'),records=bins.get(JSON.stringify([xValue,yValue]))||[];if(!records.length){cell.className='unplanned';cell.textContent='无记录';}else for(const group of records)cell.append(groupButton(group,data.scale));row.append(cell);}tbody.append(row);}table.append(tbody);scroll.append(table);board.append(scroll,el('div','lig-map-axis-title','X：'+label(axisX)+'　·　Y：'+label(axisY)));}
      const legend=el('div','lig-map-key');if(data.scale.minimum!==null){const gradient=el('div','lig-map-gradient-wrap');gradient.append(el('span','',resistance(data.scale.minimum)),el('span','lig-map-gradient'),el('span','',resistance(data.scale.maximum)+' Ω/□'));legend.append(gradient);}for(const [cls,text]of [['','已记录未测'],['failure','异常 / 无有效方阻'],['empty','无记录']]){const item=el('span');item.append(el('span','lig-map-legend-dot '+cls),document.createTextNode(text));legend.append(item);}board.append(legend);
      const missing=data.sourceGroups.filter(g=>valueFor(g,'power')===null).length;board.append(el('p','lig-map-note','离散参数等宽网格，不插值；同坐标记录分别显示。'+(missing?' '+missing+' 条记录未填实测功率，可在功率“未测”水平查看。':'')));container.append(board);
      if(preserve){const scroll=container.querySelector('.lig-map-scroll');if(scroll&&scrollPosition){scroll.scrollTop=scrollPosition.top;scroll.scrollLeft=scrollPosition.left;}Array.from(container.querySelectorAll('[data-map-group]')).find(b=>b.dataset.mapGroup===state.selectedId)?.focus({preventScroll:true});}
    }
    render();return Object.freeze({render});
  }
  root.LIGParameterMap=Object.freeze({mount,buildSlice,valueFor});
})(globalThis);
