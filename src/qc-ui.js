(function(root){
  'use strict';
  const C=root.LIGCore;
  function mount(options){
    const make=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
    const number=value=>value===null||value===undefined?'—':Number(value).toLocaleString('en-US',{maximumFractionDigits:2});
    const button=(text,action,cls='btn')=>{const node=make('button',cls,text);node.type='button';node.onclick=action;return node;};
    const dialog=make('dialog','details-dialog');dialog.setAttribute('aria-label','QC参考库');
    const head=make('div','dialog-head'),heading=make('div');heading.append(make('h2','','QC参考库'),make('p','','参考记录保留实验用途；日常QC用于加工前对照。'));
    const close=button('✕',()=>dialog.close(),'icon-btn');close.setAttribute('aria-label','关闭QC参考库');head.append(heading,close);
    const body=make('div','dialog-body'),intro=make('p','field-help'),list=make('div'),error=make('p','form-error');error.setAttribute('role','alert');body.append(intro,list,error);dialog.append(head,body);document.body.append(dialog);
    let mode='library';
    function start(ref){if(!options.canChange())return;dialog.close();options.onRecord(ref);}
    function render(){
      const state=options.getState(),references=state.qcReferences||[];list.replaceChildren();error.textContent='';
      intro.textContent=mode==='record'?'选择本次使用的QC参考。仅沿用固定加工参数；功率和方阻重新测量。':'在记录的“⋯”中选择“将此数据设为QC参考”。参考资料保留设置时的原始读数与加工参数。';
      if(!references.length)list.append(make('p','qc-empty','还没有QC参考。请先在一条实验记录的“⋯”菜单中设置。'));
      for(const ref of references){
        if(mode==='record'&&ref.archived)continue;
        const g=ref.snapshot,stats=C.groupStats(g),row=make('div','qc-reference'+(ref.archived?' archived':''));
        row.append(make('strong','qc-heading',ref.id+(ref.archived?' · 已停用':'')),make('p','',`参考方阻 ${number(stats.mean)} Ω/□ · 来源 ${g.id} · ${g.date}`),make('p','field-help',options.recipe(g)));
        if(stats.mean===null)row.append(make('p','field-help','参考记录尚无完整样品均值；可以记录QC，方阻差值暂留空。'));
        const actions=make('div','qc-actions');
        if(!ref.archived)actions.append(button('记录今日QC',()=>start(ref),'btn qc-button'));
        if(mode==='library'){
          actions.append(button('查看参考读数',()=>showReference(ref)));
          actions.append(button(ref.archived?'启用参考':'停用参考',()=>{try{if(!options.canChange())return;options.commit({...state,qcReferences:state.qcReferences.map(r=>r.id===ref.id?{...r,archived:!r.archived}:r)});render();}catch(problem){error.textContent=problem.message;}}));
          actions.append(button('导出QC对照',()=>{try{options.exportQC(ref);}catch(problem){error.textContent=problem.message;}}));
        }
        row.append(actions);list.append(row);
      }
      if(mode==='record'&&references.length&&!references.some(ref=>!ref.archived))list.append(make('p','qc-empty','参考均已停用，请先到QC参考库启用或设置新的参考。'));
    }
    const confirm=make('dialog');confirm.setAttribute('aria-label','将此数据设为QC参考');
    const ch=make('div','dialog-head');ch.append(make('h2','','将此数据设为QC参考'));
    const cb=make('div','dialog-body'),summary=make('p'),hint=make('p','field-help','此条记录及全部读数继续进入参数地图和普通训练导出。QC参考库另保存设置时的资料；后续改动原记录不会改写已保存的参考。'),ce=make('p','form-error');ce.setAttribute('role','alert');cb.append(summary,hint,ce);
    const foot=make('div','dialog-actions');let sourceId=null;
    foot.append(button('取消',()=>confirm.close()),button('设为QC参考',()=>{try{if(!options.canChange())return;options.commit(C.addQCReference(options.getState(),sourceId));confirm.close();options.toast('已设为QC参考，原实验数据与读数保留。');}catch(problem){ce.textContent=problem.message;}},'btn qc-button'));
    confirm.append(ch,cb,foot);document.body.append(confirm);
    const viewer=make('dialog','details-dialog');viewer.setAttribute('aria-label','QC参考读数');
    const vh=make('div','dialog-head'),vt=make('h2'),vc=button('✕',()=>viewer.close(),'icon-btn');vc.setAttribute('aria-label','关闭QC参考读数');vh.append(vt,vc);
    const vb=make('div','dialog-body');viewer.append(vh,vb);document.body.append(viewer);
    function showReference(ref){
      vt.textContent=ref.id+' · 参考读数';vb.replaceChildren(make('p','field-help',options.recipe(ref.snapshot)));
      const table=make('table','measurement-table'),header=make('tr');header.append(make('th','','测量次数'));ref.snapshot.electrical.forEach((sample,i)=>header.append(make('th','','样品'+(i+1))));table.append(header);
      for(let i=0;i<ref.snapshot.measurementPlan.readingsPerSample;i++){const row=make('tr');row.append(make('th','','第'+(i+1)+'次'));for(const sample of ref.snapshot.electrical)row.append(make('td','',sample.values[i]||'—'));table.append(row);}
      const means=make('tr','measurement-means');means.append(make('th','','样品均值'));for(const sample of ref.snapshot.electrical)means.append(make('td','',sample.status==='normal'?number(C.sampleMean(sample)):sample.status));table.append(means);
      const wrap=make('div','measurement-scroll');wrap.append(table);vb.append(wrap,make('p','field-help',`参考方阻 ${number(C.groupStats(ref.snapshot).mean)} Ω/□ · 保存于 ${new Date(ref.createdAt).toLocaleString()}`));viewer.showModal();
    }
    function comparison(group,container){
      container.replaceChildren();if(!group.qc)return;
      const note=make('div','qc-comparison');
      if(group.qc.kind==='reference')note.append(make('strong','',group.qc.referenceId+' · QC参考'),make('p','','这条实验记录继续进入地图和训练导出。QC参考库保存了设置时的资料。'));
      else{
        const mean=C.groupStats(group).mean,baseline=group.qc.baseline,delta=mean!==null&&baseline.mean!==null?mean-baseline.mean:null;
        const change=delta===null?null:delta/baseline.mean*100;
        note.append(make('strong','',group.qc.referenceId+' · 本次QC对照'),make('p','',`参考方阻 ${number(baseline.mean)} Ω/□　 本次 ${number(mean)} Ω/□`),make('p','',`差值 ${delta!==null&&delta>0?'+':''}${number(delta)} Ω/□　 变化 ${change!==null&&change>0?'+':''}${number(change)}%`),make('p','field-help',`参考功率 ${number(baseline.measuredPowerW===null?null:baseline.measuredPowerW*1000)} mW · 本次功率 ${number(group.measuredPowerW===null?null:group.measuredPowerW*1000)} mW；仅对照，不自动判定合格。`));
      }
      container.append(note);
    }
    return {
      open(record=false){if(!options.canChange())return;mode=record?'record':'library';render();dialog.showModal();},
      setReference(id){sourceId=id;const g=options.getState().groups.find(g=>g.id===id);summary.textContent=`${id} · 平均方阻 ${number(C.groupStats(g).mean)} Ω/□；${g.electrical.length} 件电学样品。`;ce.textContent='';confirm.showModal();},
      unmark(id){if(!options.canChange())return;try{options.commit(C.unmarkQC(options.getState(),id));options.toast('已取消QC标记，原始读数保留；历史关联和参考快照保留。');}catch(problem){options.toast(problem.message);}},
      comparison
    };
  }
  root.LIGQCUI=Object.freeze({mount});
})(globalThis);
