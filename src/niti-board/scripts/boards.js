export const LEGACY_BOARD_ID='legacy';
export const BOARD_FLAG='niti-board';

export function boardTitle(value) {
  const title=String(value??'').replace(/[\u0000-\u001f<>]/g,'').trim().slice(0,60);
  if(!title)throw Error('Укажи название доски');
  return title;
}

export function boardMeta(doc) {
  if(doc?.getFlag?.(BOARD_FLAG,'kind')!=='board')return null;
  const visibility=doc.getFlag(BOARD_FLAG,'visibility');
  const ownerId=doc.getFlag(BOARD_FLAG,'ownerId');
  if(!['public','private'].includes(visibility)||typeof ownerId!=='string'||!ownerId)return null;
  return {id:doc.id,title:String(doc.name||'Доска').slice(0,60),visibility,ownerId};
}

export const mayRead=(meta,user)=>!!meta&&!!user&&(user.isGM||meta.visibility==='public'||meta.ownerId===user.id);
export const mayManage=(meta,user)=>!!meta&&!!user&&(user.isGM||meta.ownerId===user.id);

export function boardOwnership(visibility,ownerId) {
  if(!['public','private'].includes(visibility)||typeof ownerId!=='string'||!ownerId)throw Error('Неверные права доски');
  return visibility==='public'?{default:2}:{default:0,[ownerId]:2};
}

export function cleanView(value) {
  if(!value||![value.panX,value.panY,value.zoom].every(Number.isFinite))return null;
  return {panX:Math.max(-1e10,Math.min(1e10,value.panX)),panY:Math.max(-1e10,Math.min(1e10,value.panY)),zoom:Math.max(.1,Math.min(4,value.zoom))};
}
