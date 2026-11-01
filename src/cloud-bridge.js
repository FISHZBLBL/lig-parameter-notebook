  function displayCloudStatus(next) {
    cloudStatus=next;
    if(!['idle','loading'].includes(next.kind))cloudReady=true;
    if(next.revision>0)cloudHasRecords=true;
    updateSaveStatus();
    if(pendingCloud||pendingExternal||protectUnreadable)return;
    const box=$('cloud-notice');box.replaceChildren();
    const messages={
      loading:'正在读取云端记录…',
      'needs-upload':'云端还没有记录。此设备已有 '+state.groups.filter(g=>!g.isDemo).length+' 行实验记录，可上传后在其他设备使用。',
      offline:'暂时无法连接云端，修改保留在此设备，恢复连接后会重试。',
      'auth-required':'登录已过期。本机修改仍保留，请重新登录后继续同步。',
      error:next.error?.message||'云端同步暂未成功，本机记录仍保留。'
    };
    const message=messages[next.kind];box.hidden=!message;if(!message)return;
    box.append(el('span','',message));
    if(next.kind==='needs-upload') {
      const button=el('button','btn','上传此设备记录');button.addEventListener('click',()=>{cloud.queue(C.validateState(state));cloud.flush();});box.append(button);
    } else if(next.kind==='auth-required') {
      const button=el('button','btn','重新登录');button.addEventListener('click',()=>location.reload());box.append(button);
    } else if(['offline','error'].includes(next.kind)) {
      const button=el('button','btn','重试同步');button.addEventListener('click',()=>cloud.retry());box.append(button);
    }
  }
  function applyCloudState(incoming,meta) {
    const normalized=C.validateState(incoming);
    if(drafts.size&&meta.source!=='local-cache'){
      showCloudConflict({localState:state,remoteState:normalized,revision:meta.revision});return;
    }
    state=normalized;cloudHasRecords=meta.revision>0;
    localStorage.setItem(KEY,JSON.stringify(state));storageOK=true;
    document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());
    if((!cloudReady&&state.groups.some(g=>!g.isDemo))||!state.groups.some(g=>source==='demo'?g.isDemo:!g.isDemo))source=state.groups.some(g=>!g.isDemo)?'real':'demo';
    $('source-filter').value=source;
    renderRecords();if(activeView==='map')mapUI.render();
  }
  function showCloudConflict(conflict) {
    pendingCloud=conflict;
    document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());
    const box=$('cloud-notice');box.hidden=false;box.replaceChildren(el('span','','另一台设备已更新记录。本机修改已保留，请先备份，再载入云端版本。 '));
    const button=el('button','btn','备份本机并载入云端');
    button.addEventListener('click',()=>{
      const snapshot=pendingCloud;if(!snapshot)return;
      download(JSON.stringify({...state,unsavedInputs:Array.from(drafts.entries())},null,2),'application/json',`LIG_云同步冲突备份_${today()}.json`);
      const remote=C.validateState(snapshot.remoteState);pendingCloud=null;pendingExternal=null;drafts.clear();
      cloud.queue(remote);applyCloudState(remote,{source:'remote',revision:snapshot.revision});
      box.hidden=true;toast('已下载本机备份并载入云端记录。需要合并的记录可用“导入备份”追加。');
    });box.append(button);updateSaveStatus();
  }
  function startCloud() {
    if(protectUnreadable)return;
    cloud=LIGCloud.mount({
      cacheKey:'lig-cloud-outbox-v1',
      normalize:C.validateState,
      getState:()=>C.validateState(state),
      onRemote:applyCloudState,
      onStatus:displayCloudStatus,
      onConflict:showCloudConflict,
      onError:()=>updateSaveStatus()
    });
    cloud.start().then(()=>{
      if(!['synced','empty'].includes(cloud.status().kind))return;
      const legacy=state.groups.filter(C.canConvertLegacy);
      if(legacy.length){
        // Require a durable full pre-conversion copy before changing any experimental meaning.
        localStorage.setItem(KEY+'-before-sample-repeats-v4',JSON.stringify(state));
        const next=C.validateState({...state,groups:state.groups.map(g=>C.canConvertLegacy(g)?C.convertLegacyReadings(g):g)});
        commitRecordChange(next);renderRecords();cloud.flush();
        toast(`已将 ${legacy.length} 组旧版五格转为样品1的五次读数；原记录已备份。`);
      }
      const skipped=state.groups.filter(g=>!g.isDemo&&!g.deletedAt&&!g.measurementArchive&&!g.measurementLayout&&g.electrical.length===5&&g.measurementPlan.readingsPerSample===1);
      if(skipped.length){$('storage-warning').hidden=false;$('storage-warning').textContent=`${skipped.length} 组旧记录含异常状态，未自动合并；原读数与状态完整保留，请在样品详情核对。`;}
      if(state.lenses.length)return;
      const lens=C.validateLens({id:'objective-10x-na030-f200',name:'10X/0.30 · f=200',magnification:10,numericalAperture:0.30,focalLengthMM:null,spotDiameterUM:null,notes:'用户提供原始标注：10X/0.30 f=200。f=200的单位及物镜/管镜含义待核实，不作为已确认实际焦距，不据此推算光斑。'});
      commitRecordChange({...state,lenses:[lens]});renderRecords();cloud.flush();
    }).catch(error=>toast('初始资料更新未完成，原记录保留：'+error.message));
    $('sync-now').addEventListener('click',()=>{$('more-menu').open=false;cloud.retry();});
    $('sign-out').addEventListener('click',async()=>{
      if(drafts.size){toast('请先修正输入或下载备份。');return;}
      await cloud.flush();
      if(cloud.status().dirty){toast('还有修改未同步，请先备份或等待同步完成。');return;}
      try {
        const response=await fetch('/auth/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});
        if(response.ok){location.replace('/');return;}
        if(response.status!==404){toast('退出登录暂未完成，请重试。');return;}
      } catch {toast('网络连接暂不可用，尚未退出登录。');return;}
      location.assign('/cdn-cgi/access/logout');
    });
    setInterval(()=>{
      if(document.visibilityState==='visible'&&!drafts.size&&!pendingCloud&&!pendingExternal&&!document.querySelector('dialog[open]')&&document.activeElement?.tagName!=='INPUT'&&document.activeElement?.tagName!=='TEXTAREA')cloud.retry();
    },30000);
  }
