'use strict';
importScripts('transition-core.js?v=20261105-transition1');
let gpuLoadError=null;
try{importScripts('transition-gpu.js?v=20261105-transition1');}catch(e){gpuLoadError=String(e.message||e);}
self.onmessage=async({data})=>{
 const{id,w,h,profile='medium',forceCPU=false}=data;
 try{
  const rgba=new Uint8ClampedArray(data.buffer);let result,backend='webgpu',reason=null;
  if(!forceCPU){try{if(gpuLoadError)throw Error(gpuLoadError);result=await TransitionGPU.run(rgba,w,h,profile);}catch(e){reason=String(e.message||e);}}
  if(!result){backend='cpu';result=TransitionCore.run(rgba,w,h,profile);}
  postMessage({id,buffer:result.rgba.buffer,stats:result.stats,backend,reason},[result.rgba.buffer]);
 }catch(e){postMessage({id,error:String(e.message||e)});}
};
