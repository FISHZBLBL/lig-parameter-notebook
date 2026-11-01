const assert=require('node:assert/strict');
require('./shared/core.js');require('./shared/cloud-sync.js');
const C=globalThis.LIGCore;
(async()=>{
const group=C.createGroup({power:3,powerMode:'percent',arrayPercent:100,speed:100,frequency:726.314,spacing:25},[]);delete group.lens;
const old={version:3,groups:[group],selectedId:group.id};let current=C.validateState(old),posted;
const entries=new Map([['queue',JSON.stringify({cacheVersion:1,state:old,dirty:true,revision:0,remoteState:{version:3,groups:[],selectedId:''},generation:1})]]);
const cloud=globalThis.LIGCloud.mount({cacheKey:'queue',normalize:C.validateState,getState:()=>current,onRemote:s=>{current=s;},storage:{getItem:k=>entries.get(k)||null,setItem:(k,v)=>entries.set(k,v)},eventTarget:null,document:null,
fetch:async(url,request)=>{if(request.method==='GET')return new Response(JSON.stringify({state:null,revision:0}),{headers:{'Content-Type':'application/json'}});posted=JSON.parse(request.body);assert.equal(request.headers['X-LIG-Client-Version'],'qc-records-v5');return new Response(JSON.stringify({state:C.validateState(posted.state),revision:1}),{headers:{'Content-Type':'application/json'}});}});
await cloud.start();assert.equal(cloud.status().kind,'synced');assert.equal(cloud.status().dirty,false);assert.equal(posted.state.groups[0].frequency,726.314);assert.equal(posted.state.groups[0].spacing,25);assert.equal(posted.state.groups[0].lens,null);assert.deepEqual(posted.state.lenses,[]);
console.log('PASS: pre-lens offline queue upgrades before CAS submission without losing exact parameters or producing false save errors.');
})().catch(error=>{console.error(error);process.exitCode=1;});
