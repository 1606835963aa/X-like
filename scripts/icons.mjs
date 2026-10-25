import {Resvg} from '@resvg/resvg-js';
import fs from 'node:fs';
import {crc32,deflateSync} from 'node:zlib';
fs.mkdirSync('resources',{recursive:true});
const svg=fs.readFileSync('public/icon.svg','utf8');
const render=(source,size)=>new Resvg(source,{fitTo:{mode:'width',value:size}}).render().asPng();
const images=new Map([16,32,48,64,128,256,512,1024].map(size=>[size,render(svg,size)]));
fs.writeFileSync('resources/icon.png',images.get(1024));
const chunks=[['icp4',16],['icp5',32],['icp6',64],['ic07',128],['ic08',256],['ic09',512],['ic10',1024]].map(([type,size])=>{const data=images.get(size),header=Buffer.alloc(8);header.write(type);header.writeUInt32BE(8+data.length,4);return Buffer.concat([header,data]);});
const header=Buffer.alloc(8);header.write('icns');header.writeUInt32BE(8+chunks.reduce((sum,c)=>sum+c.length,0),4);fs.writeFileSync('resources/icon.icns',Buffer.concat([header,...chunks]));
const sizes=[16,32,48,64,128,256],dir=Buffer.alloc(6+16*sizes.length);dir.writeUInt16LE(1,2);dir.writeUInt16LE(sizes.length,4);let offset=dir.length;
sizes.forEach((size,i)=>{const at=6+i*16,data=images.get(size);dir[at]=size===256?0:size;dir[at+1]=size===256?0:size;dir.writeUInt16LE(1,at+4);dir.writeUInt16LE(32,at+6);dir.writeUInt32LE(data.length,at+8);dir.writeUInt32LE(offset,at+12);offset+=data.length;});
fs.writeFileSync('resources/icon.ico',Buffer.concat([dir,...sizes.map(s=>images.get(s))]));
const paths=[...svg.matchAll(/<path\b([^>]+)\/>/g)].map(([,attributes])=>{const d=attributes.match(/\bd="([^"]+)"/)?.[1],fill=attributes.match(/\bfill="([^"]+)"/)?.[1];if(!d||!fill)throw new Error('图标标记需要路径与填充颜色');return `<path android:pathData="${d}" android:fillColor="${fill==='white'?'#ffffff':fill}"/>`;}).join('');
const res='android/app/src/main/res';
if(fs.existsSync(res)){
  for(const [density,scale] of [['mdpi',1],['hdpi',1.5],['xhdpi',2],['xxhdpi',3],['xxxhdpi',4]]){
    const folder=`${res}/mipmap-${density}`;fs.mkdirSync(folder,{recursive:true});const png=render(svg,48*scale);
    for(const name of ['ic_launcher.png','ic_launcher_round.png'])fs.writeFileSync(`${folder}/${name}`,png);
  }
  fs.mkdirSync(`${res}/mipmap-anydpi-v26`,{recursive:true});
  fs.writeFileSync(`${res}/values/ic_launcher_background.xml`,'<resources><color name="ic_launcher_background">#0059da</color></resources>\n');
  const vector=(content)=>`<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="128" android:viewportHeight="128">${content}</vector>\n`;
  fs.writeFileSync(`${res}/drawable/shizang_foreground.xml`,vector(`<group android:translateX="22.4" android:translateY="22.4" android:scaleX="0.65" android:scaleY="0.65">${paths}</group>`));
  const adaptive='<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/ic_launcher_background"/><foreground android:drawable="@drawable/shizang_foreground"/></adaptive-icon>\n';
  for(const name of ['ic_launcher.xml','ic_launcher_round.xml'])fs.writeFileSync(`${res}/mipmap-anydpi-v26/${name}`,adaptive);
  fs.writeFileSync(`${res}/drawable/shizang_splash.xml`,vector(`<path android:fillColor="#0059da" android:pathData="M28,12H100Q116,12 116,28V100Q116,116 100,116H28Q12,116 12,100V28Q12,12 28,12Z"/><group android:translateX="12.8" android:translateY="12.8" android:scaleX="0.8" android:scaleY="0.8">${paths}</group>`));
}
const ios='ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png';
if(fs.existsSync(ios)){
  const rendered=new Resvg(svg.replace(/(<svg[^>]*>)/,'$1<rect width="128" height="128" fill="#0059da"/>'),{fitTo:{mode:'width',value:1024}}).render();
  const pixels=rendered.pixels,rows=Buffer.alloc((1024*3+1)*1024);
  for(let y=0;y<1024;y++)for(let x=0;x<1024;x++)for(let channel=0;channel<3;channel++)rows[y*(1024*3+1)+1+x*3+channel]=pixels[(y*1024+x)*4+channel];
  const chunk=(type,data)=>{const bytes=Buffer.alloc(12+data.length);bytes.writeUInt32BE(data.length);bytes.write(type,4);data.copy(bytes,8);bytes.writeUInt32BE(crc32(bytes.subarray(4,8+data.length)),8+data.length);return bytes;};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1024);ihdr.writeUInt32BE(1024,4);ihdr[8]=8;ihdr[9]=2;
  fs.writeFileSync(ios,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]));
  const splash=svg.replace(/<svg[^>]*>/,'').replace('</svg>','');
  const splashPng=render(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2732 2732"><rect width="2732" height="2732" fill="#fafafa"/><g transform="translate(1046 1046) scale(5)">${splash}</g></svg>`,2732);
  for(const name of ['splash-2732x2732.png','splash-2732x2732-1.png','splash-2732x2732-2.png']){
    const target='ios/App/App/Assets.xcassets/Splash.imageset/'+name;if(fs.existsSync(target))fs.writeFileSync(target,splashPng);
  }
}
console.log('Mac、Windows、安卓和 iOS 图标已由 public/icon.svg 生成。');
