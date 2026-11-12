'use strict';
// Only for pixels already converted through the editor's sRGB Canvas context.
// This adds explicit output colour metadata; it is not a profile conversion.
const PhotoColor=(()=>{
 const profile=Uint8Array.from(atob('AAACTGxjbXMEQAAAbW50clJHQiBYWVogB+oACgAYAAoADAAJYWNzcEFQUEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1sY21zAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALZGVzYwAAAQgAAAA2Y3BydAAAAUAAAABMd3RwdAAAAYwAAAAUY2hhZAAAAaAAAAAsclhZWgAAAcwAAAAUYlhZWgAAAeAAAAAUZ1hZWgAAAfQAAAAUclRSQwAAAggAAAAgZ1RSQwAAAggAAAAgYlRSQwAAAggAAAAgY2hybQAAAigAAAAkbWx1YwAAAAAAAAABAAAADGVuVVMAAAAaAAAAHABzAFIARwBCACAAYgB1AGkAbAB0AC0AaQBuAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAADAAAAAcAE4AbwAgAGMAbwBwAHkAcgBpAGcAaAB0ACwAIAB1AHMAZQAgAGYAcgBlAGUAbAB5WFlaIAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDEIAAAXe///zJQAAB5MAAP2Q///7of///aIAAAPcAADAblhZWiAAAAAAAABvoAAAOPUAAAOQWFlaIAAAAAAAACSfAAAPhAAAtsNYWVogAAAAAAAAYpcAALeHAAAY2XBhcmEAAAAAAAMAAAACZmYAAPKnAAANWQAAE9AAAApbY2hybQAAAAAAAwAAAACj1wAAVHsAAEzNAACZmgAAJmYAAA9c'),c=>c.charCodeAt(0));
 const ascii=s=>Uint8Array.from(s,c=>c.charCodeAt(0)),name=b=>String.fromCharCode(...b);
 const u32=n=>new Uint8Array([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]);
 function crc(data){let c=0xffffffff;for(const byte of data){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
 function chunk(type,data){const body=new Uint8Array(4+data.length);body.set(ascii(type));body.set(data,4);return new Blob([u32(data.length),body,u32(crc(body))]);}
 async function bytes(blob,start,n){return new Uint8Array(await blob.slice(start,start+n).arrayBuffer());}
 async function tagCanvasOutput(blob){
  // Read headers in bounded 1 MiB windows, avoiding one asynchronous Blob read
  // per IDAT chunk while keeping the compressed image out of JS memory.
  let cachedStart=-1,cached;
  async function read(start,n){if(!cached||start<cachedStart||start+n>cachedStart+cached.length){cachedStart=Math.floor(start/1048576)*1048576;cached=new Uint8Array(await blob.slice(cachedStart,Math.min(blob.size,Math.max(cachedStart+1048576,start+n))).arrayBuffer());}return cached.subarray(start-cachedStart,start-cachedStart+n);}
  const first=await read(0,8);
  if(blob.type==='image/png'){
   if(name(first)!=='\x89PNG\r\n\x1a\n')throw Error('PNGの色情報を追加できません。');
   const parts=[blob.slice(0,8)];let p=8,ended=false;
   while(p+12<=blob.size){const head=await read(p,8),len=new DataView(head.buffer,head.byteOffset,head.byteLength).getUint32(0),type=name(head.subarray(4));if(p+len+12>blob.size)throw Error('PNGのデータが破損しています。');
    if(!['sRGB','gAMA','cHRM','iCCP','cICP','mDCV','cLLI','eXIf','tEXt','iTXt','zTXt'].includes(type))parts.push(blob.slice(p,p+len+12));
    if(type==='IHDR'){parts.push(chunk('gAMA',u32(45455)),chunk('sRGB',new Uint8Array([0])));}
    p+=len+12;if(type==='IEND'){ended=true;break;}
   }
   if(!ended)throw Error('PNGの終端がありません。');return new Blob(parts,{type:blob.type});
  }
  if(blob.type==='image/jpeg'){
   if(first[0]!==255||first[1]!==216)throw Error('JPEGの色情報を追加できません。');
   const payload=new Uint8Array(14+profile.length);payload.set(ascii('ICC_PROFILE\0'));payload[12]=1;payload[13]=1;payload.set(profile,14);const size=payload.length+2;
   const parts=[blob.slice(0,2),new Uint8Array([255,226,size>>>8,size&255]),payload];let p=2;
   while(p+4<=blob.size){const h=await read(p,4);if(h[0]!==255)throw Error('JPEGのデータが破損しています。');const marker=h[1];if(marker===218||marker===217){parts.push(blob.slice(p));return new Blob(parts,{type:blob.type});}const len=(h[2]<<8)|h[3];if(len<2||p+2+len>blob.size)throw Error('JPEGのデータが破損しています。');if(![225,226,237,254].includes(marker))parts.push(blob.slice(p,p+2+len));p+=2+len;
   }
   throw Error('JPEGの画像データがありません。');
  }
  throw Error('色情報の追加はJPEG / PNGのみ対応します。');
 }
 async function inspect(blob){
  if(blob.type==='image/png'){let p=8;while(p+12<=blob.size){const h=await bytes(blob,p,8),len=new DataView(h.buffer).getUint32(0),type=name(h.subarray(4));if(p+len+12>blob.size)break;if(type==='sRGB'&&len===1&&(await bytes(blob,p+8,1))[0]===0)return{space:'sRGB',tag:'PNG sRGB',bits:8};p+=len+12;}}
  if(blob.type==='image/jpeg'){let p=2;while(p+4<=blob.size){const h=await bytes(blob,p,4),len=(h[2]<<8)|h[3];if(h[0]!==255||len<2||p+2+len>blob.size||[218,217].includes(h[1]))break;if(h[1]===226&&len===16+profile.length){const payload=await bytes(blob,p+4,len-2);if(name(payload.subarray(0,12))==='ICC_PROFILE\0'&&payload[12]===1&&payload[13]===1&&profile.every((v,i)=>v===payload[i+14]))return{space:'sRGB',tag:'JPEG ICC',bits:8};}p+=2+len;}}
  throw Error('保存画像のsRGB情報を確認できません。');
 }
 return{tagCanvasOutput,inspect};
})();
