/* Local RGB edge-transition compression; single input, no learned prior.
 * The gates are heuristics, not confidence in artistic intent or lost detail.
 * Port of work/181-edge-transition/probe_v2.py --guard. All processing is native.
 */
'use strict';
globalThis.TransitionCore=(()=>{
 const profiles={mild:{gamma:1.35,strength:.65},medium:{gamma:1.5,strength:.85},strong:{gamma:2,strength:.85}};
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const ramp=(v,a,b)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
 function reflect(v,n){if(n===1)return 0;while(v<0||v>=n)v=v<0?-v:2*n-2-v;return v;}
 function kernel(sigma){const size=(Math.round(sigma*8+1)|1),r=(size-1)/2,k=new Float32Array(size);let sum=0;for(let i=-r;i<=r;i++){k[i+r]=Math.exp(-i*i/(2*sigma*sigma));sum+=k[i+r];}for(let i=0;i<size;i++)k[i]/=sum;return k;}
 function blur(a,w,h,c,sigma){const k=kernel(sigma),r=(k.length-1)/2,tmp=new Float32Array(a.length),out=new Float32Array(a.length);for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let ch=0;ch<c;ch++){let sum=0;for(let d=-r;d<=r;d++)sum+=a[(y*w+reflect(x+d,w))*c+ch]*k[d+r];tmp[(y*w+x)*c+ch]=sum;}for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let ch=0;ch<c;ch++){let sum=0;for(let d=-r;d<=r;d++)sum+=tmp[(reflect(y+d,h)*w+x)*c+ch]*k[d+r];out[(y*w+x)*c+ch]=sum;}return out;}
 // Integer base + Float32 offset avoids tile-origin-dependent subpixel rounding.
 function sample(a,w,h,c,bx,by,dx,dy,ch=0){dx=Math.fround(dx);dy=Math.fround(dy);const sx=Math.floor(dx),sy=Math.floor(dy),ix=bx+sx,iy=by+sy,fx=dx-sx,fy=dy-sy,x0=reflect(ix,w),x1=reflect(ix+1,w),y0=reflect(iy,h),y1=reflect(iy+1,h);return (a[(y0*w+x0)*c+ch]*(1-fx)+a[(y0*w+x1)*c+ch]*fx)*(1-fy)+(a[(y1*w+x0)*c+ch]*(1-fx)+a[(y1*w+x1)*c+ch]*fx)*fy;}
 const decodeLUT=Float32Array.from({length:256},(_,v)=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
 function encode(v){v=clamp(v,0,1);return Math.round(clamp((v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055)*255,0,255));}
 function validateInput(rgba,w,h){
  const n=w*h,tag=Object.prototype.toString.call(rgba);if(!Number.isInteger(w)||!Number.isInteger(h)||w<2||h<2||!Number.isSafeInteger(n)||n>2e6||!['[object Uint8Array]','[object Uint8ClampedArray]'].includes(tag)||rgba.length!==n*4)throw Error('輪郭補正の入力寸法またはRGBAデータが不正です。');
 }
 function analyze(rgba,w,h){
  validateInput(rgba,w,h);const n=w*h;
  const a=new Float32Array(n*3),luma=new Float32Array(n);for(let i=0;i<n;i++){if(rgba[i*4+3]!==255)throw Error('輪郭補正は透明部分のない写真で使えます。');for(let c=0;c<3;c++)a[i*3+c]=decodeLUT[rgba[i*4+c]];luma[i]=.2126*a[i*3]+.7152*a[i*3+1]+.0722*a[i*3+2];}
  const s=blur(luma,w,h,1,1.1),normal=new Float32Array(n*2),tensor=new Float32Array(n*3),mag=new Float32Array(n);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;let gx=0,gy=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const v=s[reflect(y+dy,h)*w+reflect(x+dx,w)];gx+=v*dx*(dy===0?2:1);gy+=v*dy*(dx===0?2:1);}gx/=8;gy/=8;mag[i]=Math.hypot(gx,gy);normal[i*2]=gx/Math.max(mag[i],1e-10);normal[i*2+1]=gy/Math.max(mag[i],1e-10);tensor[i*3]=gx*gx;tensor[i*3+1]=gy*gy;tensor[i*3+2]=gx*gy;}
  const j=blur(tensor,w,h,3,1.8),smooth=blur(a,w,h,3,.6),weight=new Float32Array(n),delta=new Float32Array(n*3),tMap=new Float32Array(n),before=new Float32Array(n);
  const boundsLo=new Float32Array(n),boundsHi=new Float32Array(n);
  const plus=new Float32Array(27),minus=new Float32Array(27),pl=new Float32Array(9),ml=new Float32Array(9);
  function endpoint(lum,sign,threshold){for(let d=1;d<=8;d++){if(sign*(lum[d]-lum[d-1])<-.0005)return [d-1,1];if(d<8&&sign*(lum[d]-lum[d-1])<=threshold&&sign*(lum[d+1]-lum[d])<=threshold)return [d,2];}return [8,0];}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const i=y*w+x,nx=normal[i*2],ny=normal[i*2+1];before[i]=sample(luma,w,h,1,x,y,nx,ny)-sample(luma,w,h,1,x,y,-nx,-ny);
   for(let d=0;d<=8;d++){let lp=0,lm=0;for(let c=0;c<3;c++){const p=sample(smooth,w,h,3,x,y,d*nx,d*ny,c),m=sample(smooth,w,h,3,x,y,-d*nx,-d*ny,c);plus[d*3+c]=p;minus[d*3+c]=m;const k=c===0?.2126:c===1?.7152:.0722;lp+=p*k;lm+=m*k;}pl[d]=lp;ml[d]=lm;}
   const threshold=Math.max(.0005,.15*Math.max((pl[1]-ml[1])*.5,0)),[hd,hr]=endpoint(pl,1,threshold),[ld,lr]=endpoint(ml,-1,threshold);
   let v2=0,numer=0,contrast=0;for(let c=0;c<3;c++){const lo=minus[ld*3+c],v=plus[hd*3+c]-lo;delta[i*3+c]=v;v2+=v*v;numer+=(a[i*3+c]-lo)*v;contrast+=v*(c===0?.2126:c===1?.7152:.0722);}
   contrast=Math.max(contrast,0);const t=numer/Math.max(v2,1e-12),coherence=Math.hypot(j[i*3]-j[i*3+1],2*j[i*3+2])/(j[i*3]+j[i*3+1]+1e-12);
   let mask=ramp(coherence,.65,.92)*ramp(contrast,.025,.08)*ramp(mag[i],.001,.006)*ramp(Math.min(ld,hd),1.5,3.5)*(lr===0||hr===0?.65:1)*(1-ramp((pl[1]-ml[1])/Math.max(contrast,1e-10),.65,.9))*ramp(t,.02,.15)*(1-ramp(t,.85,.98));
   if(x<16||y<16||x>=w-16||y>=h-16)mask=0;weight[i]=clamp(mask,0,1);tMap[i]=t;
   // Store the feasible scalar displacement interval alongside endpoints only
   // long enough to derive it; unmodified orthogonal RGB component is retained.
   let lower=-Infinity,upper=Infinity;for(let c=0;c<3;c++){const v=delta[i*3+c];if(Math.abs(v)<=1e-7)continue;const av=a[i*3+c],lo=minus[ld*3+c],hi=plus[hd*3+c],q0=(Math.min(lo,hi,av)-av)/v,q1=(Math.max(lo,hi,av)-av)/v;lower=Math.max(lower,Math.min(q0,q1));upper=Math.min(upper,Math.max(q0,q1));}
   // Pack interval into maps; this is not a common-RGB or fixed code-value cap.
   plus[0]=lower;minus[0]=upper;
   boundsLo[i]=lower;boundsHi[i]=upper;
  }
  return{a,luma,normal,weight,v:delta,t:tMap,before,lower:boundsLo,upper:boundsHi,w,h};
 }
 function apply(rgba,m,profile='medium'){
  validateInput(rgba,m?.w,m?.h);
  if(!Object.prototype.hasOwnProperty.call(profiles,profile))throw Error('輪郭補正の強さが不正です。');const p=profiles[profile];if(!Number.isFinite(p.gamma)||p.gamma<=0||!Number.isFinite(p.strength)||p.strength<0||p.strength>1)throw Error('輪郭補正の係数が不正です。');const{w,h,a,normal,before}=m,n=w*h,weight=new Float32Array(n),baseDelta=new Float32Array(n*3),deltaLuma=new Float32Array(n),reduction=new Float32Array(n),tmp=new Float32Array(n),history=[];
  for(let i=0;i<n;i++){const t=m.t[i],u=clamp(t,0,1),up=u**p.gamma,down=(1-u)**p.gamma,alpha=clamp(up/Math.max(up+down,1e-20)-t,m.lower[i],m.upper[i]);weight[i]=m.weight[i]*p.strength;for(let c=0;c<3;c++)baseDelta[i*3+c]=alpha*m.v[i*3+c];}
  for(let it=0;it<24;it++){
   for(let i=0;i<n;i++)deltaLuma[i]=weight[i]*(.2126*baseDelta[i*3]+.7152*baseDelta[i*3+1]+.0722*baseDelta[i*3+2]);let violations=0;
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,nx=normal[i*2],ny=normal[i*2+1],change=sample(deltaLuma,w,h,1,x,y,nx,ny)-sample(deltaLuma,w,h,1,x,y,-nx,-ny);reduction[i]=1;if(before[i]>.002&&before[i]+change<.2*before[i]){violations++;reduction[i]=clamp(.8*before[i]/Math.max(-change,1e-12)*.9,0,.95);}}
   history.push(violations);if(!violations)break;
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){let min=1;for(let d=-2;d<=2;d++)min=Math.min(min,reduction[y*w+clamp(x+d,0,w-1)]);tmp[y*w+x]=min;}
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){let min=1;for(let d=-2;d<=2;d++)min=Math.min(min,tmp[clamp(y+d,0,h-1)*w+x]);weight[y*w+x]*=min;}
  }
  // Recompute from the FINAL weights, including after the24th attenuation.
  // The last history entry describes the weights before that attenuation.
  for(let i=0;i<n;i++)deltaLuma[i]=weight[i]*(.2126*baseDelta[i*3]+.7152*baseDelta[i*3+1]+.0722*baseDelta[i*3+2]);
  let remaining=0,reversals=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,nx=normal[i*2],ny=normal[i*2+1],change=sample(deltaLuma,w,h,1,x,y,nx,ny)-sample(deltaLuma,w,h,1,x,y,-nx,-ny),after=before[i]+change;if(before[i]>.002&&after<.2*before[i])remaining++;if(before[i]>.002&&after<-.002)reversals++;}
  const out=new Uint8ClampedArray(rgba);let changed=0,maxChange=0,active=0;
  for(let i=0;i<n;i++){if(weight[i]===0)continue;active++;let change=false;for(let c=0;c<3;c++){const v=encode(a[i*3+c]+weight[i]*baseDelta[i*3+c]);out[i*4+c]=v;const d=Math.abs(v-rgba[i*4+c]);change||=d!==0;maxChange=Math.max(maxChange,d);}if(change)changed++;}
  return{rgba:out,stats:{profile,method:'guarded-rgb-monotone-transition-v2',guardIterations:history.length,guardViolationCounts:history,guardRemainingBelow20PercentOriginalSlope:remaining,normalSlopeReversalPixelCount:reversals,statsInset:0,changedPixels:changed,activePixels:active,maxCodeChange:maxChange,processingGrid:'original',resampled:false}};
 }
 function run(rgba,w,h,profile='medium'){if(!Object.prototype.hasOwnProperty.call(profiles,profile))throw Error('輪郭補正の強さが不正です。');const start=performance.now(),maps=analyze(rgba,w,h),analysisMs=performance.now()-start,result=apply(rgba,maps,profile);result.stats.analysisMs=analysisMs;result.stats.totalMs=performance.now()-start;return result;}
 return{profiles,kernel,analyze,apply,run};
})();
