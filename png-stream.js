'use strict';
// Lossless RGBA8 PNG output in bounded row stripes. No full output Canvas.
// Successful OPFS files belong to their returned result until dispose().
const PhotoPNGStream=(()=>{
 const maxStripeBytes=32*1024*1024,maxStripeRows=256,idatBytes=64*1024;
 const rootName='lumen-png-jobs-v1',lockPrefix='lumen-png-job:';
 const signature=new Uint8Array([137,80,78,71,13,10,26,10]);
 const ascii=s=>Uint8Array.from(s,c=>c.charCodeAt(0));
 const name=a=>String.fromCharCode(...a);
 const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;});
 const crc=(a,c=0xffffffff)=>{for(const n of a)c=crcTable[(c^n)&255]^(c>>>8);return c>>>0;};
 const u32=n=>new Uint8Array([n>>>24,(n>>>16)&255,(n>>>8)&255,n&255]);
 const get32=(a,i=0)=>new DataView(a.buffer,a.byteOffset+i,4).getUint32(0);
 const abort=()=>new DOMException('PNGの作成・比較を中止しました','AbortError');
 const check=signal=>{if(signal?.aborted)throw abort();};
 function dimensions(width,height){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>0x7fffffff||height>0x7fffffff||!Number.isSafeInteger(width*height*4))throw Error('PNGの出力寸法が不正です。');
  const rowBytes=width*4;
  if(rowBytes+1>maxStripeBytes)throw Error('PNGの1行が端末内で分割処理できる容量を超えています。');
  return{width,height,rowBytes,stripeRows:Math.min(maxStripeRows,Math.floor(maxStripeBytes/(rowBytes+1)))};
 }
 const supported=()=>typeof CompressionStream==='function'&&typeof DecompressionStream==='function';
 async function holdLock(id,ifAvailable=false){
  if(!navigator?.locks?.request)return null;
  let entered,failed,release;
  const acquired=new Promise((resolve,reject)=>{entered=resolve;failed=reject;});
  const ended=navigator.locks.request(lockPrefix+id,{mode:'exclusive',ifAvailable},lock=>{
   if(!lock){entered(null);return;}
   const held=new Promise(resolve=>{release=resolve;});entered({release:async()=>{release();await ended;}});return held;
  });
  ended.catch(failed);return acquired;
 }
 let orphanCleanup=null;
 async function cleanupOrphans(root){
  // Without Web Locks we clean only our own job; another tab may own any entry.
  if(!navigator?.locks?.request||!root.entries)return;
  for await(const[id,entry]of root.entries()){
   if(entry.kind!=='directory'||!/^png-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))continue;
   const lock=await holdLock(id,true);if(!lock)continue;
   try{await root.removeEntry(id,{recursive:true});}catch(e){if(e.name!=='NotFoundError')throw e;}finally{await lock.release();}
  }
 }
 function memorySink(){
  let parts=[],size=0;
  return{storage:'memory',async write(bytes){parts.push(new Blob([bytes]));size+=bytes.byteLength;},async finish(){const blob=new Blob(parts,{type:'image/png'});parts=[];return blob;},async dispose(){parts=[];},get size(){return size;}};
 }
 async function makeSink(){
  if(!navigator?.storage?.getDirectory)return memorySink();
  let root,id,lock,writable,disposed=false;
  const dispose=async()=>{
   if(disposed)return;disposed=true;
   try{if(writable){const stream=writable;writable=null;try{await stream.abort();}catch{}}if(root&&id)await root.removeEntry(id,{recursive:true});}
   catch(e){if(e.name!=='NotFoundError')throw e;}
   finally{await lock?.release();}
  };
  try{
   const directory=await navigator.storage.getDirectory();root=await directory.getDirectoryHandle(rootName,{create:true});
   if(!orphanCleanup)orphanCleanup=cleanupOrphans(root).catch(()=>{});await orphanCleanup;
   // A lockless tab must never look like an abandoned lock-protected job to
   // a different tab that does support Web Locks. Only its owner may remove it.
   id=(navigator?.locks?.request?'png-':'session-')+crypto.randomUUID();lock=await holdLock(id);
   const job=await root.getDirectoryHandle(id,{create:true}),file=await job.getFileHandle('output.png',{create:true});
   writable=await file.createWritable();let size=0;
   return{storage:'opfs',async write(bytes){await writable.write(bytes);size+=bytes.byteLength;},async finish(){await writable.close();writable=null;const snapshot=await file.getFile();if(snapshot.size!==size)throw Error('保存したPNGの容量が一致しません。');return snapshot.slice(0,snapshot.size,'image/png');},dispose,get size(){return size;}};
  }catch(e){
   try{await dispose();}catch{}
   if(['SecurityError','NotSupportedError','NotAllowedError'].includes(e.name))return memorySink();
   throw Error('PNG用の端末内一時領域を用意できませんでした。'+(e.message||e));
  }
 }
 async function writeChunk(sink,type,data){
  const tag=ascii(type),sum=(crc(data,crc(tag))^0xffffffff)>>>0;
  // One small disk write per chunk; never copy a complete compressed image.
  const chunk=new Uint8Array(data.byteLength+12);chunk.set(u32(data.byteLength));chunk.set(tag,4);chunk.set(data,8);chunk.set(u32(sum),chunk.length-4);await sink.write(chunk);
 }
 async function encode({width,height,readRows,signal,onProgress=()=>{}}){
  const d=dimensions(width,height);check(signal);
  if(typeof readRows!=='function')throw Error('PNGの画素読み込み処理がありません。');
  if(typeof CompressionStream!=='function')throw Error('このブラウザは大きなPNGの分割保存に対応していません。');
  const sink=await makeSink();let writer,reader,consume,returned=false;
  const cancel=()=>{const e=abort();writer?.abort(e).catch(()=>{});reader?.cancel(e).catch(()=>{});};
  signal?.addEventListener('abort',cancel,{once:true});
  try{
   check(signal);await sink.write(signature);
   const ihdr=new Uint8Array(13);ihdr.set(u32(width));ihdr.set(u32(height),4);ihdr[8]=8;ihdr[9]=6;await writeChunk(sink,'IHDR',ihdr);
   const compression=new CompressionStream('deflate');writer=compression.writable.getWriter();reader=compression.readable.getReader();
   let consumeError=null;
   consume=(async()=>{try{
    const pending=new Uint8Array(idatBytes);let used=0;
    while(true){const r=await reader.read();check(signal);if(r.done)break;let i=0;while(i<r.value.byteLength){check(signal);const n=Math.min(pending.length-used,r.value.byteLength-i);pending.set(r.value.subarray(i,i+n),used);used+=n;i+=n;if(used===pending.length){await writeChunk(sink,'IDAT',pending);used=0;}}}
    if(used)await writeChunk(sink,'IDAT',pending.subarray(0,used));
   }catch(e){consumeError=e;writer.abort(e).catch(()=>{});throw e;}})();
   // Attach immediately: a sink failure can precede the next writer.write().
   consume.catch(()=>{});
   for(let y=0;y<height;y+=d.stripeRows){
    check(signal);if(consumeError)throw consumeError;
    const rows=Math.min(d.stripeRows,height-y),rgba=await readRows(y,rows);check(signal);
    if(!(rgba instanceof Uint8ClampedArray)||rgba.length!==d.rowBytes*rows)throw Error('PNGに渡された画素数またはRGBA形式が一致しません。');
    const filtered=new Uint8Array((d.rowBytes+1)*rows);
    for(let row=0;row<rows;row++){
     const s=row*d.rowBytes,t=row*(d.rowBytes+1);filtered[t]=1;
     // PNG Sub filter is reversible modulo256 and preserves every RGBA byte.
     for(let x=0;x<d.rowBytes;x++)filtered[t+1+x]=(rgba[s+x]-(x>=4?rgba[s+x-4]:0))&255;
    }
    await writer.write(filtered);check(signal);if(consumeError)throw consumeError;onProgress((y+rows)/height);
   }
   await writer.close();await consume;check(signal);await writeChunk(sink,'IEND',new Uint8Array());
   const blob=await sink.finish();check(signal);returned=true;
   return{blob,width,height,storage:sink.storage,dispose:sink.dispose};
  }catch(e){
   cancel();if(consume)await consume.catch(()=>{});throw signal?.aborted?abort():e;
  }finally{
   signal?.removeEventListener('abort',cancel);try{writer?.releaseLock();}catch{}try{reader?.releaseLock();}catch{}
   if(!returned)await sink.dispose().catch(()=>{});
  }
 }
 async function readRegion(blob,{x,y,w,h,width,height,signal}){
  const d=dimensions(width,height);check(signal);
  if(![x,y,w,h].every(Number.isInteger)||x<0||y<0||w<1||h<1||x+w>width||y+h>height||!Number.isSafeInteger(w*h*4))throw Error('PNGの比較範囲が画像の外です。');
  if(w*h*4>maxStripeBytes)throw Error('PNGの比較範囲が大きすぎます。');
  if(typeof DecompressionStream!=='function')throw Error('このブラウザは保存PNGの分割比較に対応していません。');
  const output=new Uint8ClampedArray(w*h*4),row=new Uint8Array(d.rowBytes+1);let rowOffset=0,rowNumber=0,writer,reader,decode;
  let cachedStart=-1,cached;
  async function bytes(start,n){
   check(signal);if(start<0||n<0||start+n>blob.size)throw Error('PNGが途中で切れています。');
   if(!cached||start<cachedStart||start+n>cachedStart+cached.length){cachedStart=start;cached=new Uint8Array(await blob.slice(start,Math.min(blob.size,Math.max(start+1048576,start+n))).arrayBuffer());check(signal);}
   return cached.subarray(start-cachedStart,start-cachedStart+n);
  }
  const cancel=()=>{const e=abort();writer?.abort(e).catch(()=>{});reader?.cancel(e).catch(()=>{});};
  signal?.addEventListener('abort',cancel,{once:true});
  try{
   const first=await bytes(0,8);if(!signature.every((v,i)=>first[i]===v))throw Error('保存PNGの識別子が一致しません。');
   let offset=8,sawHeader=false,sawData=false,ended=false,dataEnded=false,decodeError=null;
   const stream=new DecompressionStream('deflate');writer=stream.writable.getWriter();reader=stream.readable.getReader();
   decode=(async()=>{try{
    while(true){const r=await reader.read();check(signal);if(r.done)break;let p=0;
     while(p<r.value.byteLength){
      if(rowNumber>=height)throw Error('保存PNGに余分な画素があります。');
      const n=Math.min(row.length-rowOffset,r.value.byteLength-p);row.set(r.value.subarray(p,p+n),rowOffset);p+=n;rowOffset+=n;
      if(rowOffset===row.length){
       if(row[0]!==0&&row[0]!==1)throw Error('このPNGの画素フィルターは分割比較に対応していません。');
       if(rowNumber>=y&&rowNumber<y+h){
        // Sub is independent between rows. Only selected rows need undoing;
        // CRC, filter kind and decompressed row count still cover the full PNG.
        if(row[0]===1)for(let i=5;i<1+(x+w)*4;i++)row[i]=(row[i]+row[i-4])&255;
        output.set(row.subarray(1+x*4,1+(x+w)*4),(rowNumber-y)*w*4);
       }
       rowNumber++;rowOffset=0;check(signal);
      }
     }
    }
    if(rowOffset!==0||rowNumber!==height)throw Error('保存PNGの画素数が一致しません。');
   }catch(e){decodeError=e;writer.abort(e).catch(()=>{});throw e;}})();decode.catch(()=>{});
   while(offset<blob.size){
    check(signal);if(decodeError)throw decodeError;
    const head=await bytes(offset,8),length=get32(head),type=name(head.subarray(4));
    // Only this encoder's small chunks are accepted; no unbounded parser copy.
    if(!/^[A-Za-z]{4}$/.test(type)||length>1048576||offset+12+length>blob.size)throw Error('保存PNGのチャンク容量が不正です。');
    const body=await bytes(offset+8,length),sum=get32(await bytes(offset+8+length,4));
    if(((crc(body,crc(ascii(type)))^0xffffffff)>>>0)!==sum)throw Error('保存PNGのCRCが一致しません。');
    if(!sawHeader&&type!=='IHDR')throw Error('保存PNGのヘッダーがありません。');
    if(type==='IHDR'){
     if(sawHeader||length!==13||get32(body)!==width||get32(body,4)!==height||body[8]!==8||body[9]!==6||body[10]!==0||body[11]!==0||body[12]!==0)throw Error('保存PNGの寸法またはRGBA形式が一致しません。');
     sawHeader=true;
    }else if(type==='IDAT'){
     if(dataEnded)throw Error('保存PNGの画像チャンクが連続していません。');sawData=true;await writer.write(body);check(signal);
    }else if(type==='IEND'){
     if(!sawData||length!==0||offset+12!==blob.size)throw Error('保存PNGの終端が不正です。');ended=true;break;
    }else{
     if(sawData)dataEnded=true;
     if(!/^[a-z]/.test(type))throw Error('保存PNGに未対応の必須チャンクがあります。');
    }
    offset+=length+12;
   }
   if(!ended)throw Error('保存PNGの終端がありません。');await writer.close();await decode;check(signal);return output;
  }catch(e){cancel();if(decode)await decode.catch(()=>{});throw signal?.aborted?abort():e;}
  finally{signal?.removeEventListener('abort',cancel);try{writer?.releaseLock();}catch{}try{reader?.releaseLock();}catch{}}
 }
 return{encode,readRegion,dimensions,supported,maxStripeBytes,maxStripeRows};
})();
