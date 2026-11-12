'use strict';
// Fixed original-image grid. All values are encoded sRGB, not linear light.
const RestormerCore=(()=>{
 const side=576,core=320,halo=128,stride=160,sigma=4,radius=16,amount=.5;
 const kernel=new Float64Array(33),window=new Float64Array(core);let sum=0;
 for(let i=-radius;i<=radius;i++){const v=Math.exp(-i*i/(2*sigma*sigma));kernel[i+radius]=v;sum+=v;}
 for(let i=0;i<kernel.length;i++)kernel[i]/=sum;
 for(let i=0;i<core;i++)window[i]=.5-.5*Math.cos(2*Math.PI*(i+.5)/core);
 function reflect(i,n){if(n===1)return 0;const p=2*n-2;i=((i%p)+p)%p;return i<n?i:p-i;}
 function axis(lo,hi){const a=Math.floor((lo-core)/stride)+1,b=Math.ceil(hi/stride),out=[];for(let k=a;k<b;k++)out.push(k*stride);return out;}
 function bounds(quad,width,height){const x=Math.max(0,Math.floor(Math.min(...quad.map(p=>p.x)))-4),y=Math.max(0,Math.floor(Math.min(...quad.map(p=>p.y)))-4),right=Math.min(width,Math.ceil(Math.max(...quad.map(p=>p.x)))+4),bottom=Math.min(height,Math.ceil(Math.max(...quad.map(p=>p.y)))+4);return{x,y,w:right-x,h:bottom-y};}
 function correctedCore(input,output){
  const plane=side*side;if(input.length!==plane*3||output.length!==plane*3)throw Error('Unexpected Restormer tensor length');
  const candidate=new Float32Array(core*core*3),rowBlur=new Float32Array(plane),residual=new Float32Array(plane);
  for(let c=0;c<3;c++){
   const off=c*plane;
   for(let i=0;i<plane;i++){if(!Number.isFinite(output[off+i]))throw Error('Non-finite model output');residual[i]=output[off+i]-input[off+i];}
   // Same finite Gaussian radius as the prototype. Core is 128px from edge,
   // much larger than radius16: no external Gaussian boundary enters core.
   for(let y=halo-radius;y<halo+core+radius;y++)for(let x=halo;x<halo+core;x++){
    let s=0;for(let k=-radius;k<=radius;k++)s+=residual[y*side+x+k]*kernel[k+radius];rowBlur[y*side+x]=s;
   }
   for(let y=0;y<core;y++)for(let x=0;x<core;x++){
    const ix=x+halo,iy=y+halo,p=iy*side+ix;let low=0;
    for(let k=-radius;k<=radius;k++)low+=rowBlur[(iy+k)*side+ix]*kernel[k+radius];
    candidate[(y*core+x)*3+c]=255*(input[off+p]+amount*(residual[p]-low));
   }
  }
  return candidate;
 }
 return{side,core,halo,stride,sigma,radius,amount,kernel,window,reflect,axis,bounds,correctedCore};
})();
if(typeof module!=='undefined')module.exports=RestormerCore;
