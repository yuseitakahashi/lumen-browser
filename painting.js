'use strict';
const PhotoPainting=(()=>{
 const url=new URL('painting-worker.js?v=20261112-ai2',document.currentScript?.src||document.baseURI).href;
 let active=null;
 function detect(file,{w,h,signal,onProgress=()=>{}}={}){return new Promise((resolve,reject)=>{
  if(active){reject(Error('AI選択を処理中です'));return;}if(signal?.aborted){reject(new DOMException('中止','AbortError'));return;}
  if(!navigator.gpu||typeof Worker==='undefined'){reject(Error('この環境ではAI選択が使えません。「線から候補を探す」か手動指定を使えます。'));return;}
  const worker=new Worker(url);active=worker;let timeout,settled=false;
  function finish(error,value){if(settled)return;settled=true;clearTimeout(timeout);signal?.removeEventListener('abort',cancel);worker.terminate();active=null;error?reject(error):resolve(value);}
  function arm(){clearTimeout(timeout);timeout=setTimeout(()=>finish(Error('AI選択の応答がありません。現在の範囲は保持しました。')),180000);}
  function cancel(){finish(new DOMException('AI選択を中止しました','AbortError'));}
  signal?.addEventListener('abort',cancel,{once:true});worker.onerror=e=>finish(Error(e.message||'AI選択に失敗しました'));
  worker.onmessage=({data:d})=>{arm();if(d.type==='progress'){onProgress(d.status);return;}if(d.type==='error'){finish(Error(d.message));return;}if(d.type!=='result'||!Array.isArray(d.candidates)||d.execution?.backend!=='webgpu+wasm'||!d.execution?.modelHashes){finish(Error('AI選択の実行を確認できません'));return;}finish(null,d);};
  arm();worker.postMessage({file,w,h});
 });}
 return{detect};
})();
