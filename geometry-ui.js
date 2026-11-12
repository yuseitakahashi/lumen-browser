'use strict';
// Geometry history contains settings only. The original bitmap is never edited.
function captureGeometry(m=model()){
 return {quad:m.quad.map(p=>({...p})),turn:m.turn,ratio:m.ratio,customRatio:m.customRatio,
  output:{preset:$('sizePreset').value,w:$('outW').value,h:$('outH').value}};
}
function rememberGeometry(snapshot,m=model()){
 if(!m||!snapshot)return;
 if(m.candidatePending&&m.candidateBefore)snapshot=m.candidateBefore;
 const history=m.geometryHistory||(m.geometryHistory=[]);
 if(JSON.stringify(snapshot)!==JSON.stringify(history.at(-1)))history.push(snapshot);
 if(history.length>20)history.shift();
}
function restoreGeometrySettings(old,m=model()){
 m.quad=old.quad.map(p=>({...p}));m.turn=old.turn;m.ratio=old.ratio;m.customRatio=old.customRatio;
 $('ratio').value=old.ratio;$('customRatio').value=old.customRatio;$('customRatioLabel').hidden=old.ratio!=='custom';
 $('angle').textContent=m.turn*90+'°';$('sizePreset').value=old.output.preset;
 $('outW').value=old.output.w;$('outH').value=old.output.h;
}
function resetGeometryRatio(){
 model().ratio='auto';$('ratio').value='auto';$('customRatioLabel').hidden=true;
 if($('sizePreset').value==='custom')$('sizePreset').value='native';
}
function syncGeometryUI(){
 const m=model(),locked=!m||!!S.working||!!S.pick||!!S.crop;
 $('geometryControls').disabled=locked;
 $('startCrop').disabled=locked||!!m?.candidatePending||!!S.hasDraft;
 $('auto').disabled=locked||!!S.hasDraft;$('autoLines').disabled=locked||!!S.hasDraft;
 $('geometryUndo').disabled=locked||!m?.geometryHistory?.length||!!m?.candidatePending||!!S.hasDraft;
 $('boundaryPanel').hidden=!m||!m.showCandidates;
 $('previewGeometry').disabled=locked||!m?.candidatePending;
}
function restoreGeometry(){
 const m=model();if(!m||S.working||S.pick||S.crop||m.candidatePending||S.hasDraft)return;
 const old=m.geometryHistory?.pop();if(!old)return;
 restoreGeometrySettings(old,m);changedGeometry();restoreGeometrySettings(old,m);updateResolution();switchView('result');message('形と範囲を1つ前に戻しました。画質の補正方法はそのままです。');
}
function cropRatio(){const value=$('cropAspect').value;return value==='current'?S.crop.viewAspect:Number(value);}
function drawCropSelection(){
 const crop=S.crop;if(!crop||!crop.ready)return;
 const r=crop.rect,x=r.x*1000,y=r.y*1000,w=r.w*1000,h=r.h*1000,ns='http://www.w3.org/2000/svg';
 $('cropShade').setAttribute('d',`M0 0H1000V1000H0Z M${x} ${y}H${x+w}V${y+h}H${x}Z`);
 for(const[k,v]of Object.entries({x,y,width:w,height:h}))$('cropRect').setAttribute(k,v);
 $('cropGrid').replaceChildren();for(const n of [1,2])for(const vertical of [true,false]){
  const line=document.createElementNS(ns,'line');for(const[k,v]of Object.entries(vertical?{x1:x+w*n/3,x2:x+w*n/3,y1:y,y2:y+h}:{x1:x,x2:x+w,y1:y+h*n/3,y2:y+h*n/3}))line.setAttribute(k,v);$('cropGrid').append(line);
 }
 $('cropHandles').replaceChildren();const bounds=$('cropOverlay').getBoundingClientRect();
 [[x,y],[x+w,y],[x+w,y+h],[x,y+h]].forEach(([cx,cy],i)=>{
  const handle=document.createElementNS(ns,'rect'),hw=18/Math.max(1,bounds.width)*1000,hh=18/Math.max(1,bounds.height)*1000;
  for(const[k,v]of Object.entries({x:cx-hw/2,y:cy-hh/2,width:hw,height:hh,rx:2,'data-crop':String(i)}))handle.setAttribute(k,v);$('cropHandles').append(handle);
 });
 for(const[k,id]of Object.entries({x:'cropX',y:'cropY',w:'cropW',h:'cropH'}))$(id).value=(r[k]*100).toFixed(1);
 const wpx=Math.round(crop.size.w*r.w),hpx=Math.round(crop.size.h*r.h);
 $('cropSize').textContent=`${wpx.toLocaleString()} × ${hpx.toLocaleString()} px 相当`;
 try{const q=PhotoCrop.crop(crop.before.quad,r,crop.before.turn);$('cropApply').disabled=!E.validQuad(q,crop.owner.w,crop.owner.h)||wpx<8||hpx<8;}catch{$('cropApply').disabled=true;}
}
function closeCrop(){
 const crop=S.crop;if(!crop)return;crop.controller.abort();S.crop=null;
 $('cropDialog').close();$('cropCanvas').width=$('cropCanvas').height=1;refreshActions();$('startCrop').focus({preventScroll:true});
}
async function openCrop(){
 const m=model();if(!m||S.working||S.pick||S.hasDraft||m.candidatePending||S.crop)return;
 clearTimeout(timer);S.controller?.abort();PhotoReview.close();
 const size=nativeSize(),controller=new AbortController(),crop={owner:m,before:captureGeometry(m),size,viewAspect:size.w/size.h,rect:{x:0,y:0,w:1,h:1},controller,ready:false};
 S.crop=crop;$('cropAspect').value='0';$('cropApply').disabled=true;$('cropOverlay').setAttribute('hidden','');
 $('cropHelp').textContent='切り抜き用の表示を準備しています…';$('cropDialog').showModal();refreshActions();
 try{
  const scale=Math.min(1,1200/size.w,900/size.h),c=await renderItem(m,{...settings(),w:Math.max(1,Math.round(size.w*scale)),h:Math.max(1,Math.round(size.h*scale)),sharpness:0,signal:controller.signal});
  if(S.crop!==crop||controller.signal.aborted){c.width=c.height=1;return;}
  const canvas=$('cropCanvas');canvas.width=c.width;canvas.height=c.height;E.ctx(canvas).drawImage(c,0,0);c.width=c.height=1;
  crop.ready=true;$('cropOverlay').removeAttribute('hidden');$('cropHelp').textContent='写真の上をドラッグして範囲を選びます。四隅で大きさ、内側で位置を調整できます。';drawCropSelection();
 }catch(error){if(error.name!=='AbortError'){$('cropHelp').textContent=error.message;$('cropApply').disabled=true;}}
}
function applyCrop(){
 const crop=S.crop;if(!crop?.ready||crop.owner!==model()||$('cropApply').disabled)return;
 const m=crop.owner,r=crop.rect,q=PhotoCrop.crop(crop.before.quad,r,crop.before.turn);
 if(!E.validQuad(q,m.w,m.h))return;
 // Exact full selection is a no-op; keep a cached result and its recipe valid.
 if(r.x===0&&r.y===0&&r.w===1&&r.h===1){closeCrop();return;}
 rememberGeometry(crop.before,m);m.quad=q;
 const displayRatio=crop.viewAspect*r.w/r.h;m.ratio='custom';m.customRatio=m.turn%2?1/displayRatio:displayRatio;
 $('ratio').value='custom';$('customRatio').value=m.customRatio;$('customRatioLabel').hidden=false;
 if($('sizePreset').value==='custom')$('sizePreset').value='native';
 closeCrop();changedGeometry();switchView('result');message('選んだ範囲で切り抜きました。「形の編集を戻す」で元の範囲へ戻せます。');
}
function initGeometryUI(){
 $('geometryUndo').onclick=restoreGeometry;$('startCrop').onclick=openCrop;
 $('previewGeometry').onclick=()=>switchView('result');
 $('cropCancel').onclick=closeCrop;$('cropApply').onclick=applyCrop;
 $('cropDialog').addEventListener('cancel',event=>{event.preventDefault();closeCrop();});
 $('cropAspect').onchange=()=>{if(!S.crop?.ready)return;S.crop.rect=PhotoCrop.fitAspect(S.crop.rect,cropRatio(),S.crop.viewAspect);drawCropSelection();};
 $('cropAll').onclick=()=>{if(!S.crop?.ready)return;S.crop.rect=PhotoCrop.fitAspect({x:0,y:0,w:1,h:1},cropRatio(),S.crop.viewAspect);drawCropSelection();};
 for(const id of ['cropX','cropY','cropW','cropH'])$(id).onchange=()=>{
  if(!S.crop?.ready)return;
  const r={x:+$('cropX').value/100,y:+$('cropY').value/100,w:+$('cropW').value/100,h:+$('cropH').value/100};
  try{S.crop.rect=PhotoCrop.fitAspect(r,cropRatio(),S.crop.viewAspect);drawCropSelection();}catch{$('cropApply').disabled=true;}
 };
 const point=e=>{const b=$('cropOverlay').getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-b.left)/b.width)),y:Math.max(0,Math.min(1,(e.clientY-b.top)/b.height))};};
 $('cropOverlay').onpointerdown=e=>{
  if(!S.crop?.ready||e.isPrimary===false||e.button>0)return;e.preventDefault();
  const p=point(e),r=S.crop.rect,mode=(e.target.dataset.crop==='move'&&r.x===0&&r.y===0&&r.w===1&&r.h===1)?'draw':e.target.dataset.crop||'draw',corners=[{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.h},{x:r.x,y:r.y+r.h}];
  S.crop.gesture={id:e.pointerId,start:p,old:{...r},mode,anchor:mode==='draw'?p:corners[(Number(mode)+2)%4]};$('cropOverlay').setPointerCapture(e.pointerId);
 };
 $('cropOverlay').onpointermove=e=>{
  const crop=S.crop,g=crop?.gesture;if(!g||e.pointerId!==g.id)return;
  const p=point(e);
  crop.rect=g.mode==='move'?{...g.old,x:Math.max(0,Math.min(1-g.old.w,g.old.x+p.x-g.start.x)),y:Math.max(0,Math.min(1-g.old.h,g.old.y+p.y-g.start.y))}:PhotoCrop.fromPoints(g.anchor,p,cropRatio(),crop.viewAspect);
  drawCropSelection();
 };
 $('cropOverlay').onpointerup=e=>{if(S.crop?.gesture?.id===e.pointerId)S.crop.gesture=null;};
 $('cropOverlay').onpointercancel=()=>{if(S.crop?.gesture){S.crop.rect=S.crop.gesture.old;S.crop.gesture=null;drawCropSelection();}};
 window.addEventListener('resize',()=>{if(S.crop?.ready)drawCropSelection();});
 syncGeometryUI();
}
