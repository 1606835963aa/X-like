import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
const root=process.cwd();fs.mkdirSync('private',{recursive:true,mode:0o700});
const keyfile=path.resolve('private/android-release.keystore'),settingsfile='private/android-signing.json';
let settings=fs.existsSync(settingsfile)?JSON.parse(fs.readFileSync(settingsfile,'utf8')):{password:randomBytes(24).toString('base64url')};
const env={...process.env,SHIZANG_STORE_FILE:keyfile,SHIZANG_STORE_PASSWORD:settings.password};
if(!fs.existsSync(keyfile)){
  const keytool=process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin/keytool'):'keytool';
  const r=spawnSync(keytool,['-genkeypair','-keystore',keyfile,'-storepass:env','SHIZANG_STORE_PASSWORD','-keypass:env','SHIZANG_STORE_PASSWORD','-alias','shizang','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Shizang, O=Wind, C=CN'],{env,stdio:'inherit'});
  if(r.status!==0)process.exit(r.status||1);
  fs.writeFileSync(settingsfile,JSON.stringify(settings),{mode:0o600});fs.chmodSync(keyfile,0o600);
}
const r=spawnSync('./gradlew',['assembleRelease','--no-daemon','--console=plain','--no-watch-fs'],{cwd:'android',env,stdio:'inherit'});
if(r.status!==0)process.exit(r.status||1);
fs.mkdirSync('release',{recursive:true});fs.copyFileSync('android/app/build/outputs/apk/release/app-release.apk','release/Shizang-0.1.0-Android.apk');
console.log('Android 安装包已生成：release/Shizang-0.1.0-Android.apk');
