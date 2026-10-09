// Pure board model and input limits. No Foundry globals: unit-testable under Node.
export const EMPTY = () => ({nodes: [], edges: [], revision: 0});
export const confirmsProposal = (pending,candidate)=>!!pending&&JSON.stringify(pending)===JSON.stringify(candidate);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Number(v) : lo));
const txt = (x, max) => String(x ?? "").slice(0, max);
const color = (x) => /^#[0-9a-f]{6}$/i.test(x ?? "") ? x : "#be6b78";
const validId = (x) => typeof x === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(x);
export function cleanNode(x) {
  if (!x || typeof x !== "object" || !validId(x.id) || !["card","note","zone"].includes(x.type)) return null;
  const o = {id:x.id,type:x.type,x:clamp(x.x,0,2500),y:clamp(x.y,0,1650)};
  if(x.type === "card") {
    const p = txt(x.photo, 100000);
    o.title=txt(x.title,80);o.subtitle=txt(x.subtitle,110);o.compact=!!x.compact;
    o.photo = /^(?:https?:\/\/[^\s<>"']+|\/(?!\/)[^\s<>"']+|(?:icons|systems|modules|worlds|assets|uploads)\/[^\s<>"']+|data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+)$/i.test(p) ? p : "";
    o.actorUuid=txt(x.actorUuid,180);
    o.locked=!!x.locked;
  } else if (x.type === "note") {
    o.title=txt(x.title,120);o.body=txt(x.body,1500);
    o.color=["yellow","pink","blue","green"].includes(x.color)?x.color:"yellow";
  } else {o.title=txt(x.title,85);o.w=clamp(x.w,180,1500);o.h=clamp(x.h,130,1200);}
  return o;
}
export function cleanEdge(x) {
  if(!x || typeof x!=="object" || !validId(x.id) || !validId(x.from) || !validId(x.to) || x.from===x.to)return null;
  return {id:x.id,from:x.from,to:x.to,label:txt(x.label,55),color:color(x.color),dashed:!!x.dashed,arrow:!!x.arrow};
}
export function cleanPatch(patch, maxOps=80) {
  if(!patch || typeof patch!=="object" || !Array.isArray(patch.nodes) || !Array.isArray(patch.edges))return null;
  if(patch.nodes.length+patch.edges.length>maxOps)return null;
  const nodes=[],edges=[];
  for(const item of patch.nodes) {
    if(!validId(item?.id))return null;
    const value=item.value===null?null:cleanNode(item.value);
    if(value!==null && (!value || value.id!==item.id))return null;
    nodes.push({id:item.id,value});
  }
  for(const item of patch.edges) {
    if(!validId(item?.id))return null;
    const value=item.value===null?null:cleanEdge(item.value);
    if(value!==null && (!value || value.id!==item.id))return null;
    edges.push({id:item.id,value});
  }
  return {nodes,edges};
}
export function cleanBoard(input) {
  if (!input || !Array.isArray(input.nodes) || !Array.isArray(input.edges) || input.nodes.length>400 || input.edges.length>900) throw Error('Неверный формат доски');
  const nodes=input.nodes.map(cleanNode),edges=input.edges.map(cleanEdge);
  if(nodes.some(x=>!x)||edges.some(x=>!x))throw Error('Повреждённые данные доски');
  if(new Set(nodes.map(x=>x.id)).size!==nodes.length||new Set(edges.map(x=>x.id)).size!==edges.length)throw Error('Повторяющиеся ID');
  const ids=new Set(nodes.map(x=>x.id));
  if(edges.some(x=>!ids.has(x.from)||!ids.has(x.to)))throw Error('Связь с отсутствующей карточкой');
  const board={nodes,edges,revision:Number.isSafeInteger(input.revision)&&input.revision>=0?input.revision:0};
  if(JSON.stringify(board).length>750000)throw Error('Достигнут лимит размера доски (750 КБ)');
  return board;
}
export function checkProposal(current, proposal, {isGM=false}={}) {
  const patch=cleanPatch(proposal?.patch,isGM?1400:80);
  if(!patch||!Number.isSafeInteger(proposal?.baseRevision)||proposal.baseRevision>current.revision||proposal.baseRevision<0)throw Error('Неверная операция');
  const base=proposal.base;
  if(!base||!Array.isArray(base.nodes)||!Array.isArray(base.edges))throw Error('Нет базы изменения');
  for(const kind of ['nodes','edges']) {
    const ops=patch[kind], seen=new Set(), list=new Map(current[kind].map(x=>[x.id,x]));
    const bases=new Map(base[kind].map(x=>[x.id,x.value]));
    if(bases.size!==ops.length)throw Error('Неверная база изменения');
    for(const op of ops) {
      if(seen.has(op.id)||!bases.has(op.id))throw Error('Повторяющаяся операция');seen.add(op.id);
      const old=list.get(op.id)??null, expected=bases.get(op.id);
      if(JSON.stringify(old)!==JSON.stringify(expected))throw Error('Конфликт: объект уже изменён. Обнови доску.');
      if(kind==='nodes'&&!isGM) {
        if(old?.locked&&(op.value===null||op.value.locked!==true||op.value.actorUuid!==old.actorUuid))throw Error('Карточка защищена мастером');
        if(op.value?.locked&&!old?.locked)throw Error('Только мастер может защитить карточку');
        if(old&&op.value&&op.value.actorUuid!==old.actorUuid)throw Error('Привязку Actor меняет мастер');
      }
    }
  }
  for(const op of patch.nodes)if(op.value===null){
    const undeclared=current.edges.find(edge=>(edge.from===op.id||edge.to===op.id)&&!patch.edges.some(change=>change.id===edge.id&&change.value===null));
    if(undeclared)throw Error('Конфликт: к карточке добавлена связь. Обнови доску.');
  }
  const next=applyPatch(current,patch);
  for(const op of patch.edges)if(op.value&&!next.edges.some(x=>x.id===op.id))throw Error('Конечная карточка связи удалена');
  next.revision=current.revision+1;
  return {patch,next};
}
export function applyPatch(input, patch) {
  const board=JSON.parse(JSON.stringify(input ?? EMPTY()));
  const patchList=(list,ops)=>{
    const map=new Map(list.map(x=>[x.id,x]));
    for(const {id,value} of ops){if(value===null)map.delete(id);else map.set(id,value);}
    return [...map.values()];
  };
  board.nodes=patchList(board.nodes||[],patch.nodes);
  board.edges=patchList(board.edges||[],patch.edges).filter(e=>board.nodes.some(n=>n.id===e.from)&&board.nodes.some(n=>n.id===e.to));
  if(board.nodes.length>400||board.edges.length>900)throw Error("Доска слишком большая");
  if(JSON.stringify(board).length>750000)throw Error("Достигнут лимит размера доски (750 КБ)");
  return board;
}
export function diffBoard(previous, next) {
  const getOps=(a,b)=>{
    const old=new Map((a||[]).map(x=>[x.id,JSON.stringify(x)])),newMap=new Map((b||[]).map(x=>[x.id,x]));
    const ops=[];
    for(const [id,val] of newMap) if(old.get(id)!==JSON.stringify(val))ops.push({id,value:val});
    for(const [id] of old) if(!newMap.has(id))ops.push({id,value:null});
    return ops;
  };
  return {nodes:getOps(previous.nodes,next.nodes),edges:getOps(previous.edges,next.edges)};
}
