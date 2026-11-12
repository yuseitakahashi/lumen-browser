'use strict';
// Pointer coordinates are CSS viewport pixels, independent of bitmap scale or scroll.
const FourPointPick=(()=>{
 function fromClient(rect,w,h,x,y){
  if(![rect.left,rect.top,rect.width,rect.height,w,h,x,y].every(Number.isFinite)||rect.width<=0||rect.height<=0||w<=0||h<=0)throw Error('画像の表示範囲を確認してください。');
  const u=(x-rect.left)/rect.width,v=(y-rect.top)/rect.height;
  if(u<0||u>1||v<0||v>1)throw Error('画像の内側を指定してください。');
  return{x:u*w,y:v*h};
 }
 function validate(q,w,h){
  if(q.length!==4)return '4点を指定してください。';
  if(q.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>w||p.y>h))return '画像の内側を指定してください。';
  const cross=q.map((a,i)=>{const b=q[(i+1)%4],c=q[(i+2)%4];return(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);});
  if(cross.some(v=>v<=0))return '交差・重複した四隅です。左上→右上→右下→左下の順で指定してください。';
  const area=Math.abs(q.reduce((sum,p,i)=>sum+p.x*q[(i+1)%4].y-q[(i+1)%4].x*p.y,0))/2;
  if(area<64||q.some((p,i)=>Math.hypot(p.x-q[(i+1)%4].x,p.y-q[(i+1)%4].y)<8))return '範囲が小さすぎます。各辺8px以上・面積64px²以上で指定してください。';
  return '';
 }
 return{fromClient,validate};
})();
