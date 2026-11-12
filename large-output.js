'use strict';
// Large PNGs are rendered in bounded regions on the same global sampling grid.
// The output is never downscaled. The thumbnail is a separate viewing artifact.
const PhotoLargeOutput=(()=>{
 const shouldStream=(o,type)=>type==='image/png'&&(o.w*o.h>48e6||o.w>8192||o.h>8192);
 async function render(source,o,{signal=o.signal,onProgress=()=>{}}={}){
  PhotoEngine.validateOutput(o.w,o.h);
  const started=performance.now(),check=()=>{if(signal?.aborted)throw new DOMException('中止しました','AbortError');};
  const scale=Math.min(1,1200/o.w,1200/o.h),pw=Math.max(1,Math.round(o.w*scale)),ph=Math.max(1,Math.round(o.h*scale));
  const preview=PhotoEngine.canvas(pw,ph),pg=PhotoEngine.ctx(preview),image=pg.createImageData(pw,ph);
  let encoded,renderMs=0,changedPixels=0,illuminationApplied=false;
  try{
   check();encoded=await PhotoPNGStream.encode({width:o.w,height:o.h,signal,onProgress:p=>onProgress(p,'分割してPNGを書き出しています。'),readRows:async(y,height)=>{
    check();const t=performance.now(),rows=new Uint8ClampedArray(o.w*height*4);
    for(let x=0;x<o.w;x+=2048){
     check();const width=Math.min(2048,o.w-x),part=await PhotoEngine.render(source,{...o,region:{x,y,w:width,h:height},onProgress:null,signal});
     try{const rgba=PhotoEngine.ctx(part).getImageData(0,0,width,height).data;for(let j=0;j<height;j++)rows.set(rgba.subarray(j*width*4,(j+1)*width*4),(j*o.w+x)*4);illuminationApplied ||= !!part.illuminationExecution?.applied;changedPixels+=part.illuminationExecution?.changedPixels||0;}finally{part.width=part.height=1;}
    }
    // Sample the already-rendered output, without rendering or inferring again.
    for(let py=0;py<ph;py++){const sy=Math.min(o.h-1,Math.floor((py+.5)*o.h/ph));if(sy<y||sy>=y+height)continue;for(let px=0;px<pw;px++){const sx=Math.min(o.w-1,Math.floor((px+.5)*o.w/pw)),i=((sy-y)*o.w+sx)*4;image.data.set(rows.subarray(i,i+4),(py*pw+px)*4);}}
    renderMs+=performance.now()-t;return rows;
   }});check();pg.putImageData(image,0,0);const previewBlob=await PhotoEngine.blob(preview,'image/png');check();
   return{...encoded,previewBlob,encoding:'png-stream-rgba8',renderMs,encodeMs:Math.max(0,performance.now()-started-renderMs),illuminationExecution:{applied:illuminationApplied,changedPixels,parameters:o.illumination,precision:'float-before-output-quantization',fused:true}};
  }catch(e){await encoded?.dispose?.().catch(()=>{});throw e;}finally{preview.width=preview.height=1;}
 }
 return{shouldStream,render};
})();
