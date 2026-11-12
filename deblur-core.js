/* Bounded luminance sharpening candidate; manual inverse-blur experiments. */
'use strict';
globalThis.DeblurCore=(()=>{
 const profiles={contour:{label:'輪郭のにじみを抑える・控えめ'},'contour-strong':{label:'輪郭のにじみを抑える・強め'},auto:{label:'控えめな輪郭補正候補'},weak:{sigma:.55,iterations:12,lambda:.06,limit:8,label:'弱め'},standard:{sigma:1.2,iterations:40,lambda:.006,limit:24,label:'標準'}};
 function resolve(profile){const p=typeof profile==='string'?profiles[profile]:profile;if(!p||![p.sigma,p.iterations,p.lambda,p.limit].every(Number.isFinite)||p.sigma<=0||p.sigma>1.25||!Number.isInteger(p.iterations)||p.iterations<1||p.iterations>40||p.lambda<0||p.lambda>.1||p.limit<0||p.limit>24||!Number.isFinite(p.threshold??0)||(p.threshold??0)<0||(p.threshold??0)>5)throw Error('ぼけ軽減の条件が不正です。');if(p.mode&&p.mode!=='bounded-usm')throw Error('不明な細部処理です。');if(p.mode==='bounded-usm'&&(!Number.isFinite(p.amount)||p.amount<0||p.amount>2||p.iterations!==1||p.limit>8||!p.preserveChroma))throw Error('輪郭補正候補の条件が不正です。');return p;}
 function kernel(p){const radius=Math.ceil(p.sigma*3),k=new Float32Array(radius*2+1);let sum=0;for(let i=-radius;i<=radius;i++){k[i+radius]=Math.exp(-i*i/(2*p.sigma*p.sigma));sum+=k[i+radius];}for(let i=0;i<k.length;i++)k[i]/=sum;return k;}
 function reflect(i,n){while(i<0||i>=n)i=i<0?-i:2*n-2-i;return i;}
 function cpu(rgba,w,h,profile){const p=resolve(profile);const n=w*h,k=kernel(p),r=(k.length-1)/2,y=new Float32Array(n),x=new Float32Array(n),tmp=new Float32Array(n),err=new Float32Array(n);
  for(let i=0;i<n;i++){if(rgba[i*4+3]!==255)throw Error('ぼけ軽減は透明部分のない写真で使えます。透明画像はオフで保存できます。');y[i]=.2126*rgba[i*4]+.7152*rgba[i*4+1]+.0722*rgba[i*4+2];x[i]=y[i];}
  function horizontal(src){for(let j=0;j<h;j++)for(let i=0;i<w;i++){let v=0;for(let t=-r;t<=r;t++)v+=src[j*w+reflect(i+t,w)]*k[t+r];tmp[j*w+i]=v;}}
  if(p.mode==='bounded-usm'){horizontal(y);for(let j=0;j<h;j++)for(let i=0;i<w;i++){let v=0;for(let t=-r;t<=r;t++)v+=tmp[reflect(j+t,h)*w+i]*k[t+r];const q=j*w+i;x[q]=y[q]+p.amount*(y[q]-v);}}
  else for(let it=0;it<p.iterations;it++){
   horizontal(x);for(let j=0;j<h;j++)for(let i=0;i<w;i++){let v=0;for(let t=-r;t<=r;t++)v+=tmp[reflect(j+t,h)*w+i]*k[t+r];err[j*w+i]=y[j*w+i]-v;}
   horizontal(err);for(let j=0;j<h;j++)for(let i=0;i<w;i++){let v=0;for(let t=-r;t<=r;t++)v+=tmp[reflect(j+t,h)*w+i]*k[t+r];const q=j*w+i;x[q]+=.9*(v-p.lambda*(x[q]-y[q]));}
  }
  const out=new Uint8ClampedArray(rgba.length);for(let j=0;j<h;j++)for(let i=0;i<w;i++){const q=j*w+i;let lo=y[q],hi=y[q];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const v=y[reflect(j+dy,h)*w+reflect(i+dx,w)];lo=Math.min(lo,v);hi=Math.max(hi,v);}const raw=x[q]-y[q],trimmed=Math.sign(raw)*Math.max(0,Math.abs(raw)-(p.threshold||0));let delta=Math.max(-p.limit,Math.min(p.limit,Math.max(lo,Math.min(hi,y[q]+trimmed))-y[q]));if(p.preserveChroma)delta=Math.max(-Math.min(rgba[q*4],rgba[q*4+1],rgba[q*4+2]),Math.min(255-Math.max(rgba[q*4],rgba[q*4+1],rgba[q*4+2]),delta));if(p.preserveChroma)delta=Math.round(delta);for(let c=0;c<3;c++)out[q*4+c]=Math.round(Math.max(0,Math.min(255,rgba[q*4+c]+delta)));out[q*4+3]=255;}return out;
 }
 return {profiles,resolve,kernel,cpu};
})();
