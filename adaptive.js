'use strict';
const PhotoAdaptive=(()=>{
 const workerURL=new URL('adaptive-worker.js?v=20261105-candidate2',document.currentScript?.src||document.baseURI).href;
 const reasons={edge_profile:'弱い輪郭補正の候補です。ぼけの復元や描画の正しさは未確認です。元の柔らかい線を変えることもあるため、実画像で採否を判断してください。',insufficient_or_already_crisp:'十分に明瞭、または判断できる輪郭が少ないため、細部補正は適用していません。',high_frequency_uncertainty:'細かな模様やノイズの区別が難しいため、細部補正は適用していません。',strong_compression:'JPEGの圧縮が強い可能性があるため、細部補正は適用していません。',transparency:'透明部分を保つため、細部補正は適用していません。'};
 function positions(source){
  const w=source.width,h=source.height,pw=Math.min(128,w),ph=Math.min(128,h),nx=Math.min(8,Math.max(1,Math.floor(w/128))),ny=Math.min(8,Math.max(1,Math.floor(h/128))),points=[];
  // When uniform patches cover less than a quarter of a large image, a small
  // locator ranks detail-rich positions. Only original pixels are analysed.
  if(w*h>4*64*128*128){
   const scale=Math.min(1,1024/w,1024/h),c=PhotoEngine.canvas(Math.round(w*scale),Math.round(h*scale));
   try{const g=PhotoEngine.ctx(c);g.drawImage(source,0,0,c.width,c.height);const d=g.getImageData(0,0,c.width,c.height).data,y=new Float32Array(c.width*c.height);for(let i=0;i<y.length;i++)y[i]=.2126*d[i*4]+.7152*d[i*4+1]+.0722*d[i*4+2];
    for(let top=0;top<h;top+=128)for(let left=0;left<w;left+=128){const x=Math.min(left,w-pw),v=Math.min(top,h-ph),x0=Math.max(1,Math.ceil(x/w*c.width)),x1=Math.min(c.width-1,Math.floor((x+pw)/w*c.width)),y0=Math.max(1,Math.ceil(v/h*c.height)),y1=Math.min(c.height-1,Math.floor((v+ph)/h*c.height));let score=0,n=0;for(let j=y0;j<y1;j++)for(let i=x0;i<x1;i++){const a=j*c.width+i;score+=Math.min(64,Math.abs(y[a+1]-y[a-1])+Math.abs(y[a+c.width]-y[a-c.width]));n++;}points.push({x,y:v,score:score/Math.max(1,n)});}
    points.sort((a,b)=>b.score-a.score||a.y-b.y||a.x-b.x);return{points:points.slice(0,64),pw,ph,mode:'detail-priority',locator:[c.width,c.height]};
   }finally{c.width=c.height=1;}
  }
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++)points.push({x:Math.max(0,Math.min(w-pw,Math.round((i+.5)*w/nx-pw/2))),y:Math.max(0,Math.min(h-ph,Math.round((j+.5)*h/ny-ph/2)))});
  return{points,pw,ph,mode:'uniform',locator:null};
 }
 async function analyze(source,{file,signal,onProgress}={}){
  const start=performance.now(),check=()=>{if(signal?.aborted)throw new DOMException('解析を中止しました','AbortError');};check();let compression={kind:'unknown'};
  if(file){compression=AdaptiveCore.jpegQuantization(await file.slice(0,1024*1024).arrayBuffer());check();}
  const w=source.width,h=source.height,selection=positions(source),{pw,ph}=selection,g=PhotoEngine.ctx(source),patches=[];
  for(const {x,y}of selection.points){check();const image=g.getImageData(x,y,pw,ph);patches.push({buffer:image.data.buffer,w:pw,h:ph});onProgress?.(patches.length/selection.points.length);if(patches.length%8===0)await new Promise(r=>setTimeout(r,0));}
  check();return new Promise((resolve,reject)=>{const worker=new Worker(workerURL);let done=false;const end=(error,result)=>{if(done)return;done=true;signal?.removeEventListener('abort',abort);worker.terminate();error?reject(error):resolve(result);};const abort=()=>end(new DOMException('解析を中止しました','AbortError'));signal?.addEventListener('abort',abort,{once:true});worker.onmessage=({data})=>data.error?end(Error(data.error)):end(null,{...data.result,workerMs:data.workerMs,totalMs:performance.now()-start,nativeWidth:w,nativeHeight:h,sampling:selection.mode,locatorDimensions:selection.locator,samplePositions:selection.points.map(({x,y})=>[x,y])});worker.onerror=e=>end(Error('写真の解析に失敗しました。'+e.message));if(signal?.aborted){abort();return;}worker.postMessage({patches,compression},patches.map(p=>p.buffer));});
 }
 return{analyze,reasons};
})();
