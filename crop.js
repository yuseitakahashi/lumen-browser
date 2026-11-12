'use strict';
// Geometry only. All edits are composed back into the original source quad;
// no intermediate image is resampled, and these functions never read pixels.
const PhotoCrop=(()=>{
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const finite=values=>values.every(Number.isFinite);
 function constrainRect(rect){
  if(!rect||!finite([rect.x,rect.y,rect.w,rect.h]))throw Error('切り抜き範囲を確認してください。');
  const x=clamp(Math.min(rect.x,rect.x+rect.w),0,1),y=clamp(Math.min(rect.y,rect.y+rect.h),0,1);
  return{x,y,w:clamp(Math.max(rect.x,rect.x+rect.w),0,1)-x,h:clamp(Math.max(rect.y,rect.y+rect.h),0,1)-y};
 }
 // ratio is the desired pixel width/height. viewAspect is the displayed
 // (already turned / rectified) image's pixel width/height, not its CSS box.
 function fitAspect(rect,ratio,viewAspect=1){
  const r=constrainRect(rect);
  if(ratio===0)return r;
  if(!finite([ratio,viewAspect])||ratio<=0||viewAspect<=0)throw Error('切り抜きの縦横比を確認してください。');
  const normalized=ratio/viewAspect,w=Math.min(r.w,r.h*normalized),h=Math.min(r.h,r.w/normalized);
  return{x:r.x+(r.w-w)/2,y:r.y+(r.h-h)/2,w,h};
 }
 // For pointer drags, retain the starting corner and shrink the other axis
 // into the requested ratio. Reverse-direction drags work identically.
 function fromPoints(a,b,ratio=0,viewAspect=1){
  if(!a||!b||!finite([a.x,a.y,b.x,b.y]))throw Error('画像上の位置を確認してください。');
  const start={x:clamp(a.x,0,1),y:clamp(a.y,0,1)},end={x:clamp(b.x,0,1),y:clamp(b.y,0,1)};
  const r=fitAspect({x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),w:Math.abs(end.x-start.x),h:Math.abs(end.y-start.y)},ratio,viewAspect);
  return{x:end.x<start.x?start.x-r.w:start.x,y:end.y<start.y?start.y-r.h:start.y,w:r.w,h:r.h};
 }
 function crop(quad,rect,turn=0){
  if(!Array.isArray(quad)||quad.length!==4||quad.some(p=>!p||!finite([p.x,p.y]))||!Number.isInteger(turn))throw Error('四隅と回転を確認してください。');
  if(!quad.every((a,i)=>{const b=quad[(i+1)%4],c=quad[(i+2)%4];return(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x)>0;}))throw Error('四隅が交差しているか範囲がありません。');
  const r=constrainRect(rect);
  if(r.w<=0||r.h<=0)throw Error('切り抜く範囲を指定してください。');
  const t=((turn%4)+4)%4;
  // Full selection must be an exact identity, including decimal coordinates.
  if(r.x===0&&r.y===0&&r.w===1&&r.h===1)return quad.map(p=>({...p}));
  const project=PhotoEngine.homography(quad.map((_,i)=>quad[(i-t+4)%4]));
  // A convex quad contains its projected crop. Numerical elimination can put
  // a point on an image edge ~1e-12 outside it; bound only to that quad's AABB
  // so a valid edge-touching crop is not rejected by the source-bound check.
  const minX=Math.min(...quad.map(p=>p.x)),maxX=Math.max(...quad.map(p=>p.x)),minY=Math.min(...quad.map(p=>p.y)),maxY=Math.max(...quad.map(p=>p.y));
  const map=(u,v)=>{const p=project(u,v);return{x:clamp(p.x,minX,maxX),y:clamp(p.y,minY,maxY)};};
  const display=[map(r.x,r.y),map(r.x+r.w,r.y),map(r.x+r.w,r.y+r.h),map(r.x,r.y+r.h)];
  return quad.map((_,i)=>display[(i+t)%4]);
 }
 // Largest-area centered rectangle at a source angle, with every corner
 // inside the image. Positive degrees straighten a line sloping down-right.
 // This is a geometric crop, not a scene/horizon detector.
 function levelQuad(w,h,degrees){
  if(!finite([w,h,degrees])||w<=0||h<=0||Math.abs(degrees)>45)throw Error('傾きは−45°から45°の範囲で指定してください。');
  if(degrees===0)return[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
  const angle=degrees*Math.PI/180,c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle)),candidates=[];
  const add=(rw,rh)=>{if(rw>0&&rh>0&&c*rw+s*rh<=w+1e-8&&s*rw+c*rh<=h+1e-8)candidates.push({w:rw,h:rh});};
  // Interior maxima on either limiting edge, plus the two-edge intersection.
  add(w/(2*c),w/(2*s));add(h/(2*s),h/(2*c));
  const denominator=c*c-s*s;
  if(Math.abs(denominator)>1e-12)add((w*c-h*s)/denominator,(h*c-w*s)/denominator);
  candidates.sort((a,b)=>b.w*b.h-a.w*a.h);
  const best=candidates[0];if(!best)throw Error('この傾きで切り抜く範囲を計算できません。');
  const cos=Math.cos(angle),sin=Math.sin(angle);
  return[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>({x:clamp(w/2+x*best.w*cos/2-y*best.h*sin/2,0,w),y:clamp(h/2+x*best.w*sin/2+y*best.h*cos/2,0,h)}));
 }
 return{constrainRect,fitAspect,fromPoints,crop,levelQuad};
})();
