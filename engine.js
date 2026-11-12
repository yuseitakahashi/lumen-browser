'use strict';
const PhotoEngine=(()=>{
const canvas=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
const ctx=c=>{const g=c.getContext('2d',{colorSpace:'srgb',willReadFrequently:true});if(!g)throw Error('この端末で画像用メモリを確保できません。写真を閉じて1枚ずつ試すか、軽めのサイズで保存してください。原本は変更していません。');return g;};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
// Yield between chunks without nested-timer clamping; pixel math is unchanged.
const pause=()=>new Promise(r=>{const ch=new MessageChannel();ch.port1.onmessage=()=>{ch.port1.close();ch.port2.close();r();};ch.port2.postMessage(0);});
// Legacy preset is a size suggestion, never a validation ceiling.
function largestOutput(w,h){return{w:Math.round(w*2),h:Math.round(h*2)};}
function validateOutput(w,h){if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<1||h<1||w>0x7fffffff||h>0x7fffffff||!Number.isSafeInteger(w*h*4))throw Error('出力サイズを有効な正の整数で指定してください。');}
function checkCanvas(w,h){validateOutput(w,h);let c;try{c=canvas(w,h);const g=ctx(c);g.fillStyle='#123456';g.fillRect(w-1,h-1,1,1);const p=g.getImageData(w-1,h-1,1,1).data;if(p[0]!==18||p[1]!==52||p[2]!==86||p[3]!==255)throw Error('canvas allocation');}catch{throw Error('このブラウザでは指定寸法のJPEG用メモリを確保できません。PNGなら分割保存できます。写真は縮小していません。');}finally{if(c)c.width=c.height=1;}}
function orientation(v,base,length){try{if(length<8)return 1;const little=v.getUint16(base)===0x4949;if(!little&&v.getUint16(base)!==0x4d4d)return 1;if(v.getUint16(base+2,little)!==42)return 1;const pos=base+v.getUint32(base+4,little),limit=base+length;if(pos<base||pos+2>limit)return 1;const count=Math.min(512,v.getUint16(pos,little));for(let i=0;i<count;i++){const p=pos+2+i*12;if(p+12>limit)break;if(v.getUint16(p,little)===0x112&&v.getUint16(p+2,little)===3&&v.getUint32(p+4,little)===1){const o=v.getUint16(p+8,little);return o>=1&&o<=8?o:1;}}}catch{}return 1;}
async function header(file){
 if(file.size>120*1024*1024)throw Error('120MBを超えるファイルは読み込めません。');const v=new DataView(await file.slice(0,1024*1024).arrayBuffer());
 if(v.byteLength>=24&&v.getUint32(0)===0x89504e47&&v.getUint32(4)===0x0d0a1a0a){let o=1;for(let p=8;p+12<=v.byteLength;){const n=v.getUint32(p);if(n>v.byteLength-p-12)break;const tag=v.getUint32(p+4);if(tag===0x65584966)o=orientation(v,p+8,n);if(tag===0x49444154)break;p+=n+12;}return{w:v.getUint32(16),h:v.getUint32(20),type:'image/png',orientation:o};}
 if(v.byteLength>=4&&v.getUint16(0)===0xffd8){let p=2,w,h,o=1;while(p+4<v.byteLength){if(v.getUint8(p)!==255){p++;continue;}const m=v.getUint8(p+1);p+=2;if(m===0xd9||m===0xda)break;if(m===1||(m>=0xd0&&m<=0xd8))continue;const len=v.getUint16(p);if(len<2||p+len>v.byteLength)break;if(m===0xe1&&len>=14&&v.getUint32(p+2)===0x45786966&&v.getUint16(p+6)===0)o=orientation(v,p+8,len-8);if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(m)&&len>=8){w=v.getUint16(p+5);h=v.getUint16(p+3);}p+=len;}if(w&&h)return{w,h,type:'image/jpeg',orientation:o};}
 throw Error('JPEG / PNGのみ対応しています。RAW (.ARW) はJPEG / PNGの写真を選んでください。');
}
async function decode(file,{previewMax=0}={}){
 const meta=await header(file);if(meta.w<4||meta.h<4)throw Error('入力画像は幅・高さとも4px以上にしてください。');
 if(meta.w*meta.h>64e6||Math.max(meta.w,meta.h)>30000)throw Error('この写真は入力上限（6400万画素・各辺30000px）を超えます。原本は変更していません。');
 const swapped=meta.orientation>=5,w=swapped?meta.h:meta.w,h=swapped?meta.w:meta.h,scale=previewMax?Math.min(1,previewMax/w,previewMax/h):1;
 const options={imageOrientation:'from-image',colorSpaceConversion:'default'};if(previewMax){options.resizeWidth=Math.max(1,Math.round(w*scale));options.resizeHeight=Math.max(1,Math.round(h*scale));options.resizeQuality='high';}
 let bitmap;try{bitmap=await createImageBitmap(file,options);}catch(error){throw Error('この端末では写真を開けませんでした（画像の破損・形式・メモリ不足の可能性）。写真を閉じて1枚ずつ試すか、十分な空きメモリのあるPCでこのURLを開いてください。原本は変更していません。');}
 return{bitmap,file,w:previewMax?w:bitmap.width,h:previewMax?h:bitmap.height,meta};
}
const fullQuad=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function dimensions(q){return{w:Math.max(1,Math.round((distance(q[0],q[1])+distance(q[2],q[3]))/2)),h:Math.max(1,Math.round((distance(q[1],q[2])+distance(q[3],q[0]))/2))};}
function validQuad(q,w,h){if(q.length!==4||q.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>w||p.y>h))return false;return q.every((a,i)=>{const b=q[(i+1)%4],c=q[(i+2)%4];return(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x)>1&&distance(a,b)>=4;});}
function homography(q){const uv=[[0,0],[1,0],[1,1],[0,1]],a=[];uv.forEach(([u,v],i)=>{const{x,y}=q[i];a.push([u,v,1,0,0,0,-x*u,-x*v,x],[0,0,0,u,v,1,-y*u,-y*v,y]);});for(let c=0;c<8;c++){let p=c;for(let r=c+1;r<8;r++)if(Math.abs(a[r][c])>Math.abs(a[p][c]))p=r;[a[c],a[p]]=[a[p],a[c]];const s=a[c][c];if(Math.abs(s)<1e-10)throw Error('四隅の形状を見直してください。');for(let k=c;k<9;k++)a[c][k]/=s;for(let r=0;r<8;r++)if(r!==c){const t=a[r][c];for(let k=c;k<9;k++)a[r][k]-=t*a[c][k];}}const h=a.map(r=>r[8]),project=(u,v)=>{const z=h[6]*u+h[7]*v+1;return{x:(h[0]*u+h[1]*v+h[2])/z,y:(h[3]*u+h[4]*v+h[5])/z}};project.coefficients=h;return project;}
// sRGB transfer functions: exposure and sample integration operate in linear light.
const linear=new Float64Array(256);
for(let i=0;i<256;i++){const s=i/255;linear[i]=s<=.04045?s/12.92:((s+.055)/1.055)**2.4;}
const encode=v=>255*(v<=.0031308?12.92*v:1.055*Math.max(0,v)**(1/2.4)-.055);
async function render(source,o){
 return renderBase(source,o);
}
function resamplingInfo(o){
 const requested=o.resampler||'linear';if(!['linear','cubic-limited'].includes(requested))throw Error('未対応の処理方式です。未取得のAIモデルは実行できません。');
 const q=o.quad.map((_,i)=>o.quad[(i-(o.turn||0)+4)%4]),d=dimensions(q),enlarging=o.w>d.w*1.005&&o.h>d.h*1.005;
 const id=requested==='cubic-limited'&&enlarging?'cubic-limited':'linear';
 return{id,requested,kind:'interpolation',learned:false,newInformation:false,label:id==='cubic-limited'?'範囲制限付き3次補間（通常補間）':'線形光の標準補間',note:requested==='linear'?'従来の線形光bilinear補間。縮小は画素の領域積分を使います。':requested==='cubic-limited'&&!enlarging?'原寸相当・縮小は標準補間を使用します。':'拡大部分の不透明画素だけ3次補間。透過・縮小領域は標準補間。制限は補間段階だけで、調整後の色を保証しません。ノイズも強調されるため、保存後に標準補間と比較してください。'};
}
function cubicWeight(x){x=Math.abs(x);return x<=1?1.5*x*x*x-2.5*x*x+1:x<2?-.5*x*x*x+2.5*x*x-4*x+2:0;}
async function renderBase(source,o){
 const{quad,w,h,turn=0,brightness=0,contrast=0,warmth=0,sharpness=0,signal,onProgress}=o;
 const illumination=o.illumination?PhotoIllumination.prepare(o.illumination):null;
 let illuminationChanged=0;const rounded=illumination?new Uint8ClampedArray(1):null;
 const finish=out=>{if(illumination)out.illuminationExecution={applied:true,changedPixels:illuminationChanged,parameters:{...o.illumination},precision:'float-before-output-quantization',fused:true,timing:'included-in-render'};return out;};
 // Optional research source: original-grid RGBA code values (0..255 units).
 // RGB may extend beyond that range until the existing final output clamp.
 const floating=source.floatRGBA!==undefined,bytes=source.byteRGBA!==undefined,external=typeof source.readRGBA==='function',byteSource=bytes||external;
 if(external&&(floating||bytes||!Number.isSafeInteger(source.width)||!Number.isSafeInteger(source.height)||source.width<4||source.height<4))throw Error('Invalid tiled source.');
 async function readExternalRect(x,y,rw,rh){if(signal?.aborted)throw new DOMException('中止しました','AbortError');const data=await source.readRGBA(x,y,rw,rh);if(!(data instanceof Uint8ClampedArray)||data.length!==rw*rh*4)throw Error('分割画像の画素数が一致しません。');return data;}
 if(floating&&bytes)throw Error('Specify only one pixel source representation.');
 if(floating&&(!(source.floatRGBA instanceof Float32Array||source.floatRGBA instanceof Float64Array)||!Number.isInteger(source.width)||!Number.isInteger(source.height)||source.width<4||source.height<4||!Number.isSafeInteger(source.width*source.height*4)||source.floatRGBA.length!==source.width*source.height*4))throw Error('Float source dimensions or RGBA data are invalid.');
 // Learned SR can supply its original-grid RGBA8 buffer directly. Reading a
 // bounded rectangle avoids another full-size canvas and its readback copy.
 if(bytes&&(!(source.byteRGBA instanceof Uint8ClampedArray)||!Number.isInteger(source.width)||!Number.isInteger(source.height)||source.width<4||source.height<4||!Number.isSafeInteger(source.width*source.height*4)||source.byteRGBA.length!==source.width*source.height*4))throw Error('Byte source dimensions or RGBA data are invalid.');
 function readByteRect(x,y,rw,rh,target=new Uint8ClampedArray(rw*rh*4)){
  const input=source.byteRGBA;
  for(let j=0;j<rh;j++){
   if((j&31)===0&&signal?.aborted)throw new DOMException('中止しました','AbortError');
   const start=((y+j)*source.width+x)*4;target.set(input.subarray(start,start+rw*4),j*rw*4);
  }
  return target;
 }
 validateOutput(w,h);
 const region=o.region||{x:0,y:0,w,h};
 if(!['x','y','w','h'].every(k=>Number.isInteger(region[k]))||region.x<0||region.y<0||region.w<1||region.h<1||region.x+region.w>w||region.y+region.h>h)throw Error('比較範囲が出力画像の外です。');
 if(!validQuad(quad,source.width,source.height))throw Error('四隅が交差しているか画像の外にあります。');const method=resamplingInfo(o);
 // Exact integer 1:1 crop/copy keeps the original sampling grid. Point adjustments
 // use the same 8-bit lookup result as the general renderer, not a gamma shortcut.
 if(!floating&&!turn&&!sharpness&&quad.every(p=>Number.isInteger(p.x)&&Number.isInteger(p.y))&&quad[0].y===quad[1].y&&quad[1].x===quad[2].x&&quad[2].y===quad[3].y&&quad[3].x===quad[0].x&&w===quad[1].x-quad[0].x&&h===quad[3].y-quad[0].y){
  const check=()=>{if(signal?.aborted)throw new DOMException('中止しました','AbortError');};check();const out=canvas(region.w,region.h),g=ctx(out),scratch=byteSource?null:canvas(1,1),sg=scratch?ctx(scratch):null;
  try{
   if(!byteSource&&!brightness&&!contrast&&!warmth&&!illumination){g.drawImage(source,quad[0].x+region.x,quad[0].y+region.y,region.w,region.h,0,0,region.w,region.h);await pause();check();onProgress?.(1);return out;}
   const factor=1+contrast/100,exp=2**(brightness/100),table=illumination?new Float64Array(256*3):new Uint8ClampedArray(256*3);for(let v=0;v<256;v++)for(let c=0;c<3;c++)table[v*3+c]=(encode(linear[v]*exp)-127.5)*factor+127.5+(c===0?warmth:c===2?-warmth:0);
   let done=0;for(let top=0;top<region.h;top+=512)for(let left=0;left<region.w;left+=512){check();const tw=Math.min(512,region.w-left),th=Math.min(512,region.h-top),x=quad[0].x+region.x+left,y=quad[0].y+region.y+top;let image;if(byteSource){image=g.createImageData(tw,th);if(external)image.data.set(await readExternalRect(x,y,tw,th));else readByteRect(x,y,tw,th,image.data);}else{scratch.width=tw;scratch.height=th;sg.drawImage(source,x,y,tw,th,0,0,tw,th);image=sg.getImageData(0,0,tw,th);}const a=image.data;if(brightness||contrast||warmth||illumination)for(let i=0;i<a.length;i+=4){const gain=illumination?illumination.gain(region.x+left+(i/4)%tw,region.y+top+Math.floor(i/4/tw),w,h):1;let changed=false;for(let c=0;c<3;c++){const v=table[a[i+c]*3+c];a[i+c]=illumination?illumination.encode(v,gain):v;if(illumination){rounded[0]=v;changed ||= a[i+c]!==rounded[0];}}if(changed)illuminationChanged++;}g.putImageData(image,left,top);done+=tw*th;onProgress?.(done/(region.w*region.h));await pause();check();}return finish(out);
  }catch(e){out.width=out.height=1;throw e;}finally{if(scratch)scratch.width=scratch.height=1;}
 }

 const map=homography(quad.map((_,i)=>quad[(i-turn+4)%4])),out=canvas(region.w,region.h),oc=ctx(out),scratch=canvas(1,1),sc=ctx(scratch),tile=256;
 const factor=1+contrast/100,exp=2**(brightness/100),m=sharpness>0?1:0;
 const abort=()=>{if(signal?.aborted)throw new DOMException('中止しました','AbortError');};
 function readFloatRect(x,y,rw,rh){
  // Cache linear-light values per source block, not per output sample. This
  // avoids pow per cubic tap and does not allocate a full-image float copy.
  const data=new Float64Array(rw*rh*4),input=source.floatRGBA;
  for(let j=0;j<rh;j++){
   if((j&31)===0)abort();
   for(let i=0;i<rw;i++){
    const s=((y+j)*source.width+x+i)*4,d=(j*rw+i)*4;
    for(let c=0;c<3;c++){
     const v=input[s+c];if(!Number.isFinite(v))throw Error('Float source contains a non-finite RGB value.');
     if(Number.isInteger(v)&&v>=0&&v<=255)data[d+c]=linear[v];
     else{const code=v/255;data[d+c]=code<=.04045?code/12.92:((code+.055)/1.055)**2.4;if(!Number.isFinite(data[d+c]))throw Error('Float source RGB exceeds the finite transfer range.');}
    }
    const alpha=input[s+3];if(!Number.isFinite(alpha)||alpha<0||alpha>255)throw Error('Float source alpha must be finite and within 0..255.');data[d+3]=alpha;
   }
  }
  return data;
 }
 let done=0;
 try{
  // Keep the original full-output tile grid and derivative bounds. Cropping only
  // changes canvas placement; it never changes geometry or sample footprints.
  for(let top=Math.floor(region.y/tile)*tile;top<region.y+region.h;top+=tile)for(let left=Math.floor(region.x/tile)*tile;left<region.x+region.w;left+=tile){
   abort();
   const tw=Math.min(tile,w-left),th=Math.min(tile,h-top),bw=tw+2*m,bh=th+2*m;
   const uv=[[left-m,top-m],[left+tw+m,top-m],[left+tw+m,top+th+m],[left-m,top+th+m]].map(([x,y])=>[clamp(x/w,0,1),clamp(y/h,0,1)]);
   const corners=uv.map(([u,v])=>map(u,v));
   const sx=clamp(Math.floor(Math.min(...corners.map(p=>p.x)))-2,0,source.width-1),sy=clamp(Math.floor(Math.min(...corners.map(p=>p.y)))-2,0,source.height-1);
   const sw=clamp(Math.ceil(Math.max(...corners.map(p=>p.x)))+2,sx+1,source.width)-sx,sh=clamp(Math.ceil(Math.max(...corners.map(p=>p.y)))+2,sy+1,source.height)-sy;
   // Large minifications need a large source footprint, not a geometry rejection.
   // Keep the existing 8MP readback limit; stream smaller source blocks if needed.
   let src;
   if(sw*sh<=(floating?1e6:8e6)){if(floating)src=readFloatRect(sx,sy,sw,sh);else if(external)src=await readExternalRect(sx,sy,sw,sh);else if(bytes)src=readByteRect(sx,sy,sw,sh);else{scratch.width=sw;scratch.height=sh;sc.drawImage(source,sx,sy,sw,sh,0,0,sw,sh);src=sc.getImageData(0,0,sw,sh).data;}}
   const blocks=new Map(),blockWidth=1024,blockHeight=256;
   function locate(x,y){
    if(src)return[src,((y-sy)*sw+x-sx)*4];
    const bx=Math.floor(x/blockWidth)*blockWidth,by=Math.floor(y/blockHeight)*blockHeight,key=by*source.width+bx;
    let b=blocks.get(key);
    if(!b){
     const width=Math.min(blockWidth,source.width-bx),height=Math.min(blockHeight,source.height-by);
     if(floating)b={width,data:readFloatRect(bx,by,width,height)};
     else if(bytes)b={width,data:readByteRect(bx,by,width,height)};
     else{scratch.width=width;scratch.height=height;sc.drawImage(source,bx,by,width,height,0,0,width,height);b={width,data:sc.getImageData(0,0,width,height).data};}
     if(blocks.size>=(floating?4:32))blocks.delete(blocks.keys().next().value);
     blocks.set(key,b);
    }
    return[b.data,((y-by)*b.width+x-bx)*4];
   }
   // Extreme minifications can span the full source. Read only a bounded LRU
   // of source blocks; the ordinary path above still reads one small rectangle.
   async function locateExternal(x,y){
    const bx=Math.floor(x/blockWidth)*blockWidth,by=Math.floor(y/blockHeight)*blockHeight,key=by*source.width+bx;
    let b=blocks.get(key);
    if(!b){const width=Math.min(blockWidth,source.width-bx),height=Math.min(blockHeight,source.height-by);b={width,data:await readExternalRect(bx,by,width,height)};if(blocks.size>=16)blocks.delete(blocks.keys().next().value);blocks.set(key,b);}
    return[b.data,((y-by)*b.width+x-bx)*4];
   }
   // A footprint-sized integration grid, rather than one bilinear point, prevents
   // thin detail from depending on the phase of a downsample. Derivative bounds
   // are measured at tile corners; no fixed sample-count cap discards fine lines.
   let dxMax=1,dyMax=1;
   for(const[u,v]of uv){const p=map(u,v),px=map(u+(u===1?-1:1)/w,v),py=map(u,v+(v===1?-1:1)/h);dxMax=Math.max(dxMax,distance(p,px));dyMax=Math.max(dyMax,distance(p,py));}
   const useCubic=method.id==='cubic-limited'&&dxMax<=1.000001&&dyMax<=1.000001;
   const nx=dxMax>1.000001?Math.ceil(dxMax):1,ny=dyMax>1.000001?Math.ceil(dyMax):1,count=nx*ny,buf=illumination?new Float64Array(bw*bh*4):new Uint8ClampedArray(bw*bh*4);
   let work=0;
   // Exact-math optimization. Only a fully opaque cached cubic tile takes
   // this path. In the reference its bilinear result is unconditionally replaced
   // by cubic, so omit it and scalarize coordinates / channel accumulators.
   // Keep kernel accumulation order yy then xx, transfer functions, bounds,
   // output-grid phase, sharpness buffer, and yielding frequency unchanged.
   let opaqueCubic=useCubic&&!!src;
   if(opaqueCubic)for(let k=3;k<src.length;k+=4)if(src[k]!==255){opaqueCubic=false;break;}
   if(opaqueCubic){
    const H=map.coefficients,maxX=source.width-1,maxY=source.height-1;
    for(let j=0;j<bh;j++)for(let i=0;i<bw;i++){
     const u=clamp((left+i-m+.5)/w,0,1),v=clamp((top+j-m+.5)/h,0,1),z=H[6]*u+H[7]*v+1;
     const fx=clamp((H[0]*u+H[1]*v+H[2])/z-.5,0,maxX),fy=clamp((H[3]*u+H[4]*v+H[5])/z-.5,0,maxY);
     const x0=Math.floor(fx),y0=Math.floor(fy),x1=Math.min(x0+1,maxX),y1=Math.min(y0+1,maxY),dx=fx-x0,dy=fy-y0;
     const k00=((y0-sy)*sw+x0-sx)*4,k10=((y0-sy)*sw+x1-sx)*4,k01=((y1-sy)*sw+x0-sx)*4,k11=((y1-sy)*sw+x1-sx)*4;
     const r00=floating?src[k00]:linear[src[k00]],r10=floating?src[k10]:linear[src[k10]],r01=floating?src[k01]:linear[src[k01]],r11=floating?src[k11]:linear[src[k11]];
     const g00=floating?src[k00+1]:linear[src[k00+1]],g10=floating?src[k10+1]:linear[src[k10+1]],g01=floating?src[k01+1]:linear[src[k01+1]],g11=floating?src[k11+1]:linear[src[k11+1]];
     const b00=floating?src[k00+2]:linear[src[k00+2]],b10=floating?src[k10+2]:linear[src[k10+2]],b01=floating?src[k01+2]:linear[src[k01+2]],b11=floating?src[k11+2]:linear[src[k11+2]];
     const loR=Math.min(r00,r10,r01,r11),hiR=Math.max(r00,r10,r01,r11),loG=Math.min(g00,g10,g01,g11),hiG=Math.max(g00,g10,g01,g11),loB=Math.min(b00,b10,b01,b11),hiB=Math.max(b00,b10,b01,b11);
     let r=0,g=0,b=0;
     for(let yy=-1;yy<=2;yy++){
      const row=(clamp(y0+yy,0,maxY)-sy)*sw,wy=cubicWeight(yy-dy);
      for(let xx=-1;xx<=2;xx++){
       const k=(row+clamp(x0+xx,0,maxX)-sx)*4,weight=cubicWeight(xx-dx)*wy;
       r+=(floating?src[k]:linear[src[k]])*weight;g+=(floating?src[k+1]:linear[src[k+1]])*weight;b+=(floating?src[k+2]:linear[src[k+2]])*weight;
      }
     }
     r=clamp(r,loR,hiR);g=clamp(g,loG,hiG);b=clamp(b,loB,hiB);
     if((work+=4)>=65536){work=0;abort();await pause();abort();}
     const idx=(j*bw+i)*4;
     buf[idx]=(encode(r*exp)-127.5)*factor+127.5+warmth;
     buf[idx+1]=(encode(g*exp)-127.5)*factor+127.5;
     buf[idx+2]=(encode(b*exp)-127.5)*factor+127.5-warmth;
     buf[idx+3]=255;
    }
   }else for(let j=0;j<bh;j++)for(let i=0;i<bw;i++){
    let alpha=0,r=0,g=0,b=0;
    for(let ay=0;ay<ny;ay++){
     for(let ax=0;ax<nx;ax++){
      const p=map(clamp((left+i-m+(ax+.5)/nx)/w,0,1),clamp((top+j-m+(ay+.5)/ny)/h,0,1));
      const fx=clamp(p.x-.5,0,source.width-1),fy=clamp(p.y-.5,0,source.height-1),x0=Math.floor(fx),y0=Math.floor(fy),x1=Math.min(x0+1,source.width-1),y1=Math.min(y0+1,source.height-1),dx=fx-x0,dy=fy-y0;
      const points=[[x0,y0,(1-dx)*(1-dy)],[x1,y0,dx*(1-dy)],[x0,y1,(1-dx)*dy],[x1,y1,dx*dy]];
      for(const[x,y,weight]of points){if(!weight)continue;const[data,k]=external&&!src?await locateExternal(x,y):locate(x,y),a=data[k+3]/255*weight;alpha+=a;r+=(floating?data[k]:linear[data[k]])*a;g+=(floating?data[k+1]:linear[data[k+1]])*a;b+=(floating?data[k+2]:linear[data[k+2]])*a;}
      if(useCubic){
       const sum=[0,0,0],lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];let opaque=true;
       for(const[x,y]of points){const[data,k]=external&&!src?await locateExternal(x,y):locate(x,y);for(let c=0;c<3;c++){const v=floating?data[k+c]:linear[data[k+c]];lo[c]=Math.min(lo[c],v);hi[c]=Math.max(hi[c],v);}}
       for(let yy=-1;yy<=2;yy++)for(let xx=-1;xx<=2;xx++){const[data,k]=external&&!src?await locateExternal(clamp(x0+xx,0,source.width-1),clamp(y0+yy,0,source.height-1)):locate(clamp(x0+xx,0,source.width-1),clamp(y0+yy,0,source.height-1)),weight=cubicWeight(xx-dx)*cubicWeight(yy-dy);if(data[k+3]!==255)opaque=false;for(let c=0;c<3;c++)sum[c]+=(floating?data[k+c]:linear[data[k+c]])*weight;}
       if(opaque){r=clamp(sum[0],lo[0],hi[0]);g=clamp(sum[1],lo[1],hi[1]);b=clamp(sum[2],lo[2],hi[2]);alpha=1;}
      }
     }
     if((work+=nx*(useCubic?4:1))>=65536){work=0;abort();await pause();abort();}
    }
    const idx=(j*bw+i)*4,channels=[r,g,b];
    for(let c=0;c<3;c++){const v=alpha?encode(channels[c]/alpha*exp):0;buf[idx+c]=(v-127.5)*factor+127.5+(c===0?warmth:c===2?-warmth:0);}
    buf[idx+3]=255*alpha/count;
   }
   const result=oc.createImageData(tw,th);
   for(let j=0;j<th;j++)for(let i=0;i<tw;i++){const p=((j+m)*bw+i+m)*4,d=(j*tw+i)*4,gain=illumination?illumination.gain(left+i,top+j,w,h):1;let changed=false;for(let c=0;c<3;c++){let v=buf[p+c];if(m)v+=sharpness/100*(4*v-buf[p-4+c]-buf[p+4+c]-buf[p-bw*4+c]-buf[p+bw*4+c])/4;result.data[d+c]=illumination?illumination.encode(v,gain):v;if(illumination){rounded[0]=v;changed ||= result.data[d+c]!==rounded[0];}}result.data[d+3]=buf[p+3];if(changed&&left+i>=region.x&&left+i<region.x+region.w&&top+j>=region.y&&top+j<region.y+region.h)illuminationChanged++;}
   oc.putImageData(result,left-region.x,top-region.y);blocks.clear();done+=Math.max(0,Math.min(left+tw,region.x+region.w)-Math.max(left,region.x))*Math.max(0,Math.min(top+th,region.y+region.h)-Math.max(top,region.y));onProgress?.(done/(region.w*region.h));await pause();abort();
  }
  return finish(out);
 }catch(e){out.width=out.height=1;throw e;}finally{scratch.width=scratch.height=1;}
}
function fit4k(r){return r>=3840/2160?{w:3840,h:Math.round(3840/r)}:{w:Math.round(2160*r),h:2160};}
// Detect high contrast quadrilateral candidates via connected edge components.
function autoQuad(image){const s=Math.min(1,700/image.width,700/image.height),c=canvas(Math.round(image.width*s),Math.round(image.height*s)),g=ctx(c);g.drawImage(image,0,0,c.width,c.height);const w=c.width,h=c.height,d=g.getImageData(0,0,w,h).data,gray=new Float32Array(w*h),edge=new Uint8Array(w*h);for(let i=0;i<gray.length;i++)gray[i]=.2126*d[i*4]+.7152*d[i*4+1]+.0722*d[i*4+2];for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++){const i=y*w+x;if(Math.hypot(gray[i+1]-gray[i-1],gray[i+w]-gray[i-w])>34)for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)edge[i+a*w+b]=1;}let best=null,score=0;const queue=new Int32Array(w*h);for(let start=0;start<edge.length;start++){if(!edge[start])continue;let head=0,tail=1;queue[0]=start;edge[start]=0;let tl={x:w,y:h},tr={x:0,y:h},br={x:0,y:0},bl={x:w,y:0},minx=w,maxx=0,miny=h,maxy=0;while(head<tail){const i=queue[head++],x=i%w,y=Math.floor(i/w);minx=Math.min(minx,x);maxx=Math.max(maxx,x);miny=Math.min(miny,y);maxy=Math.max(maxy,y);if(x+y<tl.x+tl.y)tl={x,y};if(x-y>tr.x-tr.y)tr={x,y};if(x+y>br.x+br.y)br={x,y};if(x-y<bl.x-bl.y)bl={x,y};for(const j of[i-1,i+1,i-w,i+w])if(j>=0&&j<edge.length&&edge[j]){edge[j]=0;queue[tail++]=j;}}const q=[tl,tr,br,bl],area=(maxx-minx)*(maxy-miny),center=Math.hypot((minx+maxx)/2-w/2,(miny+maxy)/2-h/2);if(area>w*h*.025&&area<w*h*.85&&minx>3&&miny>3&&maxx<w-4&&maxy<h-4&&validQuad(q,w,h)){const value=area/(1+center/w*3);if(value>score){score=value;best=q.map(p=>({x:p.x/s,y:p.y/s}));}}}return best;}
function focus(c){const w=c.width,h=c.height,d=ctx(c).getImageData(0,0,w,h).data,gray=new Float32Array(w*h);let mean=0;for(let i=0;i<gray.length;i++){gray[i]=.2126*d[i*4]+.7152*d[i*4+1]+.0722*d[i*4+2];mean+=gray[i];}mean/=gray.length;
// Reduce high-frequency noise before comparing gradients. This is a heuristic,
// not proof of best focus; aligned native patches still need visual comparison.
const filtered=new Float32Array(gray),tmp=new Float32Array(w*h),kernel=[1,4,6,4,1];
for(let pass=0;pass<2;pass++){
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=0;for(let k=-2;k<=2;k++)v+=filtered[y*w+clamp(x+k,0,w-1)]*kernel[k+2];tmp[y*w+x]=v/16;}
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=0;for(let k=-2;k<=2;k++)v+=tmp[clamp(y+k,0,h-1)*w+x]*kernel[k+2];filtered[y*w+x]=v/16;}
}
const scores=[];for(const[u,v]of[[.25,.25],[.75,.25],[.5,.5],[.25,.75],[.75,.75]]){const x0=Math.round(w*(u-.08)),y0=Math.round(h*(v-.08)),x1=Math.round(w*(u+.08)),y1=Math.round(h*(v+.08));let sum=0,n=0,e=0,varn=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){sum+=filtered[y*w+x];n++;}const m=sum/n;for(let y=y0+2;y<y1-2;y++)for(let x=x0+2;x<x1-2;x++){const i=y*w+x;e+=(filtered[i+2]-filtered[i-2])**2+(filtered[i+2*w]-filtered[i-2*w])**2;varn+=(filtered[i]-m)**2;}scores.push(e/Math.max(varn,1));}const signature=[];for(let gy=0;gy<8;gy++)for(let gx=0;gx<8;gx++){const x0=Math.floor(gx*w/8),x1=Math.max(x0+1,Math.floor((gx+1)*w/8)),y0=Math.floor(gy*h/8),y1=Math.max(y0+1,Math.floor((gy+1)*h/8));let sum=0,n=0;for(let y=y0;y<Math.min(h,y1);y++)for(let x=x0;x<Math.min(w,x1);x++){sum+=gray[y*w+x];n++;}signature.push(sum/Math.max(n,1)-mean);}return{scores,score:scores.reduce((a,b)=>a+b,0)/scores.length,signature,mean};}
function similarity(a,b){let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]**2;bb+=b[i]**2;}return dot/Math.sqrt(aa*bb||1);}
async function blob(c,type,quality=.95){
 const target=type==='image/jpeg'&&!c.opaque?canvas(c.width,c.height):c;
 try{
  if(target!==c){const g=ctx(target);g.fillStyle='#fff';g.fillRect(0,0,target.width,target.height);g.drawImage(c,0,0);}
  return await new Promise((resolve,reject)=>target.toBlob(b=>b?resolve(b):reject(Error('書き出しに失敗しました。')),type,quality));
 }finally{if(target!==c)target.width=target.height=1;}
}
return{largestOutput,resamplingInfo,canvas,ctx,decode,header,fullQuad,dimensions,validQuad,homography,render,autoQuad,focus,similarity,fit4k,validateOutput,checkCanvas,blob};})();
