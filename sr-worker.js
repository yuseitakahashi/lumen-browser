'use strict';
importScripts('weights.js','sr-gpu.js?v=20261101-flow1');
let muteProgress=false;
const weights=FSRCNN_WEIGHTS.weights,layers=[];
const shapes=[[5,1,56],[1,56,12],[3,12,12],[3,12,12],[3,12,12],[3,12,12],[1,12,56],[1,56,4]];
for(let i=0;i<8;i++){const[k,ci,co]=shapes[i],a=weights['f'+(i+1)],w=new Float32Array(a.length);if(a.length!==k*k*ci*co)throw Error('Model shape');let n=0;for(let o=0;o<co;o++)for(let y=0;y<k;y++)for(let x=0;x<k;x++)for(let c=0;c<ci;c++)w[n++]=a[((y*k+x)*ci+c)*co+o];layers.push({k,ci,co,w,b:weights['b'+(i+1)],alpha:weights['alpha'+(i+1)]});}
function conv(src,width,height,l,index){const{k,ci,co,w,b,alpha}=l,out=new Float32Array(width*height*co),radius=k>>1,per=k*k*ci;for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let o=0;o<co;o++){let s=index===7?0:b[o],wi=o*per;for(let ky=0;ky<k;ky++){const yy=y+ky-radius;for(let kx=0;kx<k;kx++){const xx=x+kx-radius;if(xx<0||xx>=width||yy<0||yy>=height){wi+=ci;continue;}let si=(yy*width+xx)*ci;for(let c=0;c<ci;c++)s+=src[si++]*w[wi++];}}out[(y*width+x)*co+o]=s<0&&alpha?s*alpha[o]:s;}return out;}
function infer(rgba,w,h,tile=192){const out=new Uint8ClampedArray(w*h*16);const stats={backend:"cpu-fp32-weights-f64-accumulate",convertInMs:0,inferenceMs:0,convertOutMs:0};let pixels=0;const started=performance.now();for(let top=0;top<h;top+=tile)for(let left=0;left<w;left+=tile){const bottom=Math.min(top+tile,h),right=Math.min(left+tile,w),x0=Math.max(0,left-16),y0=Math.max(0,top-16),x1=Math.min(w,right+16),y1=Math.min(h,bottom+16),pw=x1-x0,ph=y1-y0;const conversionStart=performance.now();let v=new Float32Array(pw*ph);for(let y=0;y<ph;y++)for(let x=0;x<pw;x++){const i=((y+y0)*w+x+x0)*4;if(rgba[i+3]!==255)throw Error('透過画像は学習型に未対応です。');v[y*pw+x]=(.299*rgba[i]+.587*rgba[i+1]+.114*rgba[i+2])/255;}stats.convertInMs+=performance.now()-conversionStart;const inferStart=performance.now();for(let i=0;i<8;i++)v=conv(v,pw,ph,layers[i],i);stats.inferenceMs+=performance.now()-inferStart;const outStart=performance.now();
const getC=(x,y,ch)=>{x=Math.max(0,Math.min(w-1,x));y=Math.max(0,Math.min(h-1,y));const i=(y*w+x)*4,r=rgba[i]/255,g=rgba[i+1]/255,b=rgba[i+2]/255,Y=.299*r+.587*g+.114*b;return ch===0?(r-Y)*.713+.5:(b-Y)*.564+.5;};
for(let y=top*2;y<bottom*2;y++)for(let x=left*2;x<right*2;x++){const Y=v[((Math.floor(y/2)-y0)*pw+Math.floor(x/2)-x0)*4+(y%2)*2+x%2]+weights.b8[0];const fx=(x+.5)/2-.5,fy=(y+.5)/2-.5,ix=Math.floor(fx),iy=Math.floor(fy),ax=fx-ix,ay=fy-iy,c=[];for(let ch=0;ch<2;ch++)c[ch]=((1-ax)*getC(ix,iy,ch)+ax*getC(ix+1,iy,ch))*(1-ay)+((1-ax)*getC(ix,iy+1,ch)+ax*getC(ix+1,iy+1,ch))*ay-.5;const j=(y*w*2+x)*4;out[j]=Math.round(Math.min(1,Math.max(0,Y+1.403*c[0]))*255);out[j+1]=Math.round(Math.min(1,Math.max(0,Y-.714*c[0]-.344*c[1]))*255);out[j+2]=Math.round(Math.min(1,Math.max(0,Y+1.773*c[1]))*255);out[j+3]=255;}
stats.convertOutMs+=performance.now()-outStart;pixels+=(bottom-top)*(right-left);if(!muteProgress)postMessage({progress:pixels/(w*h),elapsed:(performance.now()-started)/1000});}stats.totalMs=performance.now()-started;self.CPU_STATS=stats;return out;}

