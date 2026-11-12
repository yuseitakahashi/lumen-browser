'use strict';
// Candidate eligibility only: observed edge widths do not identify optical blur.
// Edge spread is not proof of optical blur; uncertain inputs remain unchanged.
globalThis.AdaptiveCore=(()=>{
 const quantile=(a,q)=>{if(!a.length)return null;a.sort((x,y)=>x-y);const f=(a.length-1)*q,i=Math.floor(f);return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(f-i);};
 function reflect(i,n){while(i<0||i>=n)i=i<0?-i:2*n-2-i;return i;}
 function inspectPatch(rgba,w,h){
  if(w<2||h<2)return{noise:[],edges:[],opaque:true};
  const y=new Float32Array(w*h),smooth=new Float32Array(w*h),tmp=new Float32Array(w*h),gx=new Float32Array(w*h),gy=new Float32Array(w*h),mag=new Float32Array(w*h),noise=[],edges=[];
  let opaque=true;for(let i=0;i<y.length;i++){opaque&&=rgba[i*4+3]===255;y[i]=.2126*rgba[i*4]+.7152*rgba[i*4+1]+.0722*rgba[i*4+2];}
  if(!opaque)return{noise,edges,opaque};
  const get=(a,x,j)=>a[reflect(j,h)*w+reflect(x,w)];
  for(let j=2;j<h-2;j+=2)for(let i=2;i<w-2;i+=2)noise.push(Math.abs((get(y,i-1,j-1)-get(y,i,j-1)-get(y,i-1,j)+get(y,i,j))/2));
  const k=[Math.exp(-8),Math.exp(-2),1,Math.exp(-2),Math.exp(-8)],sum=k.reduce((a,b)=>a+b);for(let i=0;i<5;i++)k[i]/=sum;
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){let v=0;for(let t=-2;t<=2;t++)v+=get(y,i+t,j)*k[t+2];tmp[j*w+i]=v;}
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){let v=0;for(let t=-2;t<=2;t++)v+=get(tmp,i,j+t)*k[t+2];smooth[j*w+i]=v;}
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){const a=j*w+i;gx[a]=(get(smooth,i+1,j-1)+2*get(smooth,i+1,j)+get(smooth,i+1,j+1)-get(smooth,i-1,j-1)-2*get(smooth,i-1,j)-get(smooth,i-1,j+1))/8;gy[a]=(get(smooth,i-1,j+1)+2*get(smooth,i,j+1)+get(smooth,i+1,j+1)-get(smooth,i-1,j-1)-2*get(smooth,i,j-1)-get(smooth,i+1,j-1))/8;mag[a]=Math.hypot(gx[a],gy[a]);}
  function sample(x,j){const ix=Math.floor(x),iy=Math.floor(j),fx=x-ix,fy=j-iy;return(get(y,ix,iy)*(1-fx)+get(y,ix+1,iy)*fx)*(1-fy)+(get(y,ix,iy+1)*(1-fx)+get(y,ix+1,iy+1)*fx)*fy;}
  for(let top=12;top<h-12;top+=24)for(let left=12;left<w-12;left+=24){let px=left,py=top,m=-1;for(let j=top;j<Math.min(top+24,h-12);j++)for(let i=left;i<Math.min(left+24,w-12);i++)if(mag[j*w+i]>m){m=mag[j*w+i];px=i;py=j;}if(m<10)continue;
   const nx=gx[py*w+px]/m,ny=gy[py*w+px]/m,p=[];for(let t=-8;t<=8;t+=.25)p.push(sample(px+t*nx,py+t*ny));let lo=0,hi=0;for(let i=0;i<5;i++){lo+=p[i]/5;hi+=p[p.length-1-i]/5;}const contrast=hi-lo;if(contrast<40)continue;let backwards=0;for(let i=1;i<p.length;i++)backwards+=Math.max(0,p[i-1]-p[i]);if(backwards>.08*contrast)continue;for(let i=0;i<p.length;i++)p[i]=(p[i]-lo)/contrast;if(p.some(v=>v<-.08||v>1.08))continue;
   const cross=q=>{const j=p.findIndex(v=>v>=q);return j<=0?null:-8+(j-1)*.25+.25*(q-p[j-1])/Math.max(p[j]-p[j-1],1e-6);};const a=cross(.158655),b=cross(.5),c=cross(.841345);if(a===null||b===null||c===null||Math.abs(b)>1.5)continue;const sigma=(c-a)/2;if(sigma>=.4&&sigma<=3.5)edges.push(sigma);
  }
  return{noise,edges,opaque};
 }
 function analyze(patches,compression={kind:'unknown'}){
  const noises=[],edges=[];let opaque=true,pixels=0;for(const p of patches){const a=inspectPatch(new Uint8ClampedArray(p.buffer),p.w,p.h);for(const v of a.noise)noises.push(v);edges.push(...a.edges);opaque&&=a.opaque;pixels+=p.w*p.h;}
  const noise=noises.length?quantile(noises,.25)/.3186:0,width=edges.length>=12?quantile(edges,.3):null;let eligible=width!==null&&width>=1.5,reason=eligible?'edge_profile':'insufficient_or_already_crisp';
  if(noise>2.5){eligible=false;reason='high_frequency_uncertainty';}if(compression.mean>=18){eligible=false;reason='strong_compression';}if(!opaque){eligible=false;reason='transparency';}
  // Fixed local-contrast filter: sigma is a filter radius, never an estimated PSF.
  const parameters=eligible?{mode:'bounded-usm',sigma:1,amount:1.2,iterations:1,lambda:0,limit:8,threshold:Math.max(.5,2*noise),preserveChroma:true}:null;
  return{applied:!!parameters,reason,purpose:'appearance-candidate',blurDiagnosis:'unidentified',fidelity:'unverified',noiseEstimate:noise,edgeWidth:width,edgeCount:edges.length,sampledPixels:pixels,patches:patches.length,compression,parameters};
 }
 // JPEG quantization measures encoded compression, not the amount of recoverable detail.
 function jpegQuantization(buffer){const v=new DataView(buffer);if(v.byteLength<4||v.getUint16(0)!==0xffd8)return{kind:'unknown'};let p=2;try{while(p+4<=v.byteLength){if(v.getUint8(p)!==255){p++;continue;}const marker=v.getUint8(p+1);p+=2;if(marker===0xda||marker===0xd9)break;if(marker===1||(marker>=0xd0&&marker<=0xd8))continue;const len=v.getUint16(p);if(len<2||p+len>v.byteLength)break;if(marker===0xdb){let q=p+2;while(q<p+len){const spec=v.getUint8(q++),precision=spec>>4,id=spec&15;if(precision>1)return{kind:'unknown'};const bytes=precision?2:1;if(q+64*bytes>p+len)return{kind:'unknown'};let sum=0;for(let i=0;i<64;i++)sum+=bytes===1?v.getUint8(q+i):v.getUint16(q+i*2);if(id===0)return{kind:'jpeg',mean:sum/64};q+=64*bytes;}}p+=len;}}catch{}return{kind:'jpeg',mean:null};}
 return{analyze,inspectPatch,jpegQuantization};
})();
