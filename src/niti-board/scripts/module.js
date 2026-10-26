import {EMPTY, cleanBoard, checkProposal, confirmsProposal} from './model.js';
import {LEGACY_BOARD_ID, BOARD_FLAG, boardTitle, boardMeta, mayRead, mayManage, boardOwnership, cleanView} from './boards.js';
import {isPrivateId, createVault, openVault, openVaultWithKey, sealVault} from './vault.js';

const ID='niti-board', QUERY=`${ID}.propose`, CONFIRM=`${ID}.confirm`;
let board=EMPTY(), currentId=LEGACY_BOARD_ID, frame, queue=Promise.resolve(), activeRequest=false;
const localProposals=new Map(), results=new Map();
const privateCache=new Map();
let vaultCache=null,vaultKey=null;
const copy=x=>JSON.parse(JSON.stringify(x));
const isLead=()=>game.users.activeGM?.id===game.user.id;
const post=(kind,extra={})=>frame?.contentWindow?.postMessage({niti:true,kind,...extra},location.origin);
const status=()=>post('AVAILABILITY',{readOnly:!game.users.activeGM,gm:game.user.isGM});
const applyTheme=value=>{const theme=value==='fantasy'?'fantasy':'gothic';document.body.dataset.nitiTheme=theme;post('THEME',{theme});};
const visibleBoards=(user=game.user)=>[
  {id:LEGACY_BOARD_ID,title:'Общая доска',visibility:'public',ownerId:''},
  ...[...game.journal].map(doc=>({doc,meta:boardMeta(doc)}))
    .filter(({meta})=>meta?.visibility==='public').map(({meta})=>meta),
  ...[...privateCache.values()].filter(entry=>mayRead(entry,user)).map(({id,title,visibility,ownerId})=>({id,title,visibility,ownerId}))
];
function boardSource(id,user=game.user) {
  if(id===LEGACY_BOARD_ID)return {state:cleanBoard(game.settings.get(ID,'board')||EMPTY()),visibility:'public'};
  if(isPrivateId(id)){
    const entry=(isLead()?vaultCache?.boards.find(item=>item.id===id):null)||privateCache.get(id);
    if(!mayRead(entry,user))throw Error('Нет доступа к личной доске');
    return {entry,state:cleanBoard(entry.state),visibility:'private'};
  }
  const doc=game.journal.get(id),meta=boardMeta(doc);
  if(meta?.visibility!=='public'||!mayRead(meta,user))throw Error('Нет доступа к доске');
  return {doc,meta,state:cleanBoard(doc.getFlag(BOARD_FLAG,'state')||EMPTY()),visibility:meta.visibility};
}
function currentView(id) {return isPrivateId(id)?cleanView(boardSource(id).entry.views?.[game.user.id]):cleanView(game.settings.get(ID,'boardViews')?.[id]);}
function sendList(){post('BOARD_LIST',{boards:visibleBoards(),selected:currentId});}
function showBoard(id,{remember=true}={}) {
  try{board=boardSource(id).state;currentId=id;}
  catch(error){console.warn('[Нити] Доска недоступна',error);currentId=LEGACY_BOARD_ID;board=boardSource(currentId).state;}
  if(remember&&!isPrivateId(currentId))game.settings.set(ID,'lastBoard',currentId).catch(error=>console.warn('[Нити] Выбор доски не сохранён',error));
  sendList();post('STATE',{board:copy(board),boardId:currentId,view:currentView(currentId),readOnly:!game.users.activeGM,gm:game.user.isGM});
}
function onJournalChanged(doc){
  if(boardMeta(doc)?.visibility!=='public'&&doc?.id!==currentId)return;
  if(currentId!==LEGACY_BOARD_ID&&!isPrivateId(currentId)&&!game.journal.get(currentId)){showBoard(LEGACY_BOARD_ID);return;}
  sendList();
  if(doc.id===currentId&&!activeRequest)showBoard(currentId,{remember:false});
}

