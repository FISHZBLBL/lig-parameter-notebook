(function(root){
  'use strict';
  const C=root.LIGCore;
  function mount(options){
    const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
    const dialog=make('dialog','details-dialog');dialog.setAttribute('aria-label','镜头库');
    const head=make('div','dialog-head'),title=make('div');title.append(make('h2','','镜头库'),make('p','','记录镜头资料；实验记录保留选择时的资料。'));
    const close=make('button','icon-btn','✕');close.type='button';close.setAttribute('aria-label','关闭镜头库');close.onclick=()=>dialog.close();head.append(title,close);
    const body=make('div','dialog-body'), list=make('div'),add=make('button','btn','＋ 添加镜头');add.type='button';
    const libraryError=make('p','form-error');libraryError.setAttribute('role','alert');body.append(add,list,libraryError);dialog.append(head,body);document.body.append(dialog);
    const editor=make('dialog');editor.setAttribute('aria-label','镜头资料');
    const form=make('form'),eh=make('div','dialog-head');eh.append(make('h2','','镜头资料'));
    const eb=make('div','dialog-body'),grid=make('div','form-grid'),inputs={};
    for(const [key,label,type]of[['name','名称 / 型号（保留原始标注）','text'],['magnification','倍率 / X','number'],['numericalAperture','数值孔径 / NA','number'],['focalLengthMM','实际焦距 / mm（确认后填）','number'],['spotDiameterUM','实测光斑直径 / μm','number'],['notes','备注（选填）','text']]){
      const wrap=make('label','field'+(key==='name'||key==='notes'?' full':''),label),input=make('input');input.type=type;input.setAttribute('aria-label',label);
      if(type==='number'){input.min='0';input.step='any';input.inputMode='decimal';input.placeholder='未知可留空';}else input.maxLength=key==='name'?100:1500;
      input.required=key==='name';wrap.append(input);grid.append(wrap);inputs[key]=input;
    }
    const hint=make('p','field-help','光斑直径请填实测值；仅有焦距时不自动推算光斑。'),error=make('p','form-error');error.setAttribute('role','alert');eb.append(grid,hint,error);
    const foot=make('div','dialog-actions'),cancel=make('button','btn','取消'),save=make('button','btn primary','保存镜头');cancel.type='button';cancel.onclick=()=>editor.close();save.type='submit';foot.append(cancel,save);form.append(eh,eb,foot);editor.append(form);document.body.append(editor);
    let editId=null;
    function edit(lens){editId=lens?.id||null;error.textContent='';for(const key of Object.keys(inputs))inputs[key].value=lens?.[key]??'';editor.showModal();}
    function render(){
      list.replaceChildren();const lenses=options.getState().lenses||[];
      if(!lenses.length)list.append(make('p','field-help','还没有镜头。可以先添加名称，焦距和光斑以后补充。'));
      for(const lens of lenses){
        const row=make('div','trash-row'),info=make('div','trash-info');info.append(make('strong','',lens.name+(lens.archived?'（已停用）':'')),make('p','',`倍率 ${lens.magnification??'—'}X · NA ${lens.numericalAperture??'—'} · 实际焦距 ${lens.focalLengthMM??'—'} mm · 实测光斑 ${lens.spotDiameterUM??'—'} μm`));
        if(lens.notes)info.append(make('small','',lens.notes));
        const actions=make('div','lens-actions'),editButton=make('button','btn','编辑'),archive=make('button','btn',lens.archived?'启用':'停用');editButton.type=archive.type='button';
        editButton.setAttribute('aria-label','编辑镜头 '+lens.name);editButton.onclick=()=>edit(lens);
        archive.onclick=()=>{try{options.onChange(lenses.map(item=>item.id===lens.id?{...item,archived:!item.archived}:item));render();}catch(problem){libraryError.textContent=problem.message;}};
        actions.append(editButton,archive);row.append(info,actions);list.append(row);
      }
    }
    add.onclick=()=>edit(null);
    form.onsubmit=event=>{
      event.preventDefault();try{
        const lenses=options.getState().lenses||[],old=lenses.find(lens=>lens.id===editId);
      const lens=C.validateLens({id:editId||'L'+crypto.randomUUID(),...Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.value])),archived:old?.archived||false});
        if(lenses.some(item=>item.id!==lens.id&&item.name.toLocaleLowerCase()===lens.name.toLocaleLowerCase()))throw new Error('镜头名称已存在，请加上区分名称。');
        options.onChange(editId?lenses.map(item=>item.id===editId?lens:item):lenses.concat(lens),lens.id);editor.close();render();
      }catch(problem){error.textContent=problem.message;}
    };
    return {open(){render();dialog.showModal();}};
  }
  root.LIGLensLibrary=Object.freeze({mount});
})(globalThis);
