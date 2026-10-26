import {cleanBoard} from './model.js';
import {boardTitle,cleanView} from './boards.js';

const bytesToBase64=bytes=>{let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary)};
const base64ToBytes=value=>Uint8Array.from(atob(value),character=>character.charCodeAt(0));
const encoder=new TextEncoder(),decoder=new TextDecoder();
export const isPrivateId=id=>typeof id==='string'&&/^p-[a-f0-9]{32}$/.test(id);

export function cleanVault(input) {
  if(!input||!Array.isArray(input.boards)||input.boards.length>100)throw Error('Повреждённое хранилище личных досок');
  const ids=new Set(),boards=input.boards.map(item=>{
    if(!isPrivateId(item?.id)||ids.has(item.id)||typeof item.ownerId!=='string'||!item.ownerId)throw Error('Повреждённый ID личной доски');
    ids.add(item.id);
    const views={};
    for(const [userId,view] of Object.entries(item.views||{}))if(typeof userId==='string'&&userId.length<100){const safe=cleanView(view);if(safe)views[userId]=safe;}
    return {id:item.id,title:boardTitle(item.title),visibility:'private',ownerId:item.ownerId,creationOpId:typeof item.creationOpId==='string'?item.creationOpId:'',state:cleanBoard(item.state),views};
  });
  const vault={boards};
  if(JSON.stringify(vault).length>2000000)throw Error('Достигнут лимит личных досок (2 МБ)');
  return vault;
}

async function derive(passphrase,salt){
  const material=await crypto.subtle.importKey('raw',encoder.encode(passphrase),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:250000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}

export async function createVault(passphrase){
  if(typeof passphrase!=='string'||passphrase.length<16)throw Error('Пароль личных досок должен содержать не менее 16 символов');
  const salt=crypto.getRandomValues(new Uint8Array(16)),key=await derive(passphrase,salt);
  const envelope=await sealVault({boards:[]},key,bytesToBase64(salt));
  return {key,envelope};
}

export async function openVault(envelope,passphrase){
  if(envelope?.version!==1||typeof envelope.salt!=='string'||typeof envelope.iv!=='string'||typeof envelope.data!=='string')throw Error('Неверный формат личных досок');
  const key=await derive(passphrase,base64ToBytes(envelope.salt));
  return {key,vault:await openVaultWithKey(envelope,key)};
}

export async function openVaultWithKey(envelope,key){
  try{
    const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:base64ToBytes(envelope.iv)},key,base64ToBytes(envelope.data));
    return cleanVault(JSON.parse(decoder.decode(bytes)));
  }catch{throw Error('Неверный пароль или повреждённое хранилище личных досок')}
}

export async function sealVault(vault,key,salt){
  const clean=cleanVault(vault),iv=crypto.getRandomValues(new Uint8Array(12));
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(JSON.stringify(clean)));
  return {version:1,salt,iv:bytesToBase64(iv),data:bytesToBase64(new Uint8Array(data))};
}