function askVaultPassword(create){
  return new Promise((resolve,reject)=>{
    const dialog=document.createElement('dialog');
    dialog.style.cssText='border:1px solid #806573;border-radius:9px;background:#24212b;color:#eee5ea;max-width:min(400px,90vw);padding:20px;box-shadow:0 18px 55px #0009';
    dialog.innerHTML=`<form><h2 style="margin:0 0 12px;font:600 18px Georgia,serif">Личные доски «Нити»</h2><p style="line-height:1.45">${create?'Задай пароль длиной не менее 16 символов и сохрани его отдельно. Без него личные доски нельзя восстановить.':'Введи пароль личных досок, чтобы открыть их участникам.'}</p><input type="password" autocomplete="off" required minlength="16" placeholder="Пароль" style="width:100%;padding:8px;margin:6px 0">${create?'<input type="password" autocomplete="off" required minlength="16" placeholder="Повтори пароль" style="width:100%;padding:8px;margin:6px 0">':''}<p class="niti-vault-error" style="min-height:1.2em;color:#f3a2a2"></p><div style="display:flex;justify-content:flex-end;gap:8px"><button type="button" data-cancel>Отмена</button><button type="submit">${create?'Создать':'Открыть'}</button></div></form>`;
    document.body.appendChild(dialog);
    const finish=(value,error)=>{dialog.close();dialog.remove();if(error)reject(error);else resolve(value)};
    dialog.querySelector('[data-cancel]').addEventListener('click',()=>finish(null,Error('GM отменил разблокировку личных досок')));
    dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null,Error('GM отменил разблокировку личных досок'))});
    dialog.querySelector('form').addEventListener('submit',event=>{
      event.preventDefault();const fields=[...dialog.querySelectorAll('input')],passphrase=fields[0].value;
      if(passphrase.length<16){dialog.querySelector('.niti-vault-error').textContent='Нужно не менее 16 символов';return}
      if(create&&passphrase!==fields[1].value){dialog.querySelector('.niti-vault-error').textContent='Пароли не совпали';return}
      finish(passphrase);
    });
    dialog.showModal();dialog.querySelector('input').focus();
  });
}
async function unlockVault({create=false,interactive=false}={}){
  if(!isLead())throw Error('Личные доски доступны только через активного GM');
  if(vaultCache&&(!create||vaultKey))return vaultCache;
  const envelope=game.settings.get(ID,'privateVault')||{};
  if(envelope.version!==1){
    if(!create){vaultCache={boards:[]};return vaultCache;}
    if(!interactive)throw Error('GM должен нажать «Открыть личные доски» в панели «Нити»');
    const passphrase=await askVaultPassword(true);
    const created=await createVault(passphrase);vaultKey=created.key;vaultCache={boards:[]};
    await game.settings.set(ID,'privateVault',created.envelope);
  }else{
    if(!interactive)throw Error('GM должен нажать «Открыть личные доски» в панели «Нити»');
    const passphrase=await askVaultPassword(false);
    const opened=await openVault(envelope,passphrase);vaultKey=opened.key;vaultCache=opened.vault;
  }
  privateCache.clear();for(const entry of vaultCache.boards)privateCache.set(entry.id,entry);
  sendList();return vaultCache;
}
async function saveVault(){
  if(!vaultKey||!vaultCache)throw Error('Личные доски не разблокированы');
  const envelope=game.settings.get(ID,'privateVault');
  try{await game.settings.set(ID,'privateVault',await sealVault(vaultCache,vaultKey,envelope.salt));}
  catch(error){
    vaultCache=await openVaultWithKey(game.settings.get(ID,'privateVault'),vaultKey);
    privateCache.clear();for(const entry of vaultCache.boards)privateCache.set(entry.id,entry);
    throw error;
  }
  privateCache.clear();for(const entry of vaultCache.boards)privateCache.set(entry.id,entry);
  sendList();
}
async function askGM(kind,payload={}){
  const gm=game.users.activeGM;if(!gm)throw Error('Нет подключённого GM');
  const proposal={opId:crypto.randomUUID().replaceAll('-',''),authorId:game.user.id,kind,...payload};
  localProposals.set(proposal.opId,copy(proposal));
  try{return isLead()?await accept(proposal):await gm.query(QUERY,proposal,{timeout:60000});}
  finally{localProposals.delete(proposal.opId)}
}
async function refreshPrivate({readCurrent=true}={}){
  if(!game.users.activeGM)return;
  try{
    const answer=await askGM('list');
    const available=new Set(answer.boards.map(item=>item.id));
    for(const id of privateCache.keys())if(!available.has(id))privateCache.delete(id);
    for(const meta of answer.boards)privateCache.set(meta.id,{...privateCache.get(meta.id),...meta});
    if(isPrivateId(currentId)&&!available.has(currentId)){showBoard(LEGACY_BOARD_ID);return;}
    sendList();
    if(readCurrent&&isPrivateId(currentId))await openPrivate(currentId,{remember:false,quiet:true});
  }catch(error){console.warn('[Нити] Личные доски не загружены',error);post('WARN',{text:'Личные доски пока недоступны: '+error.message});}
}
async function openPrivate(id,{remember=true,quiet=false}={}){
  const answer=await askGM('read',{boardId:id});
  privateCache.set(id,{...answer.meta,state:cleanBoard(answer.board),views:{[game.user.id]:answer.view}});
  if(quiet&&currentId===id&&board.revision===answer.board.revision){sendList();return;}
  showBoard(id,{remember});
}

