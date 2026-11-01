(function(root){
  'use strict';
  function node(tag,className,text){const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;}
  function mount(options){
    const dialog=node('dialog','details-dialog'),head=node('div','dialog-head'),heading=node('div'),title=node('h2','','自动备份'),hint=node('p','','每天北京时间22:00保存云端快照；每日保留30份，手动保留7份。'),close=node('button','icon-btn','✕');
    dialog.setAttribute('aria-label','自动备份');close.type='button';close.setAttribute('aria-label','关闭自动备份');close.onclick=()=>dialog.close();heading.append(title,hint);head.append(heading,close);
    const body=node('div','dialog-body'),message=node('p','field-help'),list=node('div'),error=node('p','form-error'),footer=node('div','dialog-actions'),refresh=node('button','btn','刷新记录'),create=node('button','btn primary','立即备份');
    message.textContent='备份以已同步到云端的数据为准，保存在独立数据库中。可下载历史JSON，原始读数、备注、镜头、回收站和测量转换前记录都保留。';error.setAttribute('role','alert');body.append(message,list,error);refresh.type=create.type='button';footer.append(refresh,create);dialog.append(head,body,footer);document.body.append(dialog);
    let busy=false;
    async function request(method='GET'){
      const response=await fetch('/api/backups',{method,credentials:'same-origin',headers:method==='POST'?{'Content-Type':'application/json'}:{Accept:'application/json'},...(method==='POST'?{body:'{}'}:{})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'暂时无法读取自动备份，请稍后重试。');return result;
    }
    async function render(){
      list.replaceChildren(node('p','field-help','正在读取云端备份…'));error.textContent='';
      try{
        const result=await request();list.replaceChildren();
        if(!result.backups.length)list.append(node('p','field-help','还没有云端快照。可以先点“立即备份”。'));
        for(const backup of result.backups){
          const row=node('div','trash-row'),info=node('div','trash-info'),link=node('a','btn','下载JSON');
          const timestamp=new Date(backup.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
          info.append(node('strong','',timestamp),node('p','',`${backup.kind==='daily'?'每日快照':'手动/首次快照'} · 版本 ${backup.revision} · ${(backup.bytes/1024).toFixed(1)} KB`));
          link.href='/api/backups/'+encodeURIComponent(backup.id);link.download='';link.setAttribute('aria-label','下载备份 '+timestamp);row.append(info,link);list.append(row);
        }
      }catch(problem){list.replaceChildren();error.textContent=problem.message;}
    }
    refresh.onclick=()=>{if(!busy)render();};
    create.onclick=async()=>{
      if(busy)return;busy=true;create.disabled=true;error.textContent='';
      try{if(await options.beforeCreate()===false)return;const result=await request('POST');if(result.empty){error.textContent='云端还没有已保存的记录，请先同步实验数据。';return;}await render();}
      catch(problem){error.textContent=problem.message;}finally{busy=false;create.disabled=false;}
    };
    return {open(){dialog.showModal();render();}};
  }
  root.LIGBackupUI=Object.freeze({mount});
})(globalThis);
