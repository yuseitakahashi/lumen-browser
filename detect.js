'use strict';
// Local geometric boundary hypotheses. Scores describe edges, not artwork identity.
const ArtworkBounds=(()=>{
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const area=q=>Math.abs(q.reduce((n,p,i)=>n+p.x*q[(i+1)%4].y-q[(i+1)%4].x*p.y,0))/2;
 const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 const pointLine=(p,a,b)=>Math.abs((b.x-a.x)*(a.y-p.y)-(a.x-p.x)*(b.y-a.y))/Math.max(1,dist(a,b));
 function inside(p,q){return q.every((a,i)=>{const b=q[(i+1)%4];return (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x)>=-1;});}
 function valid(q,w,h){return q.length===4&&q.every((p,i)=>{const b=q[(i+1)%4],c=q[(i+2)%4];return Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>2&&p.y>2&&p.x<w-3&&p.y<h-3&&(b.x-p.x)*(c.y-b.y)-(b.y-p.y)*(c.x-b.x)>30&&dist(p,b)>35;});}
 function find({data,width:w,height:h}){
  if(w<40||h<40)return [];
  const n=w*h,gray=new Float32Array(n),gx=new Float32Array(n),gy=new Float32Array(n),mag=new Float32Array(n);
  for(let i=0;i<n;i++)gray[i]=.2126*data[i*4]+.7152*data[i*4+1]+.0722*data[i*4+2];
  // A small 3x3 average suppresses fine paint texture without changing the image.
  const smooth=new Float32Array(n);
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){let sum=0;for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++)sum+=gray[(y+j)*w+x+i];smooth[y*w+x]=sum/9;}
  const points=[];const threshold=12;
  for(let y=3;y<h-3;y++)for(let x=3;x<w-3;x++){const k=y*w+x;gx[k]=smooth[k+2]-smooth[k-2];gy[k]=smooth[k+2*w]-smooth[k-2*w];mag[k]=Math.hypot(gx[k],gy[k]);if(mag[k]>=threshold&&((x+y)%2===0))points.push({x,y,k});}
  if(points.length<80)return [];
  const diagonal=Math.ceil(Math.hypot(w,h)),rhoBins=diagonal*2+1;
  function lines(vertical){const angles=[];for(let a=vertical?-28:62;a<= (vertical?28:118);a++)angles.push(a*Math.PI/180);const cos=angles.map(Math.cos),sin=angles.map(Math.sin),acc=new Float32Array(angles.length*rhoBins);
   for(const p of points){if(vertical?Math.abs(gx[p.k])<Math.abs(gy[p.k])*.65:Math.abs(gy[p.k])<Math.abs(gx[p.k])*.65)continue;const weight=Math.min(4,mag[p.k]/25);for(let t=0;t<angles.length;t++){const r=Math.round(p.x*cos[t]+p.y*sin[t])+diagonal;acc[t*rhoBins+r]+=weight;}}
   const peaks=[];for(let t=0;t<angles.length;t++)for(let r=1;r<rhoBins-1;r++){const v=acc[t*rhoBins+r];if(v>Math.min(w,h)*.15&&v>=acc[t*rhoBins+r-1]&&v>=acc[t*rhoBins+r+1])peaks.push({t,r,v});}peaks.sort((a,b)=>b.v-a.v);
   const kept=[];for(const p of peaks){const nx=cos[p.t],ny=sin[p.t],rho=p.r-diagonal,a=vertical?-ny/nx:-nx/ny,b=vertical?rho/nx:rho/ny;const long=vertical?h:w;if(kept.some(k=>Math.max(Math.abs((a-k.a)*long*.25+b-k.b),Math.abs((a-k.a)*long*.75+b-k.b))<5))continue;kept.push({nx,ny,rho,a,b,v:p.v});if(kept.length===18)break;}return kept;}
  const vs=lines(true),hs=lines(false);if(vs.length<2||hs.length<2)return [];
  function cross(v,h){const y=(h.a*v.b+h.b)/(1-h.a*v.a);return{x:v.a*y+v.b,y};}
  function sideSupport(a,b){const dx=b.x-a.x,dy=b.y-a.y,len=dist(a,b),nx=-dy/len,ny=dx/len;let good=0,energy=0;const steps=Math.min(110,Math.max(24,Math.round(len/3)));
   for(let i=0;i<steps;i++){const t=(i+.5)/steps,x=a.x+dx*t,y=a.y+dy*t;let best=0;for(let shift=-2;shift<=2;shift++){const xx=clamp(Math.round(x+nx*shift),0,w-1),yy=clamp(Math.round(y+ny*shift),0,h-1),k=yy*w+xx;best=Math.max(best,Math.abs(gx[k]*nx+gy[k]*ny));}if(best>=threshold)good++;energy+=Math.min(1,best/70);}return{support:good/steps,energy:energy/steps};}
  const quads=[];
  for(let l=0;l<vs.length;l++)for(let r=l+1;r<vs.length;r++){let left=vs[l],right=vs[r];if(left.a*h/2+left.b>right.a*h/2+right.b)[left,right]=[right,left];if(Math.abs(left.a-right.a)>.55)continue;
   for(let t=0;t<hs.length;t++)for(let b=t+1;b<hs.length;b++){let top=hs[t],bottom=hs[b];if(top.a*w/2+top.b>bottom.a*w/2+bottom.b)[top,bottom]=[bottom,top];if(Math.abs(top.a-bottom.a)>.55)continue;
    const q=[cross(left,top),cross(right,top),cross(right,bottom),cross(left,bottom)];if(!valid(q,w,h))continue;const size=area(q);if(size<n*.025||size>n*.88)continue;const d=q.map((p,i)=>sideSupport(p,q[(i+1)%4])),min=Math.min(...d.map(s=>s.support)),support=d.reduce((a,s)=>a+s.support,0)/4;if(min<.62||support<.78)continue;
    const cx=q.reduce((s,p)=>s+p.x,0)/4,cy=q.reduce((s,p)=>s+p.y,0)/4,center=1-clamp(Math.hypot(cx-w/2,cy-h/2)/Math.hypot(w,h),0,1),energy=d.reduce((a,s)=>a+s.energy,0)/4;
    const score=.55*support+.15*energy+.2*Math.sqrt(size/n)+.1*center;
    quads.push({quad:q,area:size,support,minSupport:min,energy,score});
   }
  }
  // Keep enough distinct geometric hypotheses for nested frames. Truncating
  // at 70 let ornate outer edges crowd out an otherwise supported inner box.
  quads.sort((a,b)=>b.score-a.score);const unique=[];for(const c of quads){if(unique.some(k=>Math.sqrt(k.quad.reduce((s,p,i)=>s+dist(p,c.quad[i])**2,0)/4)<6))continue;unique.push(c);if(unique.length>=300)break;}
  if(!unique.length)return [];
  // Choose large closed outer hypotheses; do not simply choose the innermost box.
  const roots=unique.filter(c=>!unique.some(p=>p.area>c.area*1.12&&c.quad.every(v=>inside(v,p.quad))&&p.score>c.score-.08)).sort((a,b)=>b.score-a.score).slice(0,3);
  const candidates=[];
  const add=(c,kind,bonus=0,reason='四辺の連続した境界を検出')=>{const existing=candidates.find(k=>Math.sqrt(k.quad.reduce((s,p,i)=>s+dist(p,c.quad[i])**2,0)/4)<6);if(existing)return;const confidence=clamp(.65*c.support+.2*c.minSupport+.15*c.energy,0,.95);candidates.push({...c,kind,confidence,rank:c.score+bonus,ambiguous:true,requiresConfirmation:true,reasons:[reason,`四辺の支持率 ${Math.round(c.support*100)}%`,'額縁と絵柄の意味は自動確定しません']});};
  for(const outer of roots){const options=[];
   for(const inner of unique){const ratio=inner.area/outer.area;if(ratio<.4||ratio>.94||!inner.quad.every(p=>inside(p,outer.quad)))continue;const insets=inner.quad.map((p,i)=>pointLine({x:(p.x+inner.quad[(i+1)%4].x)/2,y:(p.y+inner.quad[(i+1)%4].y)/2},outer.quad[i],outer.quad[(i+1)%4]));const shorter=Math.min(...outer.quad.map((p,i)=>dist(p,outer.quad[(i+1)%4]))),min=Math.min(...insets),max=Math.max(...insets);if(min<Math.max(4,shorter*.018)||max>shorter*.24||max/min>3.5)continue;
    // A corresponding frame side must be inset at both endpoints. A
    // midpoint alone lets diagonal picture details masquerade as a frame.
    const ends=inner.quad.flatMap((p,i)=>[pointLine(p,outer.quad[i],outer.quad[(i+1)%4]),pointLine(inner.quad[(i+1)%4],outer.quad[i],outer.quad[(i+1)%4])]);
    if(Math.min(...ends)<Math.max(3,shorter*.012)||Math.max(...ends)>shorter*.3)continue;
    let sum=0,sumSq=0,count=0;for(let side=0;side<4;side++)for(let j=0;j<20;j++){const t=(j+.5)/20,a=outer.quad[side],b=outer.quad[(side+1)%4],c=inner.quad[side],d=inner.quad[(side+1)%4],x=Math.round(((a.x+(b.x-a.x)*t)+(c.x+(d.x-c.x)*t))/2),y=Math.round(((a.y+(b.y-a.y)*t)+(c.y+(d.y-c.y)*t))/2),v=gray[clamp(y,0,h-1)*w+clamp(x,0,w-1)];sum+=v;sumSq+=v*v;count++;}const spread=Math.sqrt(Math.max(0,sumSq/count-(sum/count)**2)),uniform=1-clamp(spread/70,0,1);
    options.push({inner,value:inner.score+.12*uniform+.12*(min/max)+.1*ratio,uniform,insets});
   }
   options.sort((a,b)=>b.value-a.value);if(options.length){const best=options[0];add(best.inner,'inner',.25,'外周の中に、4辺が対応する内側境界を検出');add(outer,'outer',.05,'内側候補を囲む外周。額縁・影を含む可能性');}else add(outer,'boundary',0,'独立した外周候補。額縁なし・内側境界不明の可能性');
  }
  candidates.sort((a,b)=>b.rank-a.rank);return candidates.slice(0,6).map(({quad,kind,confidence,support,minSupport,ambiguous,requiresConfirmation,reasons})=>({quad,kind,confidence,support,minSupport,ambiguous,requiresConfirmation,reasons}));
 }
 function detect(image){
  // Detection is bounded even if a future caller passes a full camera bitmap.
  // This thumbnail is only for boundary coordinates; exported pixels still use
  // the original source. Independent x/y factors account for rounded sizes.
  if(Math.max(image.width,image.height)>1400){
   const scale=1400/Math.max(image.width,image.height),c=PhotoEngine.canvas(Math.round(image.width*scale),Math.round(image.height*scale));
   try{PhotoEngine.ctx(c).drawImage(image,0,0,image.width,image.height,0,0,c.width,c.height);const sx=image.width/c.width,sy=image.height/c.height;return detect(c).map(v=>({...v,quad:v.quad.map(p=>({x:p.x*sx,y:p.y*sy}))}));}finally{c.width=c.height=1;}
  }
  // A center ROI makes a small framed work measurable without letting the larger
  // backing board consume all Hough peaks. Full-image hypotheses are retained.
  const regions=[{x:0,y:0,w:image.width,h:image.height,name:'全体'}, {x:image.width*.22,y:image.height*.075,w:image.width*.56,h:image.height*.85,name:'中央範囲'}],all=[];
  for(const r of regions){const s=Math.min(1,640/r.w,640/r.h),c=PhotoEngine.canvas(Math.max(1,Math.round(r.w*s)),Math.max(1,Math.round(r.h*s))),g=PhotoEngine.ctx(c);g.drawImage(image,r.x,r.y,r.w,r.h,0,0,c.width,c.height);const found=find(g.getImageData(0,0,c.width,c.height)),sx=r.w/c.width,sy=r.h/c.height;c.width=c.height=1;for(const v of found)all.push({...v,region:r.name,quad:v.quad.map(p=>({x:p.x*sx+r.x,y:p.y*sy+r.y})),reasons:[...v.reasons,`${r.name}からの幾何候補`]});}
  if(!all.some(c=>c.kind==='inner')){
   // If the surrounding scene hid the inner frame, rectify a closed outer
   // hypothesis for one bounded inner search. This never edits the source.
   let pixels;
   for(const parent of all.filter(c=>c.confidence>.78&&area(c.quad)<image.width*image.height*.55).slice(0,2)){
    if(!pixels){const source=PhotoEngine.canvas(image.width,image.height),g=PhotoEngine.ctx(source);g.drawImage(image,0,0);pixels=g.getImageData(0,0,source.width,source.height).data;source.width=source.height=1;}
    const d=PhotoEngine.dimensions(parent.quad),s=Math.min(1,512/d.w,512/d.h),ww=Math.max(40,Math.round(d.w*s)),hh=Math.max(40,Math.round(d.h*s)),map=PhotoEngine.homography(parent.quad),data=new Uint8ClampedArray(ww*hh*4);
    for(let y=0;y<hh;y++)for(let x=0;x<ww;x++){const p=map((x+.5)/ww,(y+.5)/hh),sx=clamp(Math.floor(p.x),0,image.width-1),sy=clamp(Math.floor(p.y),0,image.height-1),k=(sy*image.width+sx)*4;data.set(pixels.subarray(k,k+4),(y*ww+x)*4);}
    const found=find({width:ww,height:hh,data}),children=found.some(c=>c.kind==='inner')?found.filter(c=>c.kind==='inner'):found;
    let added=0;for(const child of children){const quad=child.quad.map(p=>map(p.x/ww,p.y/hh)),ratio=area(quad)/area(parent.quad);if(ratio<.35||ratio>.92)continue;
      // A closed rectangle inside another rectangle is not necessarily an
      // inner frame: all four sides must remain strictly inset. This also
      // rejects thin bottom strips and a mixed set of inner/outer frame edges.
      const insets=[...child.quad.slice(0,2).map(p=>p.y),...child.quad.slice(1,3).map(p=>ww-p.x),...child.quad.slice(2,4).map(p=>hh-p.y),child.quad[0].x,child.quad[3].x],short=Math.min(ww,hh);
      if(Math.min(...insets)<Math.max(3,short*.025)||Math.max(...insets)>short*.3||Math.max(...insets)/Math.min(...insets)>4)continue;all.push({...child,quad,kind:'inner',region:'外周の内側',reasons:['閉じた外周を補正して内側境界を追加探索',...child.reasons]});added++;if(added===3)break;}if(added){parent.kind='outer';parent.reasons=[...parent.reasons,'追加の内側候補を囲む外周'];}
   }
  }
  const priority={inner:3,outer:2,boundary:1};all.sort((a,b)=>priority[b.kind]-priority[a.kind]||b.confidence-a.confidence);const unique=[];for(const c of all){if(unique.some(k=>Math.sqrt(k.quad.reduce((s,p,i)=>s+dist(p,c.quad[i])**2,0)/4)<Math.max(image.width,image.height)*.012))continue;unique.push(c);if(unique.length===6)break;}return unique;
 }
 return {find,detect};
})();