Hooks.once('init',()=>{
  game.settings.register(ID,'board',{name:'Общая доска',scope:'world',config:false,type:Object,default:EMPTY(),onChange:value=>{
    try{if(currentId===LEGACY_BOARD_ID&&!activeRequest){board=cleanBoard(value);post('STATE',{board:copy(board),boardId:currentId,readOnly:!game.users.activeGM,gm:game.user.isGM});}}
    catch(error){console.error('[Нити] Повреждённое состояние доски',error);post('WARN',{text:'Ошибка загрузки доски. Сообщи мастеру.'});}
  }});
  game.settings.register(ID,'theme',{name:'Тема доски «Нити»',hint:'Общая тема для всех участников мира. Меняет только оформление.',scope:'world',config:true,restricted:true,type:String,choices:{gothic:'Готическая',fantasy:'Фэнтези'},default:'gothic',onChange:applyTheme});
  game.settings.register(ID,'launcherPosition',{name:'Положение значка «Нити»',scope:'user',config:false,type:Object,default:{}});
  game.settings.register(ID,'lastBoard',{name:'Выбранная доска «Нити»',scope:'user',config:false,type:String,default:LEGACY_BOARD_ID});
  game.settings.register(ID,'boardViews',{name:'Камера досок «Нити»',scope:'user',config:false,type:Object,default:{}});
  game.settings.register(ID,'privateVault',{name:'Зашифрованные личные доски «Нити»',scope:'world',config:false,restricted:true,type:Object,default:{},onChange:()=>{
    if(!isLead()&&privateCache.size&&!activeRequest)refreshPrivate();
  }});
  CONFIG.queries[QUERY]=proposal=>{
    if(!isLead())throw Error('Этот клиент больше не активный GM');
    const task=queue.then(()=>accept(proposal));
    queue=task.catch(error=>console.warn('[Нити] Операция отклонена',error));
    return task;
  };
  CONFIG.queries[CONFIRM]=challenge=>{
    const pending=localProposals.get(challenge?.opId);
    return confirmsProposal(pending,challenge.proposal);
  };
});

Hooks.once('ready',()=>{
  window.addEventListener('message',onFrameMessage);
  game.socket.on(`module.${ID}`,message=>{if(message?.kind==='vault-ready'&&!isLead())refreshPrivate({readCurrent:false})});
  Hooks.on('userConnected',()=>{status();if(!isLead())refreshPrivate({readCurrent:false});});
  for(const name of ['createJournalEntry','updateJournalEntry','deleteJournalEntry'])Hooks.on(name,onJournalChanged);
  attachUI();
  applyTheme(game.settings.get(ID,'theme'));
  showBoard(game.settings.get(ID,'lastBoard'),{remember:false});
  refreshPrivate({readCurrent:false});
});

