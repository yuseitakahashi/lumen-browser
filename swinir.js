'use strict';
// Optional resolution-deficit candidate. Photos stay on this device; the worker
// downloads only the fixed static model/runtime assets from this site.
const PhotoSwinIR=(()=>{
 const workerURL=new URL('swinir-worker.js?v=20261105-swinir1',document.currentScript?.src||document.baseURI).href;
 const N=512,halo=104,core=304;
 let worker=null,ready=null,provider=null,pending=null,seq=0,running=false,idle=null,lastStats=null,cache=null;
 const maxCacheBytes=192*1024*1024,cacheRecipe=JSON.stringify([workerURL,N,halo,core,2]);
 const cacheKey=b=>cacheRecipe+':'+[b.x,b.y,b.w,b.h].join(',');
 function clearCache(){cache=null;}
 const abort=()=>new DOMException('SwinIRの処理を中止しました','AbortError');
 function stop(reason=abort()){clearTimeout(idle);worker?.terminate();worker=null;ready=null;provider=null;if(pending){const p=pending;pending=null;p.reject(reason instanceof Error||reason instanceof DOMException?reason:abort());}}
 function estimate(quad,w,h){
  if(!PhotoEngine.validQuad(quad,w,h))throw Error('四隅を見直してください。');
  const x=Math.max(0,Math.floor((Math.min(...quad.map(p=>p.x))-halo)/8)*8),y=Math.max(0,Math.floor((Math.min(...quad.map(p=>p.y))-halo)/8)*8);
  const right=Math.min(w,Math.ceil((Math.max(...quad.map(p=>p.x))+halo)/8)*8),bottom=Math.min(h,Math.ceil((Math.max(...quad.map(p=>p.y))+halo)/8)*8);
  return{x,y,w:right-x,h:bottom-y,pixels:(right-x)*(bottom-y),tiles:Math.ceil((right-x)/core)*Math.ceil((bottom-y)/core),halo,core,tileSize:N};
 }
 function validate(o,d,source){
  if(!available)throw Error('SwinIRにはWebGPU対応のブラウザとGPUが必要です。スーパー解像度をオフにすると通常処理で続けられます。');
  PhotoEngine.validateOutput(o.w,o.h);
  if(o.w!==d.w*2||o.h!==d.h*2)throw Error('SwinIRは作品領域の2倍出力だけです。');
  const b=estimate(o.quad,source.w,source.h);

  return b;
 }
 function request(message,transfer=[],onStatus=()=>{}){return new Promise((resolve,reject)=>{
  const id=++seq,timeout=setTimeout(()=>stop(Error('SwinIRの応答が時間内に返りませんでした。スーパー解像度をオフにすると通常処理で続けられます。')),120000);
  pending={id,onStatus,resolve:r=>{clearTimeout(timeout);resolve(r);},reject:e=>{clearTimeout(timeout);reject(e);}};
  worker.postMessage({...message,id},transfer);
 });}
 async function init(wanted,onStatus){
  clearTimeout(idle);if(worker&&ready&&provider===wanted)return{...ready,reused:true};
  stop();provider=wanted;worker=new Worker(workerURL);
  worker.onerror=e=>{const p=pending;pending=null;worker?.terminate();worker=null;ready=null;p?.reject(Error('SwinIRを読み込めません。'+(e.message||'')));};
  worker.onmessage=({data})=>{
   if(!pending)return;
   if(data.type==='progress'||data.type==='status'||data.type==='loading'){pending.onStatus(data.status||data.message||`モデルを読み込み中 ${data.done||0}/${data.total||0}`);return;}
   if(data.id!==undefined&&data.id!==pending.id)return;
   const p=pending;pending=null;data.type==='error'||data.error?p.reject(Error(data.error||data.message||'SwinIRの実行に失敗しました。')):p.resolve(data);
  };
  ready=await request({type:'init',provider:wanted,tileSize:N},[],onStatus);
  if(ready.type!=='ready'||ready.backend!==wanted||ready.tileSize!==N||ready.scale!==2||!ready.modelSha256)throw Error('SwinIRの初期化結果を確認できません。');
  return{...ready,reused:false};
 }
 function reflect(i,n){if(n===1)return 0;const period=2*n-2;i=((i%period)+period)%period;return i<n?i:period-i;}
 async function render(file,o,{signal=o.signal,onProgress=()=>{}}={}){
  if(running)throw Error('SwinIRを処理中です。');running=true;clearTimeout(idle);
  const started=performance.now(),check=()=>{if(signal?.aborted)throw abort();},cancel=()=>stop();
  let decoded,scratch,enlarged,output,tileStore,encoded,returned=false;
  signal?.addEventListener('abort',cancel,{once:true});
  try{
   check();if(!available)throw Error('SwinIRにはWebGPU対応のブラウザとGPUが必要です。スーパー解像度をオフにすると通常処理で続けられます。');
   // A File is immutable; never identify retained pixels by filename or size.
   let previous=cache?.file===file?cache:null;
   if(!previous)clearCache();
   const compression=previous?.stats.compression||AdaptiveCore.jpegQuantization(await file.slice(0,1024*1024).arrayBuffer());check();
   if(compression.mean>=18)throw Error('圧縮の強いJPEGではSwinIRが文字や模様を悪化させる例があるため、今回は実行しません。スーパー解像度をオフにしてください。');
   if(!previous){decoded=await PhotoEngine.decode(file);check();}
   const W=previous?.sourceW??decoded.bitmap.width,H=previous?.sourceH??decoded.bitmap.height;
   const b=estimate(o.quad,W,H),key=cacheKey(b),hit=previous?.key===key;

   PhotoEngine.validateOutput(o.w,o.h);
   let stats;
   if(hit){
    enlarged=previous.pixels;
    stats={...previous.stats,sourceCrop:b,cacheHit:true,inferenceReused:true,inferredTiles:0,inferenceMs:0,tileProcessingMs:0,modelLoadMs:0,initializationMs:0,sessionReused:false,totalMs:0,
     reusedInference:{modelSha256:previous.stats.modelSha256,tiles:previous.stats.tiles,inferenceMs:previous.stats.inferenceMs,tileProcessingMs:previous.stats.tileProcessingMs,completedAt:previous.stats.inferenceCompletedAt}};
    onProgress(.8,'作成済みの超解像を再利用し、現在の調整を反映しています。');
   }else{
   // Drop every old cache reference before allocating/decoding fresh pixels.
   clearCache();previous=null;if(!decoded){decoded=await PhotoEngine.decode(file);check();}
   stats={profile:'swinir-x2',cpuFallbackDisabled:true,model:'SwinIR-S ×2',compression,sourceDimensions:{w:W,h:H},sourceCrop:b,analysisSampling:'original-image-grid',geometryResampleCount:1,inputResized:false,assembly:'rgba8-buffer',intermediateBytes:b.pixels*16,tiles:0,inferredTiles:0,cacheHit:false,inferenceReused:false,tileSize:N,halo,core,initializationMs:0,inferenceMs:0,tileProcessingMs:0,fallbackReason:null};
   const backend='webgpu';
   if(b.pixels*16>maxCacheBytes){tileStore=await PhotoTileStore.create({width:b.w*2,height:b.h*2,tileSize:core*2,signal});stats.assembly='opfs-rgba8-tiles';stats.intermediateBytes=b.pixels*16;stats.intermediateLocation='device-temporary-storage';}
   // Extract only one native tile at a time. Keep the original bitmap until
   // inference finishes; never allocate a full crop Canvas/readback copy.
   const source=decoded.bitmap;scratch=PhotoEngine.canvas(N,N);const g=PhotoEngine.ctx(scratch);
   onProgress(0,'SwinIRのモデルを端末に読み込み中。写真は送信しません。');
   let setup;try{setup=await init(backend,s=>onProgress(0,s));}catch(e){check();throw Error('SwinIRをGPUで実行できませんでした。'+e.message+' スーパー解像度をオフにすると通常処理で続けられます。方式を自動で切り替えてはいません。');}
   check();stats.backend=backend;stats.modelSha256=setup.modelSha256;stats.modelLoadMs=setup.reused?0:setup.loadMs;stats.sessionReused=setup.reused;stats.initializationMs=performance.now()-started;
   if(!tileStore)enlarged=new Uint8ClampedArray(b.w*b.h*16);const outWidth=b.w*2;
   for(let top=0;top<b.h;top+=core)for(let left=0;left<b.w;left+=core){
    check();const cw=Math.min(core,b.w-left),ch=Math.min(core,b.h-top),rgba=new Uint8ClampedArray(N*N*4);
    const xs=Array.from({length:N},(_,i)=>reflect(left-halo+i,b.w)),ys=Array.from({length:N},(_,i)=>reflect(top-halo+i,b.h));
    const sx=Math.min(...xs),sy=Math.min(...ys),sw=Math.max(...xs)-sx+1,sh=Math.max(...ys)-sy+1;
    scratch.width=sw;scratch.height=sh;g.drawImage(source,b.x+sx,b.y+sy,sw,sh,0,0,sw,sh);const input=g.getImageData(0,0,sw,sh).data;
    for(let y=0;y<N;y++)for(let x=0;x<N;x++){const s=((ys[y]-sy)*sw+xs[x]-sx)*4,t=(y*N+x)*4;if(input[s+3]!==255)throw Error('SwinIRは透明部分のない画像で使えます。透過画像は通常処理で保存できます。');rgba[t]=input[s];rgba[t+1]=input[s+1];rgba[t+2]=input[s+2];rgba[t+3]=255;}
    const r=await request({type:'infer',rgba:rgba.buffer,w:N,h:N},[rgba.buffer]);check();
    const bytes=r.rgba||r.buffer;if(r.type!=='result'||r.backend!==backend||r.modelSha256!==setup.modelSha256||r.w!==N*2||r.h!==N*2||bytes?.byteLength!==N*N*16)throw Error('SwinIRの出力寸法が一致しません。');
    const tile=new Uint8ClampedArray(bytes),coreBytes=tileStore?new Uint8ClampedArray(cw*ch*16):null;for(let y=0;y<ch*2;y++){const from=((y+halo*2)*N*2+halo*2)*4,to=((top*2+y)*outWidth+left*2)*4;if(tileStore)coreBytes.set(tile.subarray(from,from+cw*8),y*cw*8);else enlarged.set(tile.subarray(from,from+cw*8),to);}if(tileStore)await tileStore.writeTile(left*2,top*2,cw*2,ch*2,coreBytes);
    stats.tiles++;stats.inferredTiles++;stats.inferenceMs+=r.inferenceMs||0;stats.tileProcessingMs+=r.ms||0;const elapsed=(performance.now()-started)/1000,p=stats.tiles/b.tiles;
    onProgress(.8*p,`SwinIR GPU ${stats.tiles}/${b.tiles}領域・経過${elapsed.toFixed(0)}秒。中止できます。`);
   }
   check();decoded.bitmap.close();decoded=null;scratch.width=scratch.height=1;scratch=null;
   }
   onProgress(.8,hit?'作成済みの超解像を再利用し、傾きと出力寸法を調整中。':'SwinIRの推論完了。傾きと出力寸法を調整中。');
   const source=tileStore||{width:b.w*2,height:b.h*2,byteRGBA:enlarged},options={...o,quad:o.quad.map(p=>({x:(p.x-b.x)*2,y:(p.y-b.y)*2})),resampler:'cubic-limited',signal,onProgress:p=>onProgress(.8+.2*p,'推論完了・傾きと出力寸法を調整中。')};
   if(o.streamOutput)encoded=await PhotoLargeOutput.render(source,options,{signal,onProgress:(p,t)=>onProgress(.8+.2*p,t)});else{output=await PhotoEngine.render(source,options);output.opaque=true;}check();
   if(tileStore){stats.temporaryStorage={...tileStore.stats};await tileStore.close();tileStore=null;}
   stats.totalMs=performance.now()-started;
   if(!hit){stats.inferenceCompletedAt=new Date().toISOString();stats.cacheStored=!!enlarged&&enlarged.byteLength<=maxCacheBytes;if(stats.cacheStored)cache={file,key,sourceW:W,sourceH:H,pixels:enlarged,stats:{...stats}};}
   lastStats=stats;returned=true;return{canvas:output,...encoded,stats};
  }catch(e){stop();throw e;}finally{
   signal?.removeEventListener('abort',cancel);decoded?.bitmap.close();if(scratch)scratch.width=scratch.height=1;enlarged=null;await tileStore?.close().catch(()=>{});if(encoded&&!returned)await encoded.dispose?.().catch(()=>{});if(output&&!returned)output.width=output.height=1;running=false;
   if(worker)idle=setTimeout(stop,30000);
  }
 }
 function info(o,d,stats){return{id:'swinir-x2',model:'SwinIR-S ×2',kind:'learned-single-image',learned:true,applied:!!stats,executionStatus:stats?(stats.cacheHit?'reused':'completed'):'not-run',inferenceReused:!!stats?.cacheHit,reusedInference:stats?.reusedInference??null,processingLocation:'device',photoUpload:false,cpuFallbackAllowed:false,estimatedDetails:true,newInformation:false,scale:2,nativeW:d.w,nativeH:d.h,modelSha256:stats?.modelSha256,backend:stats?.backend||null,license:'Apache-2.0',controlResampler:'cubic-limited',label:'スーパー解像度 ×2（SwinIR・実験）',note:'解像度不足向けの候補です。撮影ぼけ・圧縮・文字や模様の正しさは保証しません。初回に約40MBのモデル等を端末へ読み込み、写真は送信しません。WebGPUが必要です。原画素を分割処理します。大きな領域は端末内の一時領域に分割し、PNGは少しずつ保存します。必要な空き容量・対応機能は端末によって異なります。大きな領域は数分かかる場合があります。'};}
 const available=typeof Worker!=='undefined'&&typeof WebAssembly!=='undefined'&&!!navigator.gpu;
 window.addEventListener('beforeunload',()=>{clearCache();stop();});
 return{render,validate,estimate,info,stop,clearCache,available,maxCacheBytes,get performance(){return lastStats;}};
})();
