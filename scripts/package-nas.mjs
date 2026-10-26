import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const {version}=JSON.parse(fs.readFileSync('package.json','utf8'));
const root=process.cwd(),work=path.join(root,'tmp/nas-package');
try {
fs.rmSync(work,{recursive:true,force:true});
const layer=path.join(work,'layer/app'),bundle=path.join(work,'X-like');fs.mkdirSync(layer,{recursive:true});fs.mkdirSync(path.join(bundle,'data'),{recursive:true});
const copy=(source,target)=>fs.cpSync(source,target,{recursive:true,filter:source=>!['.DS_Store'].includes(path.basename(source))&&!path.basename(source).startsWith('._')});
for(const name of ['server','ui','legal'])copy(path.join(root,'dist',name),path.join(layer,name));
function run(command,args,options={}){const r=spawnSync(command,args,{stdio:'inherit',env:{...process.env,COPYFILE_DISABLE:'1'},...options});if(r.status!==0)throw new Error(`${command} 构建失败`);}
const tarball=path.join(work,'app-layer.tar.gz');run('tar',['--format=ustar','--no-xattrs',...(process.platform==='darwin'?['--no-acls','--no-fflags']:[]),'-czf',tarball,'-C',path.dirname(layer),'app']);
run(process.env.CRANE_BIN??'crane',['mutate','node:24.22.0-bookworm-slim','--platform','linux/arm64','--append',tarball,'--entrypoint','node','--cmd','/app/server/entry.cjs','--workdir','/app','--env','SHIZANG_DATA_DIR=/data','--env','PORT=5368','--env','HOST=0.0.0.0','--env','NODE_ENV=production','--output',path.join(bundle,`x-like-${version}-arm64.tar`),'--tag',`x-like:${version}`]);
for(const name of ['server','ui','legal'])copy(`dist/${name}`,path.join(bundle,`dist/${name}`));
for(const name of ['compose.offline.yaml','Dockerfile','LICENSE','.env.example'])fs.copyFileSync(name,path.join(bundle,name));
fs.writeFileSync(path.join(bundle,'.env.example'),fs.readFileSync('.env.example','utf8').replace('SHIZANG_VERSION=local',`SHIZANG_VERSION=${version}`));
fs.mkdirSync(path.join(bundle,'scripts'),{recursive:true});fs.copyFileSync('scripts/setup-shared.mjs',path.join(bundle,'scripts/setup-shared.mjs'));
fs.copyFileSync('compose.offline.yaml',path.join(bundle,'docker-compose.yaml'));fs.copyFileSync('docs/NAS部署.md',path.join(bundle,'NAS部署.md'));
fs.mkdirSync('release',{recursive:true});const zip=path.join(root,`release/Shizang-${version}-NAS-arm64.zip`);if(fs.existsSync(zip))fs.unlinkSync(zip);
run('zip',['-q','-r','-X',zip,'X-like'],{cwd:work});console.log('NAS 离线包已生成');
} finally {fs.rmSync(work,{recursive:true,force:true});}