let activeGPU=null,cancelled=false;
onmessage=async e=>{
 if(e.data.cancel){cancelled=true;activeGPU?.destroy();postMessage({cancelled:true,gpuResourcesDestroyed:true});return;}
 const receivedAt=performance.timeOrigin+performance.now(),started=performance.now();cancelled=false;
 try{
  const {rgba:buffer,w,h,forceCPU=false}=e.data,rgba=new Uint8ClampedArray(buffer);
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<4||h<4||w*h>12e6||w>4096||h>4096||rgba.byteLength!==w*h*4)throw Error('学習型はGPUで入力1200万画素・出力各辺8192pxまでです。');
  let out,stats,fallbackReason,setupMs=0,verificationMs=0;
  if(!forceCPU){try{
   const t=performance.now();activeGPU=await FSRCNN_GPU.create(gpu=>{activeGPU=gpu;if(cancelled)gpu.destroy();});setupMs=performance.now()-t;if(cancelled)throw new DOMException('中止','AbortError');
   const checkStart=performance.now(),cw=37,ch=29,a=new Uint8ClampedArray(cw*ch*4);for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){const i=(y*cw+x)*4;a[i]=(x*17+y*3)%256;a[i+1]=(x*5+y*11)%256;a[i+2]=(x*3+y*7)%256;a[i+3]=255;}
   muteProgress=true;let ref;const cpuCheckStart=performance.now();try{ref=infer(a,cw,ch);}finally{muteProgress=false;}const cpuCheckMs=performance.now()-cpuCheckStart,test=await activeGPU.run(a,cw,ch);if(test.stats.totalMs>Math.max(100,cpuCheckMs*2))throw Error('GPUが遅いためCPUを選択');let max=0;for(let i=0;i<ref.length;i++)max=Math.max(max,Math.abs(ref[i]-test.rgba[i]));if(max>1)throw Error('GPUの画素精度確認に失敗');verificationMs=performance.now()-checkStart;
   if(cancelled)throw new DOMException('中止','AbortError');const result=await activeGPU.run(rgba,w,h,(p,t)=>postMessage({progress:p,elapsed:t,backend:'webgpu-fp32'}));out=result.rgba;stats={...result.stats,setupMs,verificationMs,selfTestMaxCodeError:max,maxInputPixels:12e6};
  }catch(error){if(cancelled||error.name==='AbortError')throw error;fallbackReason=error.message;}finally{activeGPU?.destroy();activeGPU=null;}}
  if(!out){if(w*h>4e6)throw Error('この端末ではGPU/メモリを利用できません。CPUの学習型は400万画素までです。原寸または通常拡大へ戻せます。');if(cancelled)throw new DOMException('中止','AbortError');if(fallbackReason)postMessage({progress:0,elapsed:0,backend:'cpu',fallback:true});out=infer(rgba,w,h);stats={...self.CPU_STATS,backend:'cpu',setupMs,verificationMs,maxInputPixels:4e6,fallbackReason};}
  if(cancelled)throw new DOMException('中止','AbortError');stats.gpuResourcesDestroyed=true;stats.workerTotalMs=performance.now()-started;postMessage({done:true,w:w*2,h:h*2,rgba:out.buffer,stats,receivedAt,sentAt:performance.timeOrigin+performance.now()},[out.buffer]);
 }catch(error){activeGPU?.destroy();activeGPU=null;if(cancelled||error.name==='AbortError')postMessage({cancelled:true,gpuResourcesDestroyed:true});else postMessage({error:error.message});}
};
