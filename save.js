'use strict';
// Inspect encoded output without re-decoding a second full-resolution bitmap.
const PhotoSave=(()=>{
 async function inspect(blob,{w,h,type}){
  if(!blob||!blob.size)throw Error('空の画像は保存できません。');
  if(blob.type!==type)throw Error('ブラウザが指定した画像形式で書き出せませんでした。形式を変更してください。');
  const encoded=await PhotoEngine.header(blob.slice(0,1024*1024));
  if(encoded.type!==type||encoded.w!==w||encoded.h!==h)throw Error('書き出し画像の画素数または形式が設定と一致しません。保存を中止しました。');
  return {w:encoded.w,h:encoded.h,type:encoded.type,bytes:blob.size};
 }
 function filename(source,{w,h,type}){return source.replace(/\.[^.]+$/,'')+`_lumen_${w}x${h}.`+(type==='image/png'?'png':'jpg');}
 return {inspect,filename};
})();
