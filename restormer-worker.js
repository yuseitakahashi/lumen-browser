'use strict';
// Only fixed model/runtime asset GETs. Photo tensors never enter a request.
importScripts('./restormer-assets.js','./restormer-core.js','./assets/ort.webgpu.min.js');
const M=self.RESTORMER_ASSETS,base=new URL('./',self.location.href);
const allow=new Set([M.runtimeMjs,...M.wasm.parts,...M.model.parts].map(e=>e.path));
let session=null,busy=false,sequence=0,deviceFailure=null;
const fail=e=>String(e?.message||e);
async function digest(b){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join('');}
function url(path){const u=new URL(path,base);if(!allow.has(path)||u.origin!==base.origin||u.search||u.hash)throw Error('Unrecognized runtime asset');return u.href;}
async function read(e){const r=await fetch(url(e.path),{method:'GET',mode:'same-origin',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'force-cache'});if(!r.ok)throw Error(`Model asset unavailable (${r.status})`);const b=new Uint8Array(await r.arrayBuffer());if(b.length!==e.bytes||await digest(b)!==e.sha256)throw Error('Model asset integrity mismatch');return b;}
async function assembled(e,label){const b=new Uint8Array(e.bytes);let at=0;for(let i=0;i<e.parts.length;i++){const p=await read(e.parts[i]);b.set(p,at);at+=p.length;postMessage({type:'progress',status:`${label} ${i+1}/${e.parts.length}`});}if(at!==b.length||await digest(b)!==e.sha256)throw Error('Assembled model integrity mismatch');return b;}
async function init(){
 if(session)throw Error('Already initialized');if(!navigator.gpu||!crypto.subtle)throw Error('WebGPUと安全な接続が必要です。');
 const t=performance.now(),adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
 if(!adapter?.features.has('shader-f16'))throw Error('このGPUは必要な半精度演算に対応していません。写真は縮小していません。');
 if(adapter.limits.maxStorageBufferBindingSize<M.minimumBindingBytes)throw Error('このGPUの一度に扱えるメモリ範囲が不足しています。');
 const wasm=await assembled(M.wasm,'実行基盤'),model=await assembled(M.model,'補正モデル'),downloadMs=performance.now()-t;
 ort.env.logLevel='warning';ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.wasm.wasmBinary=wasm;ort.env.wasm.wasmPaths={mjs:url(M.runtimeMjs.path)};ort.env.webgpu.adapter=adapter;
 const s=performance.now();session=await ort.InferenceSession.create(model,{executionProviders:['webgpu'],graphOptimizationLevel:'all',extra:{session:{disable_cpu_ep_fallback:'1'}}});
 const device=await ort.env.webgpu.device;device.lost.then(i=>{deviceFailure=`GPUが停止しました: ${i.message||i.reason}`;postMessage({type:'error',message:deviceFailure});});
 device.addEventListener('uncapturederror',e=>{deviceFailure=fail(e.error);});
 postMessage({type:'ready',backend:'webgpu',cpuFallbackDisabled:true,side:576,core:320,modelSha256:M.model.sha256,downloadMs,sessionMs:performance.now()-s,loadMs:performance.now()-t,ortVersion:M.ortVersion});
}
async function infer(m){
 if(!session||deviceFailure)throw Error(deviceFailure||'Not initialized');
 if(!(m.values instanceof ArrayBuffer)||m.values.byteLength!==576*576*3*4)throw Error('Unexpected input dimensions');
 const a=new Float32Array(m.values);for(const v of a)if(!Number.isFinite(v)||v<0||v>1)throw Error('Invalid input values');
 const input=new ort.Tensor('float32',a,[1,3,576,576]);let output;
 try{const started=performance.now(),r=await session.run({input});output=r.output;if(!output||output.type!=='float32'||output.dims.join(',')!=='1,3,576,576')throw Error('Unexpected model output');const values=output.data,inferenceMs=performance.now()-started;
  if(deviceFailure)throw Error(deviceFailure);const filtered=RestormerCore.correctedCore(a,values);
  postMessage({type:'result',id:m.id,backend:'webgpu',modelSha256:M.model.sha256,side:320,values:filtered.buffer,inferenceMs,filterMs:performance.now()-started-inferenceMs,sequence:++sequence},[filtered.buffer]);
 }finally{input.dispose();output?.dispose();}
}
self.onmessage=async({data:m})=>{if(busy){postMessage({type:'error',id:m?.id,message:'Busy'});return;}busy=true;try{if(m.type==='init')await init();else if(m.type==='infer')await infer(m);else throw Error('Unknown command');}catch(e){postMessage({type:'error',id:m?.id,message:fail(e)});}finally{busy=false;}};
