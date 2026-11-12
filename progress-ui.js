'use strict';
// Presentation only. Durations and phase labels never change the processing recipe.
const PhotoProgressUI=(()=>{
 function duration(seconds){
  if(!Number.isFinite(seconds)||seconds<0)return '—';
  if(seconds>0&&seconds<1)return '1秒未満';
  const n=Math.round(seconds),h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=n%60;
  return (h?h+'時間':'')+(m?m+'分':'')+(!h||s?s+'秒':'');
 }
 function describe(raw,exporting){
  let stage;
  if(!exporting)stage=/比較/.test(raw)?'比較を準備しています':/AI|モデル|認識/.test(raw)?'絵画の範囲を調べています':'写真を準備しています';
  else if(/再利用/.test(raw))stage='補正結果を再利用しています';
  else if(/符号化|PNGを書き出し/.test(raw))stage='保存する画像を作成しています';
  else if(/sRGB|保存寸法を検証/.test(raw))stage='保存前の確認をしています';
  else if(/傾き|出力寸法を調整/.test(raw))stage='形と色を仕上げています';
  else if(/ピンぼけ補正\s+\d+\//.test(raw))stage='ぼけを改善しています';
  else if(/SwinIR GPU\s+\d+\//.test(raw))stage='スーパー解像度で処理しています';
  else if(/モデル|実行基盤/.test(raw))stage='補正モデルを準備しています';
  else stage='写真を処理しています';
  const tiles=raw.match(/(\d+)\/(\d+)領域/),eta=raw.match(/推論の残り目安(\d+)秒/);
  let hint=tiles?`${Number(tiles[1]).toLocaleString()} / ${Number(tiles[2]).toLocaleString()} 領域`:raw.replace(/経過\s*[\d.]+秒(?:（読込を含む）)?/g,'').replace(/中止できます。?/g,'').replace(/\s*\d+%/g,'').replace(/^[\s・·。]+|[\s・·。]+$/g,'');
  if(tiles&&eta)hint+=` · 推論の残り目安 ${duration(+eta[1])}`;
  else if(tiles&&raw.includes('残り時間を計測中'))hint+=' · 残り時間を計測中';
  return{stage,hint};
 }
 return{duration,describe};
})();
