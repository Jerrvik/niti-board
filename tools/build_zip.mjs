import fs from 'node:fs';
import path from 'node:path';
import {deflateRawSync} from 'node:zlib';

const root=path.resolve('src/niti-board');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'module.json'),'utf8'));
if(manifest.id!=='niti-board')throw Error('Неверный ID модуля');
for(const name of [...(manifest.esmodules||[]),...(manifest.styles||[]),...(manifest.scripts||[]),...(manifest.languages||[]).map(x=>x.path),'ui/board.html']){
  if(!fs.statSync(path.join(root,name)).isFile())throw Error(`Нет файла: ${name}`);
}
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(dir,entry.name)):[path.join(dir,entry.name)]);}
const table=new Uint32Array(256);
for(let n=0;n<256;n++){let x=n;for(let k=0;k<8;k++)x=x&1?0xedb88320^(x>>>1):x>>>1;table[n]=x>>>0;}
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=table[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
const chunks=[],central=[];let offset=0;
for(const filename of files(root).sort()){
  const relative=path.relative(root,filename).replaceAll('\\','/');
  const name=Buffer.from('niti-board/'+relative,'utf8');
  const plain=fs.readFileSync(filename),packed=deflateRawSync(plain,{level:9}),crc=crc32(plain);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(plain.length,22);local.writeUInt16LE(name.length,26);
  chunks.push(local,name,packed);
  const header=Buffer.alloc(46);header.writeUInt32LE(0x02014b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(20,6);header.writeUInt16LE(0x800,8);header.writeUInt16LE(8,10);header.writeUInt32LE(crc,16);header.writeUInt32LE(packed.length,20);header.writeUInt32LE(plain.length,24);header.writeUInt16LE(name.length,28);header.writeUInt32LE(offset,42);
  central.push(header,name);offset+=local.length+name.length+packed.length;
}
const centralSize=central.reduce((n,b)=>n+b.length,0),end=Buffer.alloc(22);
end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(central.length/2,8);end.writeUInt16LE(central.length/2,10);end.writeUInt32LE(centralSize,12);end.writeUInt32LE(offset,16);
fs.mkdirSync('dist',{recursive:true});
const target='dist/niti-board.zip';fs.writeFileSync(target,Buffer.concat([...chunks,...central,end]));
console.log(`Собран ${target}: ${manifest.version}, ${fs.statSync(target).size} байт`);
