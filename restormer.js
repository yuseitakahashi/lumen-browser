'use strict';
// Staged photo adapter: fixed source grid, exact native input, float until warp.
const PhotoRestormer=(()=>{
 const C=RestormerCore,workerURL=new URL('restormer-worker.js',document.currentScript?.src||document.baseURI).href;
 let worker=null,ready=null,pending=null,seq=0,running=false,idle=null,cache=null;
 const maxCacheBytes=192*1024*1024,cacheRecipe=JSON.stringify([workerURL,C.side,C.core,C.halo,C.stride,C.sigma,C.radius,C.amount]);
 const cacheKey=b=>cacheRecipe+':'+[b.x,b.y,b.w,b.h].join(',');
 function clearCache(){cache=null;}
 const abort=()=>new DOMException('ピンぼけ補正を中止しました','AbortError');
 function stop(reason=abort()){clearTimeout(idle);worker?.terminate();worker=null;ready=null;const p=pending;pending=null;p?.reject(reason);}
 function request(message,transfer=[],progress=()=>{}){return new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>stop(Error('補正モデルの応答がありません。処理は停止しました。')),180000);pending={id,progress,resolve:r=>{clearTimeout(t);resolve(r);},reject:e=>{clearTimeout(t);reject(e);}};worker.postMessage({...message,id},transfer);});}
 async function initialize(progress){clearTimeout(idle);if(ready&&worker)return{...ready,reused:true};stop();worker=new Worker(workerURL);worker.onerror=e=>stop(Error(e.message||'補正モデルの実行に失敗しました。'));worker.onmessage=({data:d})=>{if(d.type==='progress'){pending?.progress(d.status);return;}if(d.type==='error'){stop(Error(d.message));return;}if(!pending||d.id!==undefined&&d.id!==pending.id)return;const p=pending;pending=null;p.resolve(d);};ready=await request({type:'init'},[],progress);if(ready.type!=='ready'||ready.backend!=='webgpu'||!ready.cpuFallbackDisabled||ready.side!==576||!/^[0-9a-f]{64}$/i.test(ready.modelSha256||''))throw Error('モデルの実行経路を確認できません。');return{...ready,reused:false};}
 function estimate(quad,w,h){const b=C.bounds(quad,w,h),xs=C.axis(b.x,b.x+b.w),ys=C.axis(b.y,b.y+b.h);return{...b,tiles:xs.length*ys.length,workingPixels:b.w*b.h,sourcePixels:w*h};}
 async function render(file,o,{signal=o.signal,onProgress=()=>{}}={}){
  if(running)throw Error('ピンぼけ補正を処理中です。');running=true;const started=performance.now(),check=()=>{if(signal?.aborted)throw abort();},cancel=()=>stop();signal?.addEventListener('abort',cancel,{once:true});
  let decoded,scratch,output,encoded,returned=false;
  try{
   check();PhotoEngine.validateOutput(o.w,o.h);if(!available)throw Error('この補正にはWebGPU対応のPCブラウザが必要です。');
   // A File object is immutable. Name/size alone must never identify a cache hit.
   let previous=cache?.file===file?cache:null;
   if(!previous){clearCache();decoded=await PhotoEngine.decode(file);check();}
   const W=previous?.sourceW??decoded.bitmap.width,H=previous?.sourceH??decoded.bitmap.height;
   if(!PhotoEngine.validQuad(o.quad,W,H))throw Error('四隅を確認してください。');
   const b=estimate(o.quad,W,H),key=cacheKey(b),hit=previous?.key===key;
   let floats,stats;
   if(hit){
    floats=previous.floats;
    stats={...previous.stats,sourceCrop:b,cacheHit:true,restorationReused:true,inferredTiles:0,inferenceMs:0,filterMs:0,modelLoadMs:0,sessionReused:false,warpMs:0,totalMs:0,
     reusedRestoration:{modelSha256:previous.stats.modelSha256,tiles:previous.stats.tiles,inferenceMs:previous.stats.inferenceMs,filterMs:previous.stats.filterMs,completedAt:previous.stats.restorationCompletedAt}};
    onProgress(.9,'作成済みのぼけ補正を再利用し、現在の調整を反映しています。');
   }else{
    // Keep at most one completed float source, and release it before new work.
    clearCache();previous=null;if(!decoded){decoded=await PhotoEngine.decode(file);check();}
    const source=decoded.bitmap,xs=C.axis(b.x,b.x+b.w),ys=C.axis(b.y,b.y+b.h);
    stats={method:'restormer-defocus-hp4-half-overlap-v1',profile:'restormer',backend:'webgpu',applied:true,sourceDimensions:{w:W,h:H},sourceCrop:b,analysisSampling:'original-image-grid',cropResampled:false,geometryResampleCount:1,side:576,core:320,halo:128,stride:160,globalGridOrigin:[0,0],sigma:4,amount:.5,tiles:0,inferredTiles:0,inferenceMs:0,filterMs:0,fallbackReason:null,cacheHit:false,restorationReused:false};
    onProgress(0,'ピンぼけ補正モデルを端末へ読込中。写真は送信しません。');const setup=await initialize(s=>onProgress(0,s));check();Object.assign(stats,{modelSha256:setup.modelSha256,cpuFallbackDisabled:setup.cpuFallbackDisabled,ortVersion:setup.ortVersion,modelLoadMs:setup.reused?0:setup.loadMs,sessionReused:setup.reused});
   // The output is a float source for the existing engine. The accumulator is
   // only 320 scanlines, even for a 48MP photograph. No input resize.
   floats=new Float32Array(b.w*b.h*4);const ring=new Float64Array(b.w*C.core*4),recentTileMs=[];scratch=PhotoEngine.canvas(576,576);let g=PhotoEngine.ctx(scratch),nextRow=b.y;
   const ringRow=y=>((y%C.core)+C.core)%C.core;
   function flush(end){for(;nextRow<Math.min(end,b.y+b.h);nextRow++){const r=ringRow(nextRow)*b.w*4,d=(nextRow-b.y)*b.w*4;for(let x=0;x<b.w;x++){const p=r+x*4,q=d+x*4,weight=ring[p+3];if(!(weight>0))throw Error('分割画像に未処理の画素があります。');floats[q]=ring[p]/weight;floats[q+1]=ring[p+1]/weight;floats[q+2]=ring[p+2]/weight;floats[q+3]=255;ring[p]=ring[p+1]=ring[p+2]=ring[p+3]=0;}}}
   for(const top of ys){for(const left of xs){
    check();const tileStarted=performance.now(),xx=Array.from({length:576},(_,i)=>C.reflect(left-C.halo+i,W)),yy=Array.from({length:576},(_,i)=>C.reflect(top-C.halo+i,H));
    const sx=Math.min(...xx),sy=Math.min(...yy),sw=Math.max(...xx)-sx+1,sh=Math.max(...yy)-sy+1;scratch.width=sw;scratch.height=sh;g.drawImage(source,sx,sy,sw,sh,0,0,sw,sh);const rgba=g.getImageData(0,0,sw,sh).data,plane=576*576,a=new Float32Array(plane*3);
    for(let y=0;y<576;y++)for(let x=0;x<576;x++){const p=((yy[y]-sy)*sw+xx[x]-sx)*4,q=y*576+x;if(rgba[p+3]!==255)throw Error('透過画像にはピンぼけ補正を適用できません。');a[q]=rgba[p]/255;a[q+plane]=rgba[p+1]/255;a[q+2*plane]=rgba[p+2]/255;}
    const r=await request({type:'infer',values:a.buffer},[a.buffer]);check();if(r.type!=='result'||r.backend!=='webgpu'||r.modelSha256!==setup.modelSha256||r.side!==320||r.values?.byteLength!==320*320*3*4)throw Error('補正出力を確認できません。');const c=new Float32Array(r.values);
    const l=Math.max(left,b.x),right=Math.min(left+C.core,b.x+b.w),t=Math.max(top,b.y),bottom=Math.min(top+C.core,b.y+b.h);
    for(let y=t;y<bottom;y++)for(let x=l;x<right;x++){const p=(ringRow(y)*b.w+x-b.x)*4,q=((y-top)*C.core+x-left)*3,w=C.window[y-top]*C.window[x-left];ring[p]+=c[q]*w;ring[p+1]+=c[q+1]*w;ring[p+2]+=c[q+2]*w;ring[p+3]+=w;}
    stats.tiles++;stats.inferredTiles++;stats.inferenceMs+=r.inferenceMs;stats.filterMs+=r.filterMs;
    // Exclude model download/setup and the first inference warm-up from ETA.
    // The measured tile interval includes extraction, transfer, inference,
    // filtering and accumulation. Keep the last eight completed intervals.
    if(stats.tiles>1){recentTileMs.push(performance.now()-tileStarted);if(recentTileMs.length>8)recentTileMs.shift();}
    const seconds=(performance.now()-started)/1000,remaining=recentTileMs.length>=3?Math.ceil(recentTileMs.reduce((a,b)=>a+b,0)/recentTileMs.length*(b.tiles-stats.tiles)/1000):null;
    onProgress(.9*stats.tiles/b.tiles,`ピンぼけ補正 ${stats.tiles}/${b.tiles}領域・${seconds.toFixed(0)}秒${remaining!==null?'・推論の残り目安'+remaining+'秒':'・残り時間を計測中'}。中止できます。`);
   }flush(top+C.stride);}flush(b.y+b.h);check();decoded.bitmap.close();decoded=null;scratch.width=scratch.height=1;
   }
   onProgress(.9,hit?'作成済みのぼけ補正を再利用し、傾きと保存寸法を調整中。':'元の画素精度を保って傾きと保存寸法を調整中。');const warp=performance.now();const source={width:b.w,height:b.h,floatRGBA:floats},options={...o,quad:o.quad.map(p=>({x:p.x-b.x,y:p.y-b.y})),signal,onProgress:p=>onProgress(.9+.1*p,'傾きと保存寸法を調整中。')};if(o.streamOutput)encoded=await PhotoLargeOutput.render(source,options,{signal,onProgress:(p,t)=>onProgress(.9+.1*p,t)});else output=await PhotoEngine.render(source,options);check();stats.warpMs=performance.now()-warp;stats.totalMs=performance.now()-started;
   if(!hit){stats.restorationCompletedAt=new Date().toISOString();stats.cacheStored=floats.byteLength<=maxCacheBytes;if(stats.cacheStored)cache={file,key,sourceW:W,sourceH:H,floats,stats:{...stats}};}
   returned=true;return{canvas:output,...encoded,stats};
  }catch(e){stop(e);throw e;}finally{signal?.removeEventListener('abort',cancel);decoded?.bitmap.close();if(scratch)scratch.width=scratch.height=1;if(output&&!returned)output.width=output.height=1;if(encoded&&!returned)await encoded.dispose?.().catch(()=>{});running=false;if(worker)idle=setTimeout(stop,30000);}
 }
 const available=typeof Worker!=='undefined'&&!!navigator.gpu;
 window.addEventListener('beforeunload',()=>{clearCache();stop();});
 return{render,estimate,stop,clearCache,available,maxCacheBytes};
})();
