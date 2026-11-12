'use strict';
// Detail correction is performed on the decoded image grid, before any
// projective mapping. The integer crop is only a memory/work reduction.
const PhotoDetailSource=(()=>{
 const halo=128;
 function cropBounds(quad,width,height){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<4||height<4||!PhotoEngine.validQuad(quad,width,height))throw Error('細部補正の四隅が画像の外、または不正です。');
  const x=Math.max(0,Math.floor(Math.min(...quad.map(p=>p.x)))-halo),y=Math.max(0,Math.floor(Math.min(...quad.map(p=>p.y)))-halo);
  const right=Math.min(width,Math.ceil(Math.max(...quad.map(p=>p.x)))+halo),bottom=Math.min(height,Math.ceil(Math.max(...quad.map(p=>p.y)))+halo);
  return{x,y,w:right-x,h:bottom-y,halo};
 }
 async function render(file,options,restoreOptions={}){
  const signal=options.signal||restoreOptions.signal,check=()=>{if(signal?.aborted)throw new DOMException('細部補正を中止しました','AbortError');};
  check();PhotoEngine.validateOutput(options.w,options.h);
  let decoded,crop,restored,output,encoded,returned=false;
  try{
   decoded=await PhotoEngine.decode(file);check();
   const b=cropBounds(options.quad,decoded.bitmap.width,decoded.bitmap.height);
   crop=PhotoEngine.canvas(b.w,b.h);
   // Identical integer source/destination sizes: no interpolation or warping.
   PhotoEngine.ctx(crop).drawImage(decoded.bitmap,b.x,b.y,b.w,b.h,0,0,b.w,b.h);check();
   const transition=['contour','contour-strong'].includes(restoreOptions.profile);
   const result=transition?await PhotoTransition.restore(crop,{...restoreOptions,profile:restoreOptions.profile==='contour-strong'?'strong':'medium',signal}):await PhotoDeblur.restore(crop,{...restoreOptions,file,signal});restored=result.canvas;check();
   const stats={...result.stats,...(transition?{profile:restoreOptions.profile,transitionStrength:result.stats.profile}:{}),analysisSampling:'original-image-grid',sourceDimensions:{w:decoded.bitmap.width,h:decoded.bitmap.height},sourceCrop:b,cropResampled:false,geometryResampleCount:1};
   if(stats.analysis?.samplePositions)stats.analysis={...stats.analysis,sourceSamplePositions:stats.analysis.samplePositions.map(([x,y])=>[x+b.x,y+b.y])};
   if(result.stats.applied===false){
    // Exactly the ordinary path. Never render the cropped or intermediate image.
    if(options.streamOutput)encoded=await PhotoLargeOutput.render(decoded.bitmap,{...options,signal},{signal,onProgress:(p,t)=>restoreOptions.onProgress?.(p,t)});else output=await PhotoEngine.render(decoded.bitmap,{...options,signal});
   }else{
    if(!restored||restored.width!==b.w||restored.height!==b.h)throw Error('細部補正の出力寸法が原画素の範囲と一致しません。');
    const quad=options.quad.map(p=>({x:p.x-b.x,y:p.y-b.y}));
    if(options.streamOutput)encoded=await PhotoLargeOutput.render(restored,{...options,quad,signal},{signal,onProgress:(p,t)=>restoreOptions.onProgress?.(p,t)});else output=await PhotoEngine.render(restored,{...options,quad,signal});
   }
   check();returned=true;return{canvas:output,...encoded,stats};
  }finally{
   decoded?.bitmap.close();
   if(crop)crop.width=crop.height=1;
   if(restored&&restored!==crop)restored.width=restored.height=1;
   if(output&&!returned)output.width=output.height=1;if(encoded&&!returned)await encoded.dispose?.().catch(()=>{});
  }
 }
 return{cropBounds,render};
})();
