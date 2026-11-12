'use strict';
// A single visible workflow over the existing photo recipes and export guards.
// Image processing stays in PhotoEngine / PhotoRestormer / PhotoSwinIR, not in this UI layer.
(()=>{
 const legacy=document.querySelector('main'),shell=document.createElement('main');
 shell.id='simpleStudio';shell.innerHTML=`
 <div class="simple-intro"><h1>写真を入れて、整えて、保存。</h1><p>必要な補正だけ、スイッチで選べます。</p></div>
 <section class="simple-card" aria-label="写真の仕上げ">
  <div id="simpleDropSlot"></div>
  <div class="simple-filebar" id="simpleFilebar" hidden><span id="simpleFilename"></span><button id="simpleReplace" class="textbutton">写真を変更</button><button id="simpleGeometry" class="textbutton">範囲を調整</button></div>
  <div class="simple-options" aria-label="補正のオン・オフ">
   <label class="simple-switch"><span><strong>ぼけを改善</strong><small id="simpleBlurHelp">筆線や細部を整える · 数分〜</small></span><input id="simpleBlur" type="checkbox" role="switch" aria-describedby="simpleBlurHelp"><i aria-hidden="true"></i></label>
   <label class="simple-switch"><span><strong>絵画だけ切り抜く</strong><small>AIで傾きも補正 · 範囲は確認</small></span><input id="simpleCrop" type="checkbox" role="switch"><i aria-hidden="true"></i></label>
   <label class="simple-switch"><span><strong>スーパー解像度 ×2</strong><small id="simpleSRHelp">学習型で細部を推定 · 実験</small></span><input id="simpleSR" type="checkbox" role="switch" aria-describedby="simpleSRHelp simpleFeatureNote"><i aria-hidden="true"></i></label>
   <label class="simple-switch"><span><strong>明るさ・色を調整</strong><small>必要なときだけ手動で</small></span><input id="simpleColor" type="checkbox" role="switch"><i aria-hidden="true"></i></label>
  </div>
  <p id="simpleFeatureNote" class="simple-note">写真を入れると絵画を検出します。範囲を確認したら、ぼけ補正を自動で始めます。</p>
  <div id="simpleGeometrySlot" hidden></div><div id="simpleColorSlot" hidden></div>
  <section class="simple-meter" aria-label="処理状況"><div class="simple-meter-top"><strong id="simpleStage" role="status" aria-live="polite">写真を待っています</strong><span id="simplePercent"></span></div><progress id="simpleProgress" max="1" value="0" aria-label="写真処理の進捗"></progress><div class="simple-meter-bottom"><span id="simpleTime">写真は外部に送信しません</span><button id="simpleCancel" class="textbutton" hidden>中止</button></div><p id="simpleHint" class="simple-note" aria-live="polite"></p></section>
  <div class="simple-action"><button id="simpleAction" class="primary" disabled>画像を保存</button></div><label class="simple-format">保存形式 <select id="simpleFormat" aria-label="保存形式"><option value="image/png">PNG · 圧縮による劣化なし</option><option value="image/jpeg">JPEG · 小さいファイル</option></select></label>
 </section>
 <details id="simpleComparison" class="simple-disclosure" hidden><summary>処理前・処理後を確認</summary><div id="simpleReviewSlot"></div></details>
 <details id="simpleFiles" class="simple-disclosure" hidden><summary>ほかの写真</summary><div id="simpleFilmSlot"></div></details>
 <footer class="simple-footer"><span>原本は変更されません</span><a href="help.html">使い方</a><small>2026.11.12 · BETA17</small></footer>`;
 legacy.before(shell);legacy.hidden=true;legacy.id='legacyStudio';document.body.classList.add('simple-mode');
 const move=(id,target)=>$(target).append($(id));
 move('dropzone','simpleDropSlot');move('geometryPanel','simpleGeometrySlot');move('colorSettings','simpleColorSlot');move('exportInspection','simpleReviewSlot');move('saveAgain','simpleStudio');document.querySelector('.simple-action').append($('saveAgain'));
 $('simpleFilmSlot').append(document.querySelector('.filmstrip'));
 $('colorSettings').open=true;$('colorSettings').querySelector('summary').hidden=true;
 $('simpleFilmSlot').append($('clearPhotos'));
 $('dropzone').setAttribute('tabindex','0');$('dropzone').setAttribute('aria-label','写真をドラッグ＆ドロップ、またはクリックして選ぶ');
 const demo=$('demo');demo.hidden=true;
 $('empty').innerHTML='<div class="simple-drop-icon" aria-hidden="true">＋</div><h2>写真をドラッグ＆ドロップ</h2><p>または、クリックして選ぶ</p><small>JPEG・PNG · 1枚から使えます</small>';$('empty').append(demo);
 const savedView=document.createElement('div');savedView.id='simpleSavedView';savedView.hidden=true;savedView.innerHTML='<img id="simpleSavedImage" alt="保存する実際の仕上がり" decoding="async"><small>保存する仕上がり</small>';$('dropzone').append(savedView);
 $('dropzone').addEventListener('click',e=>{if(!model()&&!S.working&&!e.target.closest('button'))$('files').click();});
 $('dropzone').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target===$('dropzone')&&!model()&&!S.working){e.preventDefault();$('files').click();}});
 const defaults={blur:true,crop:true,sr:false,color:false};let selected=null,geometryOpen=false,awaitingRange=false,started=0,wasWorking=false,runActive=false,queued=null,defaultFormat='image/png';
 const config=m=>m?.simpleOptions||defaults;
 const switches={blur:'simpleBlur',crop:'simpleCrop',sr:'simpleSR',color:'simpleColor'};
 function apply(m){const c=config(m);if(c.blur&&!restormerAvailable()){$('deblur').value=m.deblur='restormer';}else chooseCorrection(c.blur?'restormer':'off');$('resampler').value=m.resampler=c.sr?'swinir-x2':'linear';$('sizePreset').value=c.sr?'2x':'native';outputSize();rememberOutput();}
 function sync(){
  const m=model(),has=!!m,c=config(m),working=!!S.working,blocked=has?outputBlock():'',fresh=has&&preparedCurrent()&&!blocked&&!(c.crop&&!m.simpleCropResolved);
  if(selected!==m){selected=m;geometryOpen=false;awaitingRange=false;}
  if(working&&!wasWorking&&!runActive)started=Date.now();wasWorking=working;
  for(const [key,id]of Object.entries(switches)){const el=$(id);el.checked=!!c[key];el.disabled=working||runActive||!!S.pick||!!S.crop||!!S.hasDraft||(key==='color'&&!!m?.candidatePending)||(key==='blur'&&!restormerAvailable()&&!c.blur)||(key==='sr'&&!PhotoSwinIR.available&&!c.sr);}
  $('simpleFormat').value=has?$('format').value:defaultFormat;$('simpleFormat').disabled=working||runActive||!!S.pick||!!S.crop||!!S.hasDraft||!!m?.candidatePending;
  $('simpleBlurHelp').textContent=restormerAvailable()?'筆線や細部を整える · 数分〜':'利用できません · オフにして続行';
  $('simpleSRHelp').textContent=PhotoSwinIR.available?'学習型で細部を推定 · 実験':'利用できません · WebGPUが必要';
  $('simpleFilebar').hidden=!has;$('simpleFilename').textContent=has?m.file.name:'';
  $('simpleReplace').disabled=$('simpleGeometry').disabled=working;
  const geometry=has&&(geometryOpen||awaitingRange||m.candidatePending||!!S.pick||!!S.hasDraft||m.showCandidates);
  $('simpleGeometrySlot').hidden=!geometry;document.body.classList.toggle('simple-geometry-open',!!geometry);
  $('simpleColorSlot').hidden=!has||!c.color;document.body.classList.toggle('simple-color-open',has&&c.color);for(const el of $('colorSettings').querySelectorAll('input,button,select'))el.disabled=!has||working||!!S.pick||!!S.crop;
  $('simpleFiles').hidden=!S.items.length;
  $('simpleComparison').hidden=!fresh;
  if(!fresh)$('simpleComparison').open=false;
  $('saveAgain').hidden=!fresh||working||runActive;$('saveAgain').textContent='画像を保存';
  const showSaved=fresh&&!geometry&&!working&&!runActive;savedView.hidden=!showSaved;document.body.classList.toggle('simple-output-ready',!!showSaved);
  const displayUrl=S.lastExport?.previewUrl||S.exportUrl;if(showSaved&&$('simpleSavedImage').getAttribute('src')!==displayUrl)$('simpleSavedImage').src=displayUrl;
  if(!has)$('simpleSavedImage').removeAttribute('src');
  const action=$('simpleAction');action.hidden=fresh&&!working&&!runActive;action.disabled=working||runActive||!has||!!blocked;
  action.textContent=!has?'画像を保存':working||runActive?'処理中…':awaitingRange?'この範囲で処理する':blocked?'設定を確認してください':S.lastExport?.ownerId===m.id?'変更を反映して作り直す':'処理をはじめる';
  $('simpleCancel').hidden=!working;$('simpleCancel').disabled=!working;
  const stage=$('simpleStage'),bar=$('simpleProgress');let hint='';
  if(working){const display=PhotoProgressUI.describe($('progressText').textContent,S.exporting);if(stage.textContent!==display.stage)stage.textContent=display.stage;const p=$('progress').value;
   if(S.exporting&&p>0){bar.value=Math.min(.99,p);$('simplePercent').textContent=Math.floor(Math.min(.99,p)*100)+'%';}else{bar.removeAttribute('value');$('simplePercent').textContent='';}hint=display.hint;
  }else{bar.value=fresh?1:0;$('simplePercent').textContent=fresh?'100%':'';stage.textContent=fresh?'保存できます':!has?'写真を待っています':awaitingRange?'処理する範囲を確認':m.candidatePending?'切り抜く範囲を確認':$('status').classList.contains('error')?'処理を確認してください':$('status').textContent.includes('中止')?'処理を中止しました':'設定を確認して処理できます';hint=fresh?`${S.lastExport.meta.w.toLocaleString()} × ${S.lastExport.meta.h.toLocaleString()} px · ${c.sr?'学習型超解像を適用。筆跡・模様を比較してください。':'元画像と見比べてから保存できます。'}`:awaitingRange?(c.sr?'超解像は処理範囲の縦横2倍で保存します。範囲を確認して進めてください。':'ぼけ補正は数分〜数十分かかる場合があります。必要な範囲だけを選ぶと短くできます。'):blocked||($('status').classList.contains('error')||$('status').textContent.includes('中止')?$('status').textContent:'');}
  $('simpleHint').setAttribute('aria-live',working?'off':'polite');if($('simpleHint').textContent!==hint)$('simpleHint').textContent=hint;$('simpleHint').classList.toggle('error',$('status').classList.contains('error')&&!working&&!fresh);
  $('simpleFeatureNote').textContent=c.sr?'学習型SwinIRで縦横2倍にします。ぼけ補正はオフになります。文字・筆跡・質感が変わる場合があるため、保存前に比較してください。GPU必須・元画素を分割して処理します。':!has&&c.crop&&c.blur?'写真を入れると絵画を検出します。範囲を確認したら、ぼけ補正を自動で始めます（数分〜）。':c.blur?'初回のぼけ補正は数分以上かかります。色調整では、端末内に残っている補正結果を再利用します。':c.crop?'絵画の候補を見つけたら、イーゼルや作品の端を確認します。':c.color?'色と明るさを手動で調整します。照明ムラの自動判定は行いません。':has?'選択した範囲を、拡大・画質補正なしで保存します。':'必要な補正をオンにしてから、写真を入れてください。';
  if(!working){const timings=fresh?S.lastExport.meta.timings:null,reused=timings?.sr?.cacheHit||timings?.deblur?.cacheHit;$('simpleTime').textContent=timings?`画像作成 ${PhotoProgressUI.duration(timings.totalMs/1000)}${reused?' · 補正結果を再利用':''}`:'写真は外部に送信しません';}
 }
 async function run(confirmed=false){
  const m=model();if(!m||S.working||runActive||S.pick||S.crop||S.hasDraft)return;const c=config(m);runActive=true;started=Date.now();
  try{
   if(c.crop&&!m.simpleCropResolved){m.simpleCropBefore??=captureGeometry(m);await $('auto').onclick();if(model()!==m)return;geometryOpen=true;if(m.candidatePending){switchView('source');sync();return;}if($('status').textContent.includes('中止'))return;message('作品の範囲を確認できませんでした。手動で範囲を選ぶか、切り抜きをオフにしてください。',true);return;}
   if(outputBlock())return;
   if((c.blur||c.sr)&&!confirmed&&m.simpleRangeKey!==JSON.stringify(m.quad)){awaitingRange=true;geometryOpen=true;switchView('source');return;}
   if(c.blur||c.sr)m.simpleRangeKey=JSON.stringify(m.quad);awaitingRange=false;geometryOpen=false;
   await createOutput();
  }finally{runActive=false;sync();}
 }
 function queue(){clearTimeout(queued);const owner=model();queued=setTimeout(()=>{queued=null;if(model()===owner)void run();},150);}
 function loaded(items,failed){if(!items.length)return;for(const m of items){m.simpleOptions={...defaults};m.deblur=defaults.blur?'restormer':'off';m.resampler=defaults.sr?'swinir-x2':'linear';m.output={preset:defaults.sr?'2x':'native',format:defaultFormat,quality:'0.95'};}const m=model();$('format').value=defaultFormat;apply(m);sync();if(!failed&&(config(m).crop||!config(m).color))queue();}
 for(const [key,id]of Object.entries(switches))$(id).onchange=()=>{
  clearTimeout(queued);queued=null;const m=model(),c=config(m);c[key]=$(id).checked;if(key==='sr'&&c.sr)c.blur=false;if(key==='blur'&&c.blur)c.sr=false;Object.assign(defaults,c);awaitingRange=false;
  if(m){
   if(key==='crop'){if(c.crop){m.simpleCropResolved=false;m.simpleCropBefore=captureGeometry(m);}else{if(m.candidatePending)$('cancelBoundary').onclick();if(m.simpleCropBefore){rememberGeometry(captureGeometry(m));restoreGeometrySettings(m.simpleCropBefore,m);changedGeometry();m.simpleCropBefore=null;}m.simpleCropResolved=true;geometryOpen=false;switchView('source');}}
   if(key==='color'&&!c.color){m.simpleColorBackup={adjust:{...m.adjust},illumination:m.illumination?{...m.illumination}:null};$('neutral').onclick();}
   if(key==='color'&&c.color&&m.simpleColorBackup){m.adjust={...m.simpleColorBackup.adjust};m.illumination=m.simpleColorBackup.illumination;syncIllumination(m);for(const k of adjustments){$(k).value=m.adjust[k];$(k+'Out').textContent=m.adjust[k];}}
   apply(m);if(key==='color'&&c.color)switchView('result');schedulePreview();
  }sync();
 };
 $('simpleAction').onclick=()=>run(awaitingRange);
 $('simpleFormat').onchange=()=>{clearTimeout(queued);defaultFormat=$('simpleFormat').value;if(model()){$('format').value=defaultFormat;$('format').onchange();}sync();};
 $('saveAgain').addEventListener('click',e=>{if(S.working||runActive||!preparedCurrent()||outputBlock()||(config(model()).crop&&!model()?.simpleCropResolved))e.preventDefault();});
 $('simpleCancel').onclick=()=>{clearTimeout(queued);queued=null;S.controller?.abort();};
 $('simpleReplace').onclick=()=>{clearTimeout(queued);$('files').click();};
 $('simpleGeometry').onclick=()=>{geometryOpen=!geometryOpen;if(geometryOpen)switchView('source');sync();};
 // A confirmed AI boundary authorizes only that geometry, never an unconfirmed crop.
 $('confirmBoundary').textContent='この範囲で処理する';
 $('confirmBoundary').addEventListener('click',()=>{const m=model();if(m&&!m.candidatePending&&!S.working){m.simpleCropResolved=true;m.simpleRangeKey=JSON.stringify(m.quad);geometryOpen=false;queue();}});
 $('cancelBoundary').addEventListener('click',()=>{if(model()){model().simpleCropResolved=false;geometryOpen=true;sync();}});
 function manualRange(){const m=model();if(m&&!m.candidatePending&&!S.pick&&!S.crop&&!S.hasDraft){m.simpleCropResolved=true;awaitingRange=true;geometryOpen=true;sync();}}
 for(const id of ['pickApply','cropApply','applyCoords','full','rectangle','geometryUndo'])$(id).addEventListener('click',manualRange);
 $('coords').addEventListener('change',manualRange);
 let rangeDragging=false;$('overlay').addEventListener('pointerdown',e=>{rangeDragging=e.target.hasAttribute('data-index');});
 for(const type of ['pointerup','pointercancel'])$('overlay').addEventListener(type,()=>{if(rangeDragging)manualRange();rangeDragging=false;});
 for(const input of $('colorSettings').querySelectorAll('input'))input.addEventListener('input',()=>{if(model()&&!S.working&&S.view!=='result')switchView('result');sync();});
 $('simpleComparison').addEventListener('toggle',()=>{if($('simpleComparison').open&&!S.working&&S.lastExport?.ownerId===model()?.id)void inspectSavedExport();});
 new MutationObserver(sync).observe($('progressText'),{childList:true,characterData:true,subtree:true});
 new MutationObserver(sync).observe($('progress'),{attributes:true,attributeFilter:['value']});
 new MutationObserver(()=>{if(!S.working)sync();}).observe($('status'),{childList:true,characterData:true,subtree:true});
 setInterval(()=>{if(S.working&&started)$('simpleTime').textContent=`経過 ${PhotoProgressUI.duration(Math.floor((Date.now()-started)/1000))}`;},1000);
 window.SimpleLumen={sync,loaded};sync();
})();