async function accept(proposal) {
  if(!isLead())throw Error('Нет активного мастера');
  const author=game.users.get(proposal?.authorId);
  if(!author?.active||typeof proposal?.opId!=='string'||!/^[a-zA-Z0-9_-]{8,80}$/.test(proposal.opId))throw Error('Неизвестный автор операции');
  const key=`${author.id}:${proposal.opId}`;
  if(author.id===game.user.id) {
    if(!confirmsProposal(localProposals.get(proposal.opId),proposal))throw Error('Отправитель не подтвердил операцию');
  } else {
    const confirmed=await author.query(CONFIRM,{opId:proposal.opId,proposal},{timeout:10000});
    if(confirmed!==true)throw Error('Отправитель не подтвердил операцию');
  }
  if(results.has(key))return copy(results.get(key));
  let answer;
  if(proposal.kind==='list'){
    const vault=await unlockVault();
    answer={opId:proposal.opId,kind:'list',boards:vault.boards.filter(entry=>mayRead(entry,author)).map(({id,title,visibility,ownerId})=>({id,title,visibility,ownerId}))};
  } else if(proposal.kind==='read'){
    const vault=await unlockVault(),entry=vault.boards.find(item=>item.id===proposal.boardId);
    if(!mayRead(entry,author))throw Error('Нет доступа к личной доске');
    answer={opId:proposal.opId,kind:'read',meta:{id:entry.id,title:entry.title,visibility:'private',ownerId:entry.ownerId},board:copy(entry.state),view:entry.views[author.id]||null};
  } else if(proposal.kind==='view'){
    const vault=await unlockVault(),entry=vault.boards.find(item=>item.id===proposal.boardId);
    if(!mayRead(entry,author))throw Error('Нет доступа к личной доске');
    const view=cleanView(proposal.view);if(!view)throw Error('Неверное положение камеры');
    entry.views[author.id]=view;await saveVault();
    answer={opId:proposal.opId,kind:'view',boardId:entry.id};
  } else if(proposal.kind==='create') {
    const visibility=proposal.visibility;
    if(!['public','private'].includes(visibility))throw Error('Неверный тип доски');
    const title=boardTitle(proposal.title);
    if(visibility==='private'){
      const vault=await unlockVault({create:true});
      let entry=vault.boards.find(item=>item.creationOpId===proposal.opId&&item.ownerId===author.id);
      if(!entry){
        if(vault.boards.length>=100)throw Error('Достигнут лимит личных досок');
        entry={id:'p-'+crypto.randomUUID().replaceAll('-',''),title,visibility:'private',ownerId:author.id,creationOpId:proposal.opId,state:EMPTY(),views:{}};
        vault.boards.push(entry);await saveVault();
      }
      answer={opId:proposal.opId,kind:'create',boardId:entry.id,meta:{id:entry.id,title:entry.title,visibility:'private',ownerId:entry.ownerId},board:copy(entry.state)};
    }else{
      const existing=[...game.journal].find(doc=>doc.getFlag(ID,'creationOpId')===proposal.opId&&doc.getFlag(ID,'ownerId')===author.id);
      if(existing)answer={opId:proposal.opId,kind:'create',boardId:existing.id};
      else {
        if([...game.journal].filter(doc=>boardMeta(doc)?.visibility==='public').length>=100)throw Error('Достигнут лимит общих досок');
        const doc=await JournalEntry.create({name:title,ownership:boardOwnership('public',author.id),flags:{[ID]:{kind:'board',visibility:'public',ownerId:author.id,creationOpId:proposal.opId,state:EMPTY()}}});
        answer={opId:proposal.opId,kind:'create',boardId:doc.id};
      }
    }
  } else if(['rename','delete'].includes(proposal.kind)) {
    if(proposal.boardId===LEGACY_BOARD_ID)throw Error('Исходную общую доску нельзя переименовать или удалить');
    if(isPrivateId(proposal.boardId)){
      const vault=await unlockVault(),entry=vault.boards.find(item=>item.id===proposal.boardId);
      if(!mayManage(entry,author))throw Error('Нет прав на управление доской');
      if(entry.title!==proposal.baseName)throw Error('Название доски изменилось. Обнови список.');
      if(proposal.kind==='rename')entry.title=boardTitle(proposal.title);
      else vault.boards=vault.boards.filter(item=>item.id!==entry.id);
      await saveVault();
    }else{
      const doc=game.journal.get(proposal.boardId),meta=boardMeta(doc);
      if(meta?.visibility!=='public'||!mayManage(meta,author))throw Error('Нет прав на управление доской');
      if(meta.title!==proposal.baseName)throw Error('Название доски изменилось. Обнови список.');
      if(proposal.kind==='rename')await doc.update({name:boardTitle(proposal.title)});
      else await doc.delete();
    }
    answer={opId:proposal.opId,kind:proposal.kind,boardId:proposal.boardId};
  } else if(proposal.kind==='patch') {
    if(isPrivateId(proposal.boardId))await unlockVault();
    const source=boardSource(proposal.boardId,author),before=source.state;
    const {patch,next}=checkProposal(before,proposal,{isGM:author.isGM});
    for(const op of patch.nodes) {
      if(!op.value?.actorUuid)continue;
      const old=before.nodes.find(x=>x.id===op.id);
      if(old?.actorUuid===op.value.actorUuid)continue;
      const actor=await fromUuid(op.value.actorUuid);
      if(actor?.documentName!=='Actor'||(!author.isGM&&!actor.testUserPermission(author,'LIMITED')))throw Error('Actor недоступен отправителю');
      if(source.visibility==='public'){
        const hidden=[...game.users].filter(user=>!user.isGM&&!actor.testUserPermission(user,'LIMITED'));
        if(hidden.length){
          if(!author.isGM)throw Error('Actor не виден всем игрокам. Попроси GM опубликовать его.');
          if(!window.confirm(`«${actor.name}» не виден ${hidden.length} игрокам. Имя и портрет станут публичными на доске. Опубликовать?`))throw Error('Публикация Actor отменена');
        }
      }
      if(!author.isGM){op.value.title=String(actor.name).slice(0,80);op.value.photo=String(actor.img||'').slice(0,100000);Object.assign(next.nodes.find(x=>x.id===op.id),op.value);}
    }
    if(!isLead())throw Error('Активный GM сменился до записи');
    if(boardSource(proposal.boardId,author).state.revision!==before.revision)throw Error('Доска изменилась до записи. Повтори правку.');
    if(source.entry){source.entry.state=next;await saveVault();}
    else if(source.doc)await source.doc.setFlag(ID,'state',next);
    else await game.settings.set(ID,'board',next);
    if(currentId===proposal.boardId){board=next;post('STATE',{board:copy(board),boardId:currentId,readOnly:false,gm:true});}
    answer={opId:proposal.opId,kind:'patch',boardId:proposal.boardId,revision:next.revision,board:copy(next)};
  } else throw Error('Неизвестная операция');
  results.set(key,answer);if(results.size>300)results.delete(results.keys().next().value);
  return copy(answer);
}

