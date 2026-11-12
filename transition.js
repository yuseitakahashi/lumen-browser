'use strict';
const PhotoTransition=(()=>{
 const workerURL=new URL('transition-worker.js?v=20261105-transition1',document.currentScript?.src||document.baseURI).href;
 const core=512,halo=128;let worker=null,pending=null,sequence=0,running=false,stopVersion=0;
 const aborted=()=>new DOMException('輪郭補正を中止しました','AbortError');
 function stop(){stopVersion++;worker?.terminate();worker=null;if(pending){pending.reject(aborted());pending=null;}}
 function tile(image,profile,{signal,forceCPU=false}={}){return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(aborted());return;}
  if(!worker){worker=new Worker(workerURL);worker.onmessage=({data})=>{if(pending?.id!==data.id)return;const p=pending;pending=null;data.error?p.reject(Error(data.error)):p.resolve(data);};worker.onerror=e=>{const p=pending;pending=null;worker?.terminate();worker=null;p?.reject(Error('輪郭補正に失敗しました。'+e.message));};}
  const id=++sequence;pending={id,resolve,reject};worker.postMessage({id,w:image.width,h:image.height,buffer:image.data.buffer,profile,forceCPU},[image.data.buffer]);
 });}
 async function restore(source,{profile='medium',signal,onProgress,forceCPU=false}={}){
  if(!['mild','medium','strong'].includes(profile))throw Error('不明な輪郭補正の設定です。');if(running)throw Error('輪郭補正を実行中です。');const w=source?.width,h=source?.height;if(!Number.isInteger(w)||!Number.isInteger(h)||w<2||h<2||!Number.isSafeInteger(w*h))throw Error('輪郭補正の入力寸法が不正です。');running=true;
  const generation=stopVersion,start=performance.now(),stats={method:'guarded-rgb-monotone-transition-v2',profile,w,h,core,halo,tiles:0,gpuTiles:0,cpuTiles:0,workerMs:0,workerMsKnownTileSum:0,workerTimingMissingTiles:0,setupMs:0,setupMsKnownTileSum:0,initMs:0,initMsKnownColdSum:0,gpuPipelineWarmTiles:0,gpuPipelineColdTiles:0,gpuPipelineWarmStatsMissingTiles:0,gpuSetupStatsMissingTiles:0,fallbackReasons:[],applied:false,changedPixels:0,maxCodeChange:0,sourceResampled:false,guardRemaining:0,guardRemainingKnownTileSum:0,guardStatsMissingTiles:0,guardStatsScope:'Sum over processed tile footprints including overlapping halos; not unique source pixels.'};let output;
  const check=()=>{if(signal?.aborted||generation!==stopVersion)throw aborted();};signal?.addEventListener('abort',stop,{once:true});
  try{
   check();output=PhotoEngine.canvas(w,h);const g=PhotoEngine.ctx(output),sg=PhotoEngine.ctx(source),total=Math.ceil(w/core)*Math.ceil(h/core);
   for(let top=0;top<h;top+=core)for(let left=0;left<w;left+=core){
    check();const cw=Math.min(core,w-left),ch=Math.min(core,h-top),x=Math.max(0,left-halo),y=Math.max(0,top-halo),tw=Math.min(w,left+cw+halo)-x,th=Math.min(h,top+ch+halo)-y;
    const input=sg.getImageData(x,y,tw,th),original=input.data.slice();for(let i=3;i<original.length;i+=4)if(original[i]!==255)throw Error('輪郭補正は透明部分のない写真で使えます。');const r=await tile(input,profile,{signal,forceCPU});check();if(!['webgpu','cpu'].includes(r.backend))throw Error('輪郭補正の実行方式を確認できません。');const data=new Uint8ClampedArray(r.buffer);
    if(data.length!==tw*th*4)throw Error('輪郭補正の出力寸法が一致しません。');
    for(let yy=top-y;yy<top-y+ch;yy++)for(let xx=left-x;xx<left-x+cw;xx++){const i=(yy*tw+xx)*4;let changed=false;for(let c=0;c<3;c++){const d=Math.abs(data[i+c]-original[i+c]);changed||=d!==0;stats.maxCodeChange=Math.max(stats.maxCodeChange,d);}if(data[i+3]!==original[i+3])throw Error('輪郭補正で透明度が変化しました。');stats.changedPixels+=Number(changed);}
    g.putImageData(new ImageData(data,tw,th),x,y,left-x,top-y,cw,ch);stats.tiles++;stats[r.backend==='webgpu'?'gpuTiles':'cpuTiles']++;if(Number.isFinite(r.stats?.totalMs)&&r.stats.totalMs>=0){stats.workerMsKnownTileSum+=r.stats.totalMs;if(stats.workerMs!==null)stats.workerMs+=r.stats.totalMs;}else{stats.workerTimingMissingTiles++;stats.workerMs=null;}
    const remaining=r.stats?.guardRemainingBelow20PercentOriginalSlope??r.stats?.guardRemaining;if(Number.isInteger(remaining)&&remaining>=0){stats.guardRemainingKnownTileSum+=remaining;if(stats.guardRemaining!==null)stats.guardRemaining+=remaining;}else{stats.guardStatsMissingTiles++;stats.guardRemaining=null;}
    if(r.backend==='webgpu'){const setupKnown=Number.isFinite(r.stats?.setupMs)&&r.stats.setupMs>=0;if(setupKnown){stats.setupMsKnownTileSum+=r.stats.setupMs;if(stats.setupMs!==null)stats.setupMs+=r.stats.setupMs;}else{stats.gpuSetupStatsMissingTiles++;stats.setupMs=null;}if(r.stats?.pipelineWasWarm===true)stats.gpuPipelineWarmTiles++;else if(r.stats?.pipelineWasWarm===false){stats.gpuPipelineColdTiles++;if(setupKnown){stats.initMsKnownColdSum+=r.stats.setupMs;if(stats.initMs!==null)stats.initMs+=r.stats.setupMs;}else stats.initMs=null;}else{stats.gpuPipelineWarmStatsMissingTiles++;stats.initMs=null;}}
    if(r.reason&&!stats.fallbackReasons.includes(r.reason))stats.fallbackReasons.push(r.reason);onProgress?.(stats.tiles/total,r.backend,r.reason);check();
   }
   stats.applied=stats.changedPixels>0;stats.changedFraction=stats.changedPixels/(w*h);stats.backend=stats.cpuTiles?(stats.gpuTiles?'mixed':'cpu'):'webgpu';stats.totalMs=performance.now()-start;return{canvas:output,stats};
  }catch(e){if(output)output.width=output.height=1;throw e;}finally{signal?.removeEventListener('abort',stop);running=false;}
 }
 return{restore,stop,core,halo};
})();
