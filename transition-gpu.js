/* Native-grid guarded RGB edge transitions. Research WebGPU implementation.
 * V2: integer sample base + float32 displacement; exact bilinear, reflect101.
 * No photo network calls, models, resizing, or silent backend fallback.
 */
'use strict';
globalThis.TransitionGPU=(()=>{
 const profiles=Object.freeze({mild:{gamma:1.35,strength:.65},medium:{gamma:1.5,strength:.85},strong:{gamma:2,strength:.85}});
 let contextPromise=null,contextGeneration=0,busy=false;
 const common=`
 struct P { w:u32,h:u32,n:u32,iteration:u32,gamma:f32,strength:f32,inset:u32,pad:u32 };
 @group(0) @binding(0) var<uniform> p:P;
 fn reflect(v:i32,n:i32)->i32 {if(n<=1){return 0;}let period=2*(n-1);let q=((v%period)+period)%period;return select(period-q,q,q<n);}
 fn idx(x:i32,y:i32)->u32{return u32(reflect(y,i32(p.h)))*p.w+u32(reflect(x,i32(p.w)));}
 fn lum(a:vec3<f32>)->f32{return a.x*0.2126+a.y*0.7152+a.z*0.0722;}
 fn ramp(a:f32,lo:f32,hi:f32)->f32{let t=clamp((a-lo)/(hi-lo),0.,1.);return t*t*(3.-2.*t);}
 fn interior(x:u32,y:u32)->bool{return x>=p.inset&&y>=p.inset&&x+p.inset<p.w&&y+p.inset<p.h;}
 `;
 const entry=`@compute @workgroup_size(16,16) fn main(@builtin(global_invocation_id) gid:vec3<u32>){let x=gid.x;let y=gid.y;if(x>=p.w||y>=p.h){return;}let i=y*p.w+x;`;
 const sample=(name,type='vec4<f32>')=>`
 fn sample_${name}(base:vec2<i32>,offset:vec2<f32>)->${type}{
  let q=vec2<i32>(floor(offset));let f=offset-vec2<f32>(q);let a=base+q;
  let h0=${name}[idx(a.x,a.y)]*(1.-f.x)+${name}[idx(a.x+1,a.y)]*f.x;
  let h1=${name}[idx(a.x,a.y+1)]*(1.-f.x)+${name}[idx(a.x+1,a.y+1)]*f.x;
  return h0*(1.-f.y)+h1*f.y;
 }`;
 function gaussian(sigma){const size=Math.round(sigma*8+1)|1,r=(size-1)/2,arr=[];let sum=0;for(let d=-r;d<=r;d++){const v=Math.exp(-d*d/(2*sigma*sigma));arr.push(v);sum+=v;}return arr.map(v=>Math.fround(v/sum));}
 const fl=v=>{const s=Number(v).toPrecision(10);return s.includes('.')||s.includes('e')?s:s+'.0';};
 function blurShader(sigma,horizontal){const k=gaussian(sigma),r=(k.length-1)/2;return common+`
 @group(0) @binding(1) var<storage,read> src:array<vec4<f32>>;
 @group(0) @binding(2) var<storage,read_write> dst:array<vec4<f32>>;
 const weights=array<f32,${k.length}>(${k.map(fl).join(',')});
 `+entry+`var value=vec4<f32>(0.);for(var d:i32=-${r};d<=${r};d++){value+=src[idx(i32(x)${horizontal?'+d':''},i32(y)${horizontal?'':'+d'})]*weights[u32(d+${r})];}dst[i]=value;}`;}
 const decode=common+`
 @group(0) @binding(1) var<storage,read> packed:array<u32>;
 @group(0) @binding(2) var<storage,read_write> raw:array<vec4<f32>>;
 fn linear(v:f32)->f32{if(v<=.04045){return v/12.92;}return pow((v+.055)/1.055,2.4);}
 `+entry+`let q=packed[i];let a=vec3<f32>(linear(f32(q&255u)/255.),linear(f32((q>>8u)&255u)/255.),linear(f32((q>>16u)&255u)/255.));raw[i]=vec4<f32>(a,lum(a));}`;
 const sobel=common+`
 @group(0) @binding(1) var<storage,read> blurred:array<vec4<f32>>;
 @group(0) @binding(2) var<storage,read_write> normal:array<vec4<f32>>;
 @group(0) @binding(3) var<storage,read_write> tensor:array<vec4<f32>>;
 `+entry+`var gx=0.;var gy=0.;for(var dy:i32=-1;dy<=1;dy++){for(var dx:i32=-1;dx<=1;dx++){let v=blurred[idx(i32(x)+dx,i32(y)+dy)].w;gx+=v*f32(dx)*select(1.,2.,dy==0);gy+=v*f32(dy)*select(1.,2.,dx==0);}}gx/=8.;gy/=8.;let mag=sqrt(gx*gx+gy*gy);normal[i]=vec4<f32>(gx/max(mag,1e-10),gy/max(mag,1e-10),mag,0.);tensor[i]=vec4<f32>(gx*gx,gy*gy,gx*gy,0.);}`;
 const mapStruct=`struct Map {loT:vec4<f32>,vMask:vec4<f32>};`;
 const analyze=common+mapStruct+`
 @group(0) @binding(1) var<storage,read> raw:array<vec4<f32>>;
 @group(0) @binding(2) var<storage,read> smoothedRGB:array<vec4<f32>>;
 @group(0) @binding(3) var<storage,read> normal:array<vec4<f32>>;
 @group(0) @binding(4) var<storage,read> tensor:array<vec4<f32>>;
 @group(0) @binding(5) var<storage,read_write> maps:array<Map>;
 `+sample('smoothedRGB')+`
 fn endpoint(a:array<vec3<f32>,9>,sign:f32,threshold:f32)->vec2<u32>{
  for(var d:u32=1u;d<=8u;d++){let inc=sign*(lum(a[d])-lum(a[d-1u]));if(inc<-.0005){return vec2<u32>(d-1u,1u);}if(d<8u){let next=sign*(lum(a[d+1u])-lum(a[d]));if(inc<=threshold&&next<=threshold){return vec2<u32>(d,2u);}}}return vec2<u32>(8u,0u);
 }
 `+entry+`
 let base=vec2<i32>(i32(x),i32(y));let nm=normal[i];let direction=nm.xy;
 var plus:array<vec3<f32>,9>;var minus:array<vec3<f32>,9>;plus[0]=smoothedRGB[i].xyz;minus[0]=smoothedRGB[i].xyz;
 for(var d:u32=1u;d<=8u;d++){let offset=f32(d)*direction;plus[d]=sample_smoothedRGB(base,offset).xyz;minus[d]=sample_smoothedRGB(base,-offset).xyz;}
 let central=lum(plus[1]-minus[1]);let threshold=max(.0005,.15*max(central*.5,0.));
 let high=endpoint(plus,1.,threshold);let low=endpoint(minus,-1.,threshold);let lo=minus[low.x];let hi=plus[high.x];let v=hi-lo;
 let contrast=max(lum(v),0.);let t=dot(raw[i].xyz-lo,v)/max(dot(v,v),1e-12);let j=tensor[i];
 let coherence=sqrt((j.x-j.y)*(j.x-j.y)+4.*j.z*j.z)/(j.x+j.y+1e-12);
 var mask=ramp(coherence,.65,.92)*ramp(contrast,.025,.08)*ramp(nm.z,.001,.006);
 mask*=ramp(f32(min(low.x,high.x)),1.5,3.5);mask*=select(1.,.65,low.y==0u||high.y==0u);
 mask*=1.-ramp(central/max(contrast,1e-10),.65,.9);mask*=ramp(t,.02,.15)*(1.-ramp(t,.85,.98));
 if(x<16u||y<16u||x+16u>=p.w||y+16u>=p.h){mask=0.;}
 maps[i]=Map(vec4<f32>(lo,t),vec4<f32>(v,clamp(mask,0.,1.)));
 }`;
 const prepare=common+mapStruct+`
 @group(0) @binding(1) var<storage,read> raw:array<vec4<f32>>;
 @group(0) @binding(2) var<storage,read> maps:array<Map>;
 @group(0) @binding(3) var<storage,read> normal:array<vec4<f32>>;
 @group(0) @binding(4) var<storage,read_write> delta:array<vec4<f32>>;
 @group(0) @binding(5) var<storage,read_write> state:array<vec4<f32>>;
 `+sample('raw')+entry+`
 let a=raw[i].xyz;let m=maps[i];let t=m.loT.w;let lo=m.loT.xyz;let v=m.vMask.xyz;let hi=lo+v;
 let u=clamp(t,0.,1.);let up=pow(u,p.gamma);let down=pow(1.-u,p.gamma);var alpha=up/max(up+down,1e-20)-t;
 var lower=-1e30;var upper=1e30;for(var c:u32=0u;c<3u;c++){if(abs(v[c])>1e-7){let q0=(min(min(lo[c],hi[c]),a[c])-a[c])/v[c];let q1=(max(max(lo[c],hi[c]),a[c])-a[c])/v[c];lower=max(lower,min(q0,q1));upper=min(upper,max(q0,q1));}}
 alpha=clamp(alpha,lower,upper);let dv=alpha*v;delta[i]=vec4<f32>(dv,lum(dv));
 let base=vec2<i32>(i32(x),i32(y));let dir=normal[i].xy;let before=sample_raw(base,dir).w-sample_raw(base,-dir).w;
 let weight=m.vMask.w*p.strength;state[i]=vec4<f32>(weight,before,weight,0.);
 }`;
 const deltaLuma=common+`
 @group(0) @binding(1) var<storage,read> raw:array<vec4<f32>>;
 @group(0) @binding(2) var<storage,read> delta:array<vec4<f32>>;
 @group(0) @binding(3) var<storage,read> state:array<vec4<f32>>;
 @group(0) @binding(4) var<storage,read_write> dl:array<f32>;
 `+entry+`let change=state[i].x*delta[i].xyz;let z=raw[i].xyz+change;dl[i]=lum(z-raw[i].xyz);}`;
 const guard=common+`
 @group(0) @binding(1) var<storage,read> dl:array<f32>;
 @group(0) @binding(2) var<storage,read> normal:array<vec4<f32>>;
 @group(0) @binding(3) var<storage,read> state:array<vec4<f32>>;
 @group(0) @binding(4) var<storage,read_write> reduction:array<f32>;
 @group(0) @binding(5) var<storage,read_write> counters:array<atomic<u32>>;
 `+sample('dl','f32')+entry+`let base=vec2<i32>(i32(x),i32(y));let dir=normal[i].xy;let change=sample_dl(base,dir)-sample_dl(base,-dir);let before=state[i].y;var r=1.;if(before>.002&&before+change<.2*before){r=clamp(.8*before/max(-change,1e-12)*.9,0.,.95);atomicAdd(&counters[p.iteration],1u);if(interior(x,y)){atomicAdd(&counters[24u+p.iteration],1u);}}reduction[i]=r;}`;
 const erodeX=common+`
 @group(0) @binding(1) var<storage,read> reduction:array<f32>;
 @group(0) @binding(2) var<storage,read_write> tmp:array<f32>;
 `+entry+`var r=1.;for(var d:i32=-2;d<=2;d++){r=min(r,reduction[y*p.w+u32(clamp(i32(x)+d,0,i32(p.w)-1))]);}tmp[i]=r;}`;
 const erodeY=common+`
 @group(0) @binding(1) var<storage,read> tmp:array<f32>;
 @group(0) @binding(2) var<storage,read> src:array<vec4<f32>>;
 @group(0) @binding(3) var<storage,read_write> dst:array<vec4<f32>>;
 `+entry+`var r=1.;for(var d:i32=-2;d<=2;d++){r=min(r,tmp[u32(clamp(i32(y)+d,0,i32(p.h)-1))*p.w+x]);}let s=src[i];dst[i]=vec4<f32>(s.x*r,s.yzw);}`;
 const encode=common+`
 @group(0) @binding(1) var<storage,read> packed:array<u32>;
 @group(0) @binding(2) var<storage,read> raw:array<vec4<f32>>;
 @group(0) @binding(3) var<storage,read> delta:array<vec4<f32>>;
 @group(0) @binding(4) var<storage,read> state:array<vec4<f32>>;
 @group(0) @binding(5) var<storage,read_write> output:array<u32>;
 @group(0) @binding(6) var<storage,read_write> counters:array<atomic<u32>>;
 fn code(a:f32)->u32{let v=clamp(a,0.,1.);var e=1.055*pow(v,1./2.4)-.055;if(v<=.0031308){e=12.92*v;}let q=clamp(e*255.,0.,255.);let lo=floor(q);let f=q-lo;var result=u32(lo);if(f>.5||(f==.5&&(result&1u)==1u)){result+=1u;}return result;}
 `+entry+`let original=packed[i];if(state[i].x==0.){output[i]=original;return;}let z=raw[i].xyz+state[i].x*delta[i].xyz;let r=code(z.x);let g=code(z.y);let b=code(z.z);let value=r|(g<<8u)|(b<<16u)|0xff000000u;output[i]=value;if(interior(x,y)){atomicAdd(&counters[49u],1u);if(value!=original){atomicAdd(&counters[48u],1u);}let dr=abs(i32(r)-i32(original&255u));let dg=abs(i32(g)-i32((original>>8u)&255u));let db=abs(i32(b)-i32((original>>16u)&255u));atomicMax(&counters[50u],u32(max(dr,max(dg,db))));if(state[i].x<state[i].z-1e-6){atomicAdd(&counters[53u],1u);}}}`;
 const finalStats=common+`
 @group(0) @binding(1) var<storage,read> dl:array<f32>;
 @group(0) @binding(2) var<storage,read> normal:array<vec4<f32>>;
 @group(0) @binding(3) var<storage,read> state:array<vec4<f32>>;
 @group(0) @binding(4) var<storage,read_write> counters:array<atomic<u32>>;
 `+sample('dl','f32')+entry+`if(!interior(x,y)){return;}let base=vec2<i32>(i32(x),i32(y));let dir=normal[i].xy;let change=sample_dl(base,dir)-sample_dl(base,-dir);let before=state[i].y;let after=before+change;if(before>.002&&after<.2*before){atomicAdd(&counters[51u],1u);}if(before>.002&&after<-.002){atomicAdd(&counters[52u],1u);}}`;
 async function context(){
  if(!navigator.gpu)throw Error('WebGPU is required for this experimental path.');
  if(!contextPromise){const generation=++contextGeneration;let initializingDevice;contextPromise=(async()=>{
   const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw Error('No WebGPU adapter.');
   const device=await adapter.requestDevice();initializingDevice=device;device.lost.then(()=>{if(contextGeneration===generation)contextPromise=null;});
   const shaders={decode,sobel,analyze,prepare,deltaLuma,guard,erodeX,erodeY,encode,finalStats};
   for(const [tag,sigma] of [['d',1.1],['t',1.8],['p',.6]]){shaders[tag+'X']=blurShader(sigma,true);shaders[tag+'Y']=blurShader(sigma,false);}
   const pipelines={};for(const [name,code] of Object.entries(shaders)){
    const module=device.createShaderModule({label:'transition-'+name,code});
    const info=await module.getCompilationInfo();const errors=info.messages.filter(m=>m.type==='error');
    if(errors.length)throw Error(name+': '+errors.map(m=>`${m.lineNum}:${m.linePos} ${m.message}`).join('\n'));
    pipelines[name]=await device.createComputePipelineAsync({label:'transition-'+name,layout:'auto',compute:{module,entryPoint:'main'}});
   }
   return{device,pipelines};
  })().catch(e=>{if(initializingDevice)initializingDevice.destroy();if(contextGeneration===generation)contextPromise=null;throw e;});}
  return contextPromise;
 }
 async function run(input,w,h,profile='medium',options={}){
  if(busy)throw Error('TransitionGPU is already processing a tile.');
  const rgba=input instanceof ArrayBuffer?new Uint8Array(input):input,n=w*h,pr=profiles[profile];
  if(!pr||!Number.isInteger(w)||!Number.isInteger(h)||w<2||h<2||n>2e6||!(rgba instanceof Uint8Array||rgba instanceof Uint8ClampedArray)||rgba.byteLength!==n*4)throw Error('Invalid transition tile/profile. Maximum tile is 2,000,000 pixels.');
  for(let i=3;i<rgba.length;i+=4)if(rgba[i]!==255)throw Error('Opaque RGBA photos only.');
  const inset=options.statsInset??0;if(!Number.isInteger(inset)||inset<0||inset*2>=Math.min(w,h))throw Error('Invalid statsInset.');
  busy=true;const start=performance.now(),wasWarm=!!contextPromise,buffers=[];let device,validationScopePending=false;
  try{
   const ctx=await context();device=ctx.device;const pipelines=ctx.pipelines;
   if(n*32>device.limits.maxStorageBufferBindingSize||n*32>device.limits.maxBufferSize)throw Error('Tile exceeds GPU buffer limit.');
   device.pushErrorScope('validation');validationScopePending=true;const setupMs=performance.now()-start;let allocatedBytes=0;
   function buffer(label,bytes,usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST){const b=device.createBuffer({label,size:Math.max(4,bytes),usage});buffers.push(b);allocatedBytes+=Math.max(4,bytes);return b;}
   const packed=buffer('rgba-input',n*4),output=buffer('rgba-output',n*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);
   const raw=buffer('raw-linear',n*16),tmp=buffer('blur-temporary',n*16),deriv=buffer('derivative-then-tensor',n*16),tensor=buffer('tensor',n*16),normal=buffer('normal',n*16),smoothedRGB=buffer('smoothedRGB-rgb',n*16),maps=buffer('endpoint-maps',n*32),delta=buffer('base-color-delta',n*16),stateA=buffer('weight-A',n*16),stateB=buffer('weight-B',n*16),dl=buffer('actual-delta-luma',n*4),reduction=buffer('guard-reduction',n*4),reductionTmp=buffer('guard-reduction-temp',n*4),counters=buffer('counters',256,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC);
   const uniforms=buffer('uniforms',24*256,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),data=new ArrayBuffer(24*256),dv=new DataView(data);
   for(let it=0;it<24;it++){const o=it*256;dv.setUint32(o,w,true);dv.setUint32(o+4,h,true);dv.setUint32(o+8,n,true);dv.setUint32(o+12,it,true);dv.setFloat32(o+16,pr.gamma,true);dv.setFloat32(o+20,pr.strength,true);dv.setUint32(o+24,inset,true);}
   device.queue.writeBuffer(uniforms,0,data);device.queue.writeBuffer(packed,0,rgba.buffer,rgba.byteOffset,rgba.byteLength);device.queue.writeBuffer(counters,0,new Uint32Array(64));
   const encoder=device.createCommandEncoder({label:'transition-tile'}),commandsStart=performance.now();
   function dispatch(name,list,iteration=0){const pipeline=pipelines[name];const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniforms,offset:iteration*256,size:32}},...list.map((b,i)=>({binding:i+1,resource:{buffer:b}}))]});const pass=encoder.beginComputePass({label:name});pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(w/16),Math.ceil(h/16));pass.end();}
   dispatch('decode',[packed,raw]);dispatch('dX',[raw,tmp]);dispatch('dY',[tmp,deriv]);dispatch('sobel',[deriv,normal,tensor]);dispatch('tX',[tensor,tmp]);dispatch('tY',[tmp,deriv]);dispatch('pX',[raw,tmp]);dispatch('pY',[tmp,smoothedRGB]);dispatch('analyze',[raw,smoothedRGB,normal,deriv,maps]);dispatch('prepare',[raw,maps,normal,delta,stateA]);
   let state=stateA,next=stateB;
   for(let it=0;it<24;it++){dispatch('deltaLuma',[raw,delta,state,dl]);dispatch('guard',[dl,normal,state,reduction,counters],it);dispatch('erodeX',[reduction,reductionTmp]);dispatch('erodeY',[reductionTmp,state,next]);[state,next]=[next,state];}
   dispatch('deltaLuma',[raw,delta,state,dl]);dispatch('finalStats',[dl,normal,state,counters]);dispatch('encode',[packed,raw,delta,state,output,counters]);
   const readback=buffer('output-readback',n*4,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST),statsback=buffer('stats-readback',256,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
   encoder.copyBufferToBuffer(output,0,readback,0,n*4);encoder.copyBufferToBuffer(counters,0,statsback,0,256);const encodeCommandsMs=performance.now()-commandsStart;
   const submitted=performance.now();device.queue.submit([encoder.finish()]);await Promise.all([readback.mapAsync(GPUMapMode.READ),statsback.mapAsync(GPUMapMode.READ)]);
   const result=new Uint8ClampedArray(readback.getMappedRange().slice(0)),statsRaw=new Uint32Array(statsback.getMappedRange().slice(0));readback.unmap();statsback.unmap();
   validationScopePending=false;const validation=await device.popErrorScope();if(validation)throw Error(validation.message);
   const all=Array.from(statsRaw.slice(0,24)),core=Array.from(statsRaw.slice(24,48));const firstZero=all.indexOf(0),iterations=firstZero<0?24:firstZero+1;
   return{rgba:result,stats:{backend:'webgpu',method:'guarded-rgb-monotone-transition-v2',profile,width:w,height:h,processingGrid:'original',resampled:false,statsInset:inset,
    guardIterations:iterations,guardIterationsDispatched:24,guardViolationCounts:all.slice(0,iterations),guardCoreViolationCounts:core.slice(0,iterations),guardRemainingBelow20PercentOriginalSlope:statsRaw[51],normalSlopeReversalPixelCount:statsRaw[52],
    changedPixels:statsRaw[48],activePixels:statsRaw[49],maxCodeChange:statsRaw[50],guardAttenuatedPixels:statsRaw[53],allocatedGpuBufferBytes:allocatedBytes,pipelineWasWarm:wasWarm,setupMs,encodeCommandsMs,gpuExecutionAndReadbackMs:performance.now()-submitted,totalMs:performance.now()-start,
    sampler:'integer base plus float32 relative offset, exact bilinear reflect101',limits:'structure heuristic; not optical recovery or semantic fidelity confidence'}};
  }finally{
   // Balance the scope even when allocation, submission, mapAsync or validation
   // fails. Do not let an old lost-device callback discard a newer context.
   if(validationScopePending&&device){validationScopePending=false;try{await device.popErrorScope();}catch{}}
   for(const b of buffers){try{if(b.mapState==='mapped')b.unmap();b.destroy();}catch{}}
   busy=false;
  }
 }
 return{profiles,run,init:context};
})();
