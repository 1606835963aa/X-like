import {Resvg} from '@resvg/resvg-js';
import fs from 'node:fs';
fs.mkdirSync('resources',{recursive:true});
const svg=fs.readFileSync('public/icon.svg','utf8');
const images=new Map([16,32,48,64,128,256,512,1024].map(size=>[size,new Resvg(svg,{fitTo:{mode:'width',value:size}}).render().asPng()]));
fs.writeFileSync('resources/icon.png',images.get(1024));
const chunks=[['icp4',16],['icp5',32],['icp6',64],['ic07',128],['ic08',256],['ic09',512],['ic10',1024]].map(([type,size])=>{const data=images.get(size);const header=Buffer.alloc(8);header.write(type);header.writeUInt32BE(8+data.length,4);return Buffer.concat([header,data]);});
const header=Buffer.alloc(8);header.write('icns');header.writeUInt32BE(8+chunks.reduce((sum,c)=>sum+c.length,0),4);fs.writeFileSync('resources/icon.icns',Buffer.concat([header,...chunks]));
const sizes=[16,32,48,64,128,256];const dir=Buffer.alloc(6+16*sizes.length);dir.writeUInt16LE(1,2);dir.writeUInt16LE(sizes.length,4);let offset=dir.length;
sizes.forEach((size,i)=>{const at=6+i*16,data=images.get(size);dir[at]=size===256?0:size;dir[at+1]=size===256?0:size;dir.writeUInt16LE(1,at+4);dir.writeUInt16LE(32,at+6);dir.writeUInt32LE(data.length,at+8);dir.writeUInt32LE(offset,at+12);offset+=data.length;});
fs.writeFileSync('resources/icon.ico',Buffer.concat([dir,...sizes.map(s=>images.get(s))]));
const res='android/app/src/main/res';
if(fs.existsSync(res)){
  for(const [density,scale] of [['mdpi',1],['hdpi',1.5],['xhdpi',2],['xxhdpi',3],['xxxhdpi',4]]){
    const folder=`${res}/mipmap-${density}`;fs.mkdirSync(folder,{recursive:true});const png=new Resvg(svg,{fitTo:{mode:'width',value:48*scale}}).render().asPng();
    for(const name of ['ic_launcher.png','ic_launcher_round.png'])fs.writeFileSync(`${folder}/${name}`,png);
  }
  fs.writeFileSync(`${res}/values/ic_launcher_background.xml`,'<resources><color name="ic_launcher_background">#007aff</color></resources>\n');
  const mark='<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108"><path android:pathData="M36,28H72V82L54,70L36,82Z" android:fillColor="#00000000" android:strokeColor="#ffffff" android:strokeWidth="5" android:strokeLineJoin="round"/><path android:pathData="M46,46L53,53L64,39" android:fillColor="#00000000" android:strokeColor="#ffffff" android:strokeWidth="4" android:strokeLineCap="round" android:strokeLineJoin="round"/></vector>';
  fs.writeFileSync(`${res}/drawable/shizang_foreground.xml`,mark);
  const adaptive='<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/ic_launcher_background"/><foreground android:drawable="@drawable/shizang_foreground"/></adaptive-icon>\n';
  for(const name of ['ic_launcher.xml','ic_launcher_round.xml'])fs.writeFileSync(`${res}/mipmap-anydpi-v26/${name}`,adaptive);
  const splash=mark.replace('<path android:pathData="M36','<path android:fillColor="#007aff" android:pathData="M28,12H80Q96,12 96,28V80Q96,96 80,96H28Q12,96 12,80V28Q12,12 28,12Z"/><path android:pathData="M36');
  fs.writeFileSync(`${res}/drawable/shizang_splash.xml`,splash);
}