async function submit(kind,payload={}) {
  if(activeRequest){post('WARN',{text:'Дождись завершения предыдущего изменения'});return;}
  const gm=game.users.activeGM;
  if(!gm){post(kind==='patch'?'ERROR':'BOARD_ERROR',{text:'Нет подключённого GM. Изменение не сохранено.',board:copy(board),boardId:currentId});return;}
  const proposal={opId:crypto.randomUUID().replaceAll('-',''),authorId:game.user.id,kind,...payload};
  localProposals.set(proposal.opId,copy(proposal));activeRequest=true;
  post(kind==='patch'?'SAVING':'BOARD_WORKING',{action:kind});
  try {
    const answer=isLead()?await accept(proposal):await gm.query(QUERY,proposal,{timeout:20000});
    if(kind==='patch'){
      if(answer.boardId!==currentId)throw Error('Ответ относится к другой доске');
      board=cleanBoard(answer.board);
      if(isPrivateId(currentId)){const entry=privateCache.get(currentId);if(entry)entry.state=board;}
      post('ACK',{board:copy(board),boardId:currentId,revision:board.revision});
    } else {
      if(kind==='create'){
        if(isPrivateId(answer.boardId))privateCache.set(answer.boardId,{...answer.meta,state:cleanBoard(answer.board),views:{}});
        else for(let i=0;i<30&&!game.journal.get(answer.boardId);i++)await new Promise(resolve=>setTimeout(resolve,100));
        showBoard(answer.boardId);
      } else if(kind==='delete'&&currentId===answer.boardId)showBoard(LEGACY_BOARD_ID);
      else if(isPrivateId(answer.boardId))await refreshPrivate({readCurrent:false});
      else {sendList();if(kind==='rename'&&currentId===answer.boardId)showBoard(currentId,{remember:false});}
      post('BOARD_OK',{action:kind,boardId:answer.boardId});
    }
  } catch(error) {
    console.warn('[Нити] Сохранение не выполнено',error);
    if(kind==='patch'){
      try{board=boardSource(currentId).state;}catch{}
      post('ERROR',{text:`Не удалось сохранить: ${error.message}. Повтори правку после обновления доски.`,board:copy(board),boardId:currentId});
      if(isPrivateId(currentId))openPrivate(currentId,{remember:false,quiet:false}).catch(refreshError=>console.warn('[Нити] Не удалось обновить личную доску',refreshError));
    } else post('BOARD_ERROR',{text:`Не удалось изменить список досок: ${error.message}`});
  } finally {
    localProposals.delete(proposal.opId);activeRequest=false;
    try{const latest=boardSource(currentId).state;if(latest.revision>board.revision){board=latest;post('STATE',{board:copy(board),boardId:currentId,readOnly:!game.users.activeGM,gm:game.user.isGM});}}
    catch(error){console.warn('[Нити] Не удалось обновить доску после записи',error);}
    status();
  }
}

