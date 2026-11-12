'use strict';
// Manual smooth illumination field. No estimate that painted shading is lighting.
const PhotoIllumination=(()=>{
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 function values(o={}){return ['horizontal','vertical','center'].map(k=>{const v=Number(o[k]??0);if(!Number.isFinite(v)||Math.abs(v)>50)throw Error('照明ムラの調整値を確認してください');return v/100;});}
 function active(o){return !!o&&values(o).some(v=>v!==0);}
 function evAt(x,y,w,h,o){const [a,b,c]=values(o),u=(x+.5)/w*2-1,v=(y+.5)/h*2-1;return clamp(a*u+b*v+c*(2/3-u*u-v*v),-.5,.5);}
 const linear=Float64Array.from({length:256},(_,i)=>{const v=i/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
 const encoded=Uint8ClampedArray.from({length:65536},(_,i)=>{const v=i/65535*2;return 255*(v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055);});
 function pixels(data,tw,th,fullW,fullH,left,top,o){const [a,b,c]=values(o);if(!a&&!b&&!c)return 0;let changed=0;for(let y=0;y<th;y++){const v=(top+y+.5)/fullH*2-1;for(let x=0;x<tw;x++){const u=(left+x+.5)/fullW*2-1,gain=2**clamp(a*u+b*v+c*(2/3-u*u-v*v),-.5,.5),p=(y*tw+x)*4;let different=false;for(let k=0;k<3;k++){const before=data[p+k],after=encoded[Math.min(65535,Math.round(linear[before]*gain*32767.5))];data[p+k]=after;different ||= before!==after;}changed+=different;}}return changed;}
 async function apply(canvas,o){if(!active(o.illumination))return canvas;const started=performance.now();let changedPixels=0;const region=o.region||{x:0,y:0,w:o.w,h:o.h},g=canvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});for(let top=0;top<canvas.height;top+=128){if(o.signal?.aborted)throw new DOMException('中止','AbortError');const h=Math.min(128,canvas.height-top),data=g.getImageData(0,top,canvas.width,h);changedPixels+=pixels(data.data,canvas.width,h,o.w,o.h,region.x,region.y+top,o.illumination);g.putImageData(data,0,top);await new Promise(r=>{const c=new MessageChannel();c.port1.onmessage=()=>{c.port1.close();c.port2.close();r();};c.port2.postMessage(0);});}canvas.illuminationExecution={applied:true,changedPixels,totalMs:performance.now()-started,parameters:{...o.illumination}};return canvas;}
 // Compile once per render; preserve out-of-range float RGB until final encoding.
 function prepare(o){const [a,b,c]=values(o);if(!a&&!b&&!c)return null;
  return{gain:(x,y,w,h)=>{const u=(x+.5)/w*2-1,v=(y+.5)/h*2-1;return 2**clamp(a*u+b*v+c*(2/3-u*u-v*v),-.5,.5);},
   encode:(code,gain)=>{const v=code/255,l=v<=.04045?v/12.92:((v+.055)/1.055)**2.4,t=l*gain;return 255*(t<=.0031308?t*12.92:1.055*t**(1/2.4)-.055);}};
 }
 return{active,evAt,pixels,apply,prepare};
})();
