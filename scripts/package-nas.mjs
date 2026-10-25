import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=process.cwd(),work=path.join(root,'tmp/nas-package');
fs.rmSync(work,{recursive:true,force:true});
const layer=path.join(work,'layer/app'),bundle=path.join(work,'X-like');fs.mkdirSync(layer,{recursive:true});fs.mkdirSync(path.join(bundle,'data'),{recursive:true});
const copy=(source,target)=>fs.cpSync(source,target,{recursive:true,filter:source=>!['.DS_Store'].includes(path.basename(source))&&!path.basename(source).startsWith('._')});
for(const name of ['server','ui'])copy(path.join(root,'dist',name),path.join(layer,name));
function run(command,args,options={}){const r=spawnSync(command,args,{stdio:'inherit',env:{...process.env,COPYFILE_DISABLE:'1'},...options});if(r.status!==0)throw new Error(`${command} 构建失败`);}
const tarball=path.join(work,'app-layer.tar.gz');run('tar',['--format=ustar','--no-xattrs',...(process.platform==='darwin'?['--no-acls','--no-fflags']:[]),'-czf',tarball,'-C',path.dirname(layer),'app']);
run(process.env.CRANE_BIN??'crane',['mutate','node:24.22.0-bookworm-slim','--platform','linux/arm64','--append',tarball,'--entrypoint','node','--cmd','/app/server/entry.cjs','--workdir','/app','--env','SHIZANG_DATA_DIR=/data','--env','PORT=5368','--env','HOST=0.0.0.0','--env','NODE_ENV=production','--output',path.join(bundle,'x-like-0.1.0-arm64.tar'),'--tag','x-like:0.1.0']);
copy('dist/server',path.join(bundle,'dist/server'));copy('dist/ui',path.join(bundle,'dist/ui'));
for(const name of ['compose.offline.yaml','Dockerfile'])fs.copyFileSync(name,path.join(bundle,name));
fs.copyFileSync('compose.offline.yaml',path.join(bundle,'docker-compose.yaml'));fs.copyFileSync('docs/NAS部署.md',path.join(bundle,'NAS部署.md'));
fs.mkdirSync('release',{recursive:true});const zip=path.join(root,'release/Shizang-0.1.0-NAS-arm64.zip');if(fs.existsSync(zip))fs.unlinkSync(zip);
run('zip',['-q','-r','-X',zip,'X-like'],{cwd:work});console.log('NAS 离线包已生成');