function onFrameMessage(event) {
  if(event.origin!==location.origin||event.source!==frame?.contentWindow||event.data?.niti!==true)return;
  const msg=event.data;
  if(msg.kind==='READY'){showBoard(currentId,{remember:false});post('THEME',{theme:game.settings.get(ID,'theme')});}
  if(msg.kind==='UNLOCK_PRIVATE'&&isLead()){
    post('BOARD_WORKING',{action:'unlock'});
    unlockVault({create:true,interactive:true}).then(()=>{
      game.socket.emit(`module.${ID}`,{kind:'vault-ready'});
      post('BOARD_OK',{action:'unlock'});
    }).catch(error=>post('BOARD_ERROR',{text:error.message}));
  }
  if(msg.kind==='PATCH') {
    if(msg.boardId!==currentId){post('ERROR',{text:'Выбрана другая доска',board:copy(board),boardId:currentId});return;}
    if(activeRequest){post('ERROR',{text:'Дождись подтверждения предыдущего изменения.',board:copy(board),boardId:currentId});return;}
    submit('patch',{boardId:currentId,patch:msg.patch,base:msg.base,baseRevision:msg.baseRevision});
  }
  if(msg.kind==='SWITCH_BOARD'&&!activeRequest){
    if(isPrivateId(msg.boardId))openPrivate(msg.boardId).catch(error=>{post('WARN',{text:error.message});sendList()});
    else showBoard(msg.boardId);
  }
  if(msg.kind==='BOARD_ACTION'&&!activeRequest)submit(msg.action,{boardId:msg.boardId,baseName:msg.baseName,title:msg.title,visibility:msg.visibility});
  if(msg.kind==='VIEW'&&msg.boardId===currentId){
    const view=cleanView(msg.view);if(!view)return;
    if(isPrivateId(currentId))askGM('view',{boardId:currentId,view}).catch(error=>console.warn('[Нити] Камера личной доски не сохранена',error));
    else {const views=game.settings.get(ID,'boardViews')||{};game.settings.set(ID,'boardViews',{...views,[currentId]:view}).catch(error=>console.warn('[Нити] Камера не сохранена',error));}
  }
  if(msg.kind==='ACTOR_DROP')importActor(msg.payload||{}).catch(error=>post('WARN',{text:'Не удалось добавить актёра: '+error.message}));
}

