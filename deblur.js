'use strict';
const PhotoDeblur=(()=>{
 const workerURL=new URL('deblur-worker.js?v=20261105-candidate2',document.currentScript?.src||document.baseURI).href;
 let worker=null,seq=0,pending=null,running=false;const core=512,halo=96;
 const abort=()=>new DOMException('ぼけ軽減を中止しました','AbortError');
 function stop(){worker?.terminate();worker=null;if(pending){pending.reject(abort());pending=null;}}
 function tile(image,parameters,signal,forceCPU){return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(abort());return;}if(!worker){worker=new Worker(workerURL);worker.onmessage=({data})=>{if(pending?.id!==data.id)return;const p=pending;pending=null;data.error?p.reject(Error(data.error)):p.resolve(data);};worker.onerror=e=>{const p=pending;pending=null;worker?.terminate();worker=null;p?.reject(Error('ぼけ軽減の処理に失敗しました。'+e.message));};}
  const id=++seq;pending={id,resolve,reject};worker.postMessage({id,buffer:image.data.buffer,w:image.width,h:image.height,profile:parameters,forceCPU},[image.data.buffer]);
 });}
 async function restore(source,{profile='weak',file,signal,onProgress,forceCPU=false}={}){
  if(!DeblurCore.profiles[profile])throw Error('不明なぼけ軽減設定です。');if(running)throw Error('ぼけ軽減を処理中です。');running=true;
  const started=performance.now(),w=source.width,h=source.height,stats={profile,w,h,core,halo,tiles:0,gpuTiles:0,cpuTiles:0,workerMs:0,initMs:0,fallbackReasons:[],applied:true};let out;
  const onAbort=()=>stop();signal?.addEventListener('abort',onAbort,{once:true});
  try{
   let parameters=profile;
   if(profile==='auto'){
    const analysis=await PhotoAdaptive.analyze(source,{file,signal,onProgress:p=>onProgress?.(p*.05,'analysis',null)});stats.analysis=analysis;stats.applied=analysis.applied;
    if(!analysis.applied){stats.totalMs=performance.now()-started;stats.backend='none';return{canvas:null,stats};}
    parameters=analysis.parameters;
   }
   out=PhotoEngine.canvas(w,h);const g=PhotoEngine.ctx(out),sg=PhotoEngine.ctx(source);
   for(let top=0;top<h;top+=core)for(let left=0;left<w;left+=core){if(signal?.aborted)throw abort();const cw=Math.min(core,w-left),ch=Math.min(core,h-top),x=Math.max(0,left-halo),y=Math.max(0,top-halo),tw=Math.min(w,left+cw+halo)-x,th=Math.min(h,top+ch+halo)-y;
    const image=sg.getImageData(x,y,tw,th),r=await tile(image,parameters,signal,forceCPU);if(signal?.aborted)throw abort();const data=new ImageData(new Uint8ClampedArray(r.buffer),tw,th);g.putImageData(data,x,y,left-x,top-y,cw,ch);stats.tiles++;stats.workerMs+=r.ms;stats.initMs=Math.max(stats.initMs,r.initMs||0);stats[r.backend==='webgpu'?'gpuTiles':'cpuTiles']++;if(r.reason&&!stats.fallbackReasons.includes(r.reason))stats.fallbackReasons.push(r.reason);onProgress?.(Math.min(1,stats.tiles/(Math.ceil(w/core)*Math.ceil(h/core))),r.backend,r.reason);
   }
   stats.totalMs=performance.now()-started;stats.backend=stats.cpuTiles?(stats.gpuTiles?'mixed':'cpu'):'webgpu';return{canvas:out,stats};
  }catch(e){if(out)out.width=out.height=1;throw e;}finally{signal?.removeEventListener('abort',onAbort);running=false;}
 }
 return{restore,stop,profiles:DeblurCore.profiles};
})();
