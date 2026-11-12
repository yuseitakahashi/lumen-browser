'use strict';
// Temporary original-grid RGBA8 tiles, confined to this origin and this job.
// No photos are transmitted. Only finished tiles can be read; partial writes
// never become available to the renderer. A Web Lock protects each live job.
const PhotoTileStore=(()=>{
 const rootName='lumen-sr-tiles-v1',lockPrefix='lumen-sr-tiles-v1:',maxCacheBytes=32*1024*1024,maxReadPixels=8e6;
 const ownedName=/^job-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const sessionName=/^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const abort=()=>new DOMException('画像の一時保存を中止しました。','AbortError');
 const integer=v=>Number.isSafeInteger(v)&&v>=0;
 const missing=e=>e?.name==='NotFoundError';
 async function remove(root,name){try{await root.removeEntry(name,{recursive:true});}catch(e){if(!missing(e))throw e;}}
 async function acquire(name,signal){
  if(!navigator.locks?.request)return null;
  let unlock,started,failed;
  const held=new Promise(resolve=>{unlock=resolve;}),ready=new Promise((resolve,reject)=>{started=resolve;failed=reject;});
  const finished=navigator.locks.request(name,{mode:'exclusive',...(signal?{signal}:{})},async()=>{started();await held;});
  finished.catch(failed);await ready;
  return async()=>{unlock();await finished;};
 }
 async function recover(root,signal){
  // Without cross-tab locks we do not guess whether another directory is live.
  if(!navigator.locks?.request)return;
  await navigator.locks.request(lockPrefix+'recovery',{ifAvailable:true},async lock=>{
   if(!lock)return;
   for await(const[name,handle]of root.entries()){
    if(signal?.aborted)throw abort();
    if(handle.kind!=='directory'||!ownedName.test(name))continue;
    await navigator.locks.request(lockPrefix+name,{ifAvailable:true},async jobLock=>{
     if(jobLock)await remove(root,name);
    });
   }
  });
 }
 async function create({width,height,tileSize=608,signal}={}){
  if(!integer(width)||!integer(height)||width<4||height<4||!integer(tileSize)||tileSize<1||!Number.isSafeInteger(tileSize*tileSize*4)||tileSize*tileSize>maxReadPixels)throw Error('一時画像の寸法またはタイル寸法が不正です。');
  if(signal?.aborted)throw abort();
  if(!navigator.storage?.getDirectory)throw Error('このブラウザは大きな画像の端末内一時保存に対応していません。対応するPCブラウザで開いてください。');
  let root,directory,name,release,closed=false,closing=false,tail=Promise.resolve(),cacheBytes=0,peakCacheBytes=0,diskReads=0,writtenBytes=0;
  const written=new Map(),cache=new Map();
  const check=()=>{if(signal?.aborted)throw abort();if(closed||closing)throw Error('画像の一時保存領域は閉じられています。');};
  const forget=()=>{cache.clear();cacheBytes=0;written.clear();};
  async function cleanup(){
   if(closed)return;closed=true;closing=true;signal?.removeEventListener('abort',onAbort);forget();
   try{if(directory)await remove(root,name);}finally{directory=null;if(release){const done=release;release=null;await done();}}
  }
  function close(){closing=true;const result=tail.then(cleanup);tail=result.catch(()=>{});return result;}
  function onAbort(){void close().catch(()=>{});}
  function run(fn){
   const result=tail.then(async()=>{try{check();return await fn();}catch(e){try{await cleanup();}catch(cleanupError){if(e&&typeof e==='object')e.cleanupError=cleanupError.message;}throw e;}});
   tail=result.catch(()=>{});return result;
  }
  function remember(key,data){
   const old=cache.get(key);if(old){cacheBytes-=old.byteLength;cache.delete(key);}
   if(data.byteLength>maxCacheBytes)return;
   while(cacheBytes+data.byteLength>maxCacheBytes){const first=cache.keys().next().value;cacheBytes-=cache.get(first).byteLength;cache.delete(first);}
   cache.set(key,data);cacheBytes+=data.byteLength;peakCacheBytes=Math.max(peakCacheBytes,cacheBytes);
  }
  function rectangle(x,y,w,h){
   if(![x,y,w,h].every(integer)||w<1||h<1||x>width||y>height||w>width-x||h>height-y)throw Error('一時画像の読出し・書込み範囲が不正です。');
  }
  async function readTile(x,y){
   const key=x+','+y,entry=written.get(key);
   if(!entry)throw Error('未完了の画像タイルは読み出せません。');
   let bytes=cache.get(key);
   if(bytes){cache.delete(key);cache.set(key,bytes);return{...entry,bytes};}
   const file=await(await directory.getFileHandle(entry.name)).getFile();check();
   if(file.size!==entry.w*entry.h*4)throw Error('一時保存した画像タイルの容量が一致しません。');
   bytes=new Uint8ClampedArray(await file.arrayBuffer());check();
   if(bytes.byteLength!==entry.w*entry.h*4)throw Error('一時保存した画像タイルを完全に読み出せません。');
   diskReads++;remember(key,bytes);return{...entry,bytes};
  }
  try{
   const storageRoot=await navigator.storage.getDirectory();check();
   root=await storageRoot.getDirectoryHandle(rootName,{create:true});check();
   await recover(root,signal);check();
   // Lockless sessions are deliberately excluded from automatic recovery.
   // Another context must never mistake such a live directory for an orphan.
   name=(navigator.locks?.request?'job-':'session-')+crypto.randomUUID();
   if(!ownedName.test(name)&&!sessionName.test(name))throw Error('一時保存領域の識別子を作成できません。');
   release=await acquire(lockPrefix+name,signal);check();
   // A collision must not reopen or overwrite somebody else's directory.
   try{await root.getDirectoryHandle(name);throw Error('一時保存領域の識別子が重複しました。');}catch(e){if(!missing(e))throw e;}
   directory=await root.getDirectoryHandle(name,{create:true});check();
   signal?.addEventListener('abort',onAbort,{once:true});check();
  }catch(e){await cleanup().catch(()=>{});throw e;}
  return{
   width,height,
   writeTile(x,y,w,h,rgba){return run(async()=>{
    rectangle(x,y,w,h);
    if(x%tileSize||y%tileSize||w!==Math.min(tileSize,width-x)||h!==Math.min(tileSize,height-y))throw Error('画像タイルの位置または端の寸法が一致しません。');
    if(!(rgba instanceof Uint8Array||rgba instanceof Uint8ClampedArray)||rgba.byteLength!==w*h*4)throw Error('画像タイルのRGBAデータが不正です。');
    const key=x+','+y;if(written.has(key))throw Error('完了した画像タイルは上書きできません。');
    // Own immutable bytes, even if the caller reuses or transfers its buffer.
    const bytes=new Uint8ClampedArray(rgba),filename=x+'-'+y+'.rgba';let writer;
    try{
     const handle=await directory.getFileHandle(filename,{create:true});check();
     writer=await handle.createWritable();check();await writer.write(bytes);check();await writer.close();writer=null;check();
    }catch(e){if(writer)await writer.abort().catch(()=>{});throw e;}
    written.set(key,{name:filename,w,h});writtenBytes+=bytes.byteLength;remember(key,bytes);
   });},
   readRGBA(x,y,w,h){return run(async()=>{
    rectangle(x,y,w,h);if(w*h>maxReadPixels)throw Error('一度に読み出す画像範囲は800万画素までです。');
    const result=new Uint8ClampedArray(w*h*4);
    for(let ty=Math.floor(y/tileSize)*tileSize;ty<y+h;ty+=tileSize)for(let tx=Math.floor(x/tileSize)*tileSize;tx<x+w;tx+=tileSize){
     check();const tile=await readTile(tx,ty),left=Math.max(x,tx),right=Math.min(x+w,tx+tile.w),top=Math.max(y,ty),bottom=Math.min(y+h,ty+tile.h);
     for(let row=top;row<bottom;row++){
      const from=((row-ty)*tile.w+left-tx)*4,to=((row-y)*w+left-x)*4;
      result.set(tile.bytes.subarray(from,from+(right-left)*4),to);
     }
    }
    check();return result;
   });},
   close,
   get stats(){return{storage:'opfs-rgba8-tiles',tileSize,tiles:written.size,writtenBytes,cacheBytes,peakCacheBytes,maxCacheBytes,diskReads,closed};},
  };
 }
 return{create,maxCacheBytes,maxReadPixels};
})();