async function importActor(payload) {
  if(!payload.uuid&&!payload.id)throw Error('Нет идентификатора Actor');
  const actor=payload.uuid?await fromUuid(payload.uuid):game.actors.get(payload.id);
  if(actor?.documentName!=='Actor'||(!game.user.isGM&&!actor.testUserPermission(game.user,'LIMITED')))throw Error('Actor недоступен для этого пользователя');
  post('ACTOR',{actor:{title:actor.name,photo:actor.img||'',uuid:actor.uuid},x:payload.x,y:payload.y});
}

function attachUI() {
  const launch=document.createElement('button');launch.id='niti-launcher';launch.type='button';launch.textContent='⌁  Нити · доска';launch.title='Открыть общую доску';document.body.appendChild(launch);
  let launcherPosition={};try{launcherPosition=game.settings.get(ID,'launcherPosition')||{};}catch(error){console.warn('[Нити] Положение значка не загружено',error)}
  const clampLauncher=(x,y)=>({x:Math.max(0,Math.min(Math.max(0,innerWidth-launch.offsetWidth),Math.round(x))),y:Math.max(0,Math.min(Math.max(0,innerHeight-launch.offsetHeight),Math.round(y)))});
  const placeLauncher=(x,y)=>{const p=clampLauncher(x,y);Object.assign(launch.style,{left:p.x+'px',top:p.y+'px',bottom:'auto'});return p};
  if(Number.isFinite(launcherPosition.x)&&Number.isFinite(launcherPosition.y))placeLauncher(launcherPosition.x,launcherPosition.y);
  else placeLauncher(80,innerHeight-launch.offsetHeight-102);
  window.addEventListener('resize',()=>{const r=launch.getBoundingClientRect();placeLauncher(r.left,r.top)});
  let suppressLauncherClick=false;
  launch.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    const r=launch.getBoundingClientRect(),start={x:e.clientX,y:e.clientY,left:r.left,top:r.top};
    let moved=false;
    const move=event=>{const dx=event.clientX-start.x,dy=event.clientY-start.y;if(!moved&&Math.hypot(dx,dy)<5)return;moved=true;launch.classList.add('niti-dragging');placeLauncher(start.left+dx,start.top+dy)};
    const cleanup=()=>{window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',end,true);window.removeEventListener('pointercancel',cancel,true);launch.classList.remove('niti-dragging')};
    const cancel=()=>cleanup();
    const end=()=>{cleanup();if(!moved)return;suppressLauncherClick=true;setTimeout(()=>{suppressLauncherClick=false},0);const x=Number.parseFloat(launch.style.left),y=Number.parseFloat(launch.style.top);game.settings.set(ID,'launcherPosition',placeLauncher(x,y)).catch(error=>ui.notifications.warn('Нити: положение значка не сохранено: '+error.message))};
    window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',end,true);window.addEventListener('pointercancel',cancel,true);
  });
  const root=document.createElement('section');root.id='niti-board-window';root.hidden=true;
  root.innerHTML=`<div class="niti-window-header"><strong>⌁ Нити — доски связей <small>0.3.0-beta.2</small></strong><button class="niti-shell-button" type="button" data-action="expand" title="Развернуть">▢</button><button class="niti-shell-button" type="button" data-action="close" title="Закрыть">×</button></div><iframe title="Доски Нити"></iframe><div class="niti-drop-overlay">Отпусти Actor, чтобы добавить на доску</div><div class="niti-resize" aria-label="Изменить размер"></div>`;
  document.body.appendChild(root);frame=root.querySelector('iframe');
  fetch('modules/niti-board/ui/board.html',{cache:'no-store'}).then(response=>{if(!response.ok)throw Error(`HTTP ${response.status}`);return response.text()}).then(html=>{
    frame.srcdoc=html.replace('<html lang="ru">','<html lang="ru" data-niti-foundry="true">');
  }).catch(error=>{console.error('[Нити] Не удалось открыть доску',error);ui.notifications.error('Нити: не удалось загрузить интерфейс доски');});
  const overlay=root.querySelector('.niti-drop-overlay');
  document.addEventListener('dragstart',event=>{
    if(root.hidden)return;
    let drag={};try{drag=(foundry?.applications?.ux?.TextEditor||globalThis.TextEditor).getDragEventData(event)}catch{}
    if(drag.type==='Actor')root.classList.add('niti-external-drag');
  },false);
  document.addEventListener('dragend',()=>root.classList.remove('niti-external-drag'),true);
  overlay.addEventListener('dragover',event=>{event.preventDefault();event.dataTransfer.dropEffect='copy';});
  overlay.addEventListener('drop',event=>{
    event.preventDefault();root.classList.remove('niti-external-drag');
    const drag=(foundry?.applications?.ux?.TextEditor||globalThis.TextEditor).getDragEventData(event);
    if(drag.type!=='Actor')return;
    const r=frame.getBoundingClientRect();
    importActor({uuid:drag.uuid,id:drag.id,x:event.clientX-r.left,y:event.clientY-r.top}).catch(error=>post('WARN',{text:error.message}));
  });
  let saved;try{saved=JSON.parse(localStorage.getItem('niti-board-window-v1')||'null')}catch{}
  if(saved)for(const key of ['left','top','width','height'])if(/^\d+(?:\.\d+)?(?:px|vw|vh)$/.test(saved[key]||''))root.style[key]=saved[key];
  const keep=()=>localStorage.setItem('niti-board-window-v1',JSON.stringify(Object.fromEntries(['left','top','width','height'].map(k=>[k,root.style[k]]))));
  launch.addEventListener('click',()=>{if(suppressLauncherClick){suppressLauncherClick=false;return}root.hidden=!root.hidden;launch.setAttribute('aria-expanded',String(!root.hidden));if(!root.hidden)post('OPEN');});
  root.querySelector('[data-action=close]').addEventListener('click',()=>{root.hidden=true;launch.setAttribute('aria-expanded','false');});
  let expanded=false;root.querySelector('[data-action=expand]').addEventListener('click',()=>{
    if(!expanded){root.dataset.old=JSON.stringify(Object.fromEntries(['left','top','width','height'].map(k=>[k,root.style[k]])));Object.assign(root.style,{left:'1vw',top:'2vh',width:'98vw',height:'94vh'});}
    else Object.assign(root.style,JSON.parse(root.dataset.old||'{}'));
    expanded=!expanded;keep();
  });
  function dragHandle(element,isResize){element.addEventListener('pointerdown',e=>{
    if(e.button!==0||e.target.closest('button'))return;e.preventDefault();const r=root.getBoundingClientRect(),ox=e.clientX,oy=e.clientY;
    const move=m=>{if(isResize){root.style.width=Math.max(620,r.width+m.clientX-ox)+'px';root.style.height=Math.max(450,r.height+m.clientY-oy)+'px';}
      else{root.style.left=Math.min(innerWidth-160,Math.max(-r.width+160,r.left+m.clientX-ox))+'px';root.style.top=Math.min(innerHeight-50,Math.max(0,r.top+m.clientY-oy))+'px';}};
    const end=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);keep();};
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',end,{once:true});
  });}
  dragHandle(root.querySelector('.niti-window-header'),false);dragHandle(root.querySelector('.niti-resize'),true);
}
