import {EMPTY, cleanBoard, checkProposal, confirmsProposal} from './model.js';

const ID='niti-board', QUERY=`${ID}.propose`, CONFIRM=`${ID}.confirm`;
let board=EMPTY(), frame, queue=Promise.resolve(), activeRequest=false;
const localProposals=new Map(), results=new Map();
const copy=x=>JSON.parse(JSON.stringify(x));
const isLead=()=>game.users.activeGM?.id===game.user.id;
const post=(kind,extra={})=>frame?.contentWindow?.postMessage({niti:true,kind,...extra},location.origin);
const status=()=>post('AVAILABILITY',{readOnly:!game.users.activeGM,gm:game.user.isGM});

Hooks.once('init',()=>{
  game.settings.register(ID,'board',{name:'Общая доска',scope:'world',config:false,type:Object,default:EMPTY(),onChange:value=>{
    try{board=cleanBoard(value);if(!activeRequest)post('STATE',{board:copy(board),readOnly:!game.users.activeGM,gm:game.user.isGM});}
    catch(error){console.error('[Нити] Повреждённое состояние доски',error);post('WARN',{text:'Ошибка загрузки доски. Сообщи мастеру.'});}
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
  try{board=cleanBoard(game.settings.get(ID,'board')||EMPTY());}catch(error){console.error('[Нити]',error);board=EMPTY();}
  window.addEventListener('message',onFrameMessage);
  Hooks.on('userConnected',()=>status());
  attachUI();
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
  board=cleanBoard(game.settings.get(ID,'board')||EMPTY());
  const {patch,next}=checkProposal(board,proposal,{isGM:author.isGM});
  for(const op of patch.nodes) {
    if(!op.value?.actorUuid)continue;
    const old=board.nodes.find(x=>x.id===op.id);
    if(old?.actorUuid===op.value.actorUuid)continue;
    const actor=await fromUuid(op.value.actorUuid);
    if(actor?.documentName!=='Actor'||(!author.isGM&&!actor.testUserPermission(author,'LIMITED')))throw Error('Actor недоступен отправителю');
    const hidden=[...game.users].filter(user=>!user.isGM&&!actor.testUserPermission(user,'LIMITED'));
    if(hidden.length){
      if(!author.isGM)throw Error('Actor не виден всем игрокам. Попроси GM опубликовать его.');
      if(!window.confirm(`«${actor.name}» не виден ${hidden.length} игрокам. Имя и портрет станут публичными на доске. Опубликовать?`))throw Error('Публикация Actor отменена');
    }
    if(!author.isGM){op.value.title=String(actor.name).slice(0,80);op.value.photo=String(actor.img||'').slice(0,100000);Object.assign(next.nodes.find(x=>x.id===op.id),op.value);}
  }
  if(!isLead())throw Error('Активный GM сменился до записи');
  if(cleanBoard(game.settings.get(ID,'board')||EMPTY()).revision!==board.revision)throw Error('Доска изменилась до записи. Повтори правку.');
  await game.settings.set(ID,'board',next);
  board=next;
  const answer={opId:proposal.opId,revision:next.revision,board:copy(next)};
  results.set(key,answer);if(results.size>300)results.delete(results.keys().next().value);
  post('STATE',{board:copy(board),readOnly:false,gm:true});
  return copy(answer);
}

async function submit(patch,base,baseRevision) {
  const gm=game.users.activeGM;
  if(!gm){post('ERROR',{text:'Нет подключённого GM. Изменение не сохранено.',board:copy(board)});return;}
  const proposal={opId:crypto.randomUUID().replaceAll('-',''),authorId:game.user.id,baseRevision,base,patch};
  localProposals.set(proposal.opId,copy(proposal));activeRequest=true;
  post('SAVING');
  try {
    const answer=isLead()?await accept(proposal):await gm.query(QUERY,proposal,{timeout:15000});
    board=cleanBoard(answer.board);
    post('ACK',{board:copy(board),revision:board.revision});
  } catch(error) {
    console.warn('[Нити] Сохранение не выполнено',error);
    try{board=cleanBoard(game.settings.get(ID,'board')||EMPTY());}catch{}
    post('ERROR',{text:`Не удалось сохранить: ${error.message}. Доска обновлена; повтори правку.`,board:copy(board)});
  } finally {
    localProposals.delete(proposal.opId);activeRequest=false;
    try {
      const latest=cleanBoard(game.settings.get(ID,'board')||EMPTY());
      if(latest.revision>board.revision){board=latest;post('STATE',{board:copy(board),readOnly:!game.users.activeGM,gm:game.user.isGM});}
    } catch(error){console.warn('[Нити] Не удалось обновить доску после записи',error);}
    status();
  }
}

function onFrameMessage(event) {
  if(event.origin!==location.origin||event.source!==frame?.contentWindow||event.data?.niti!==true)return;
  const msg=event.data;
  if(msg.kind==='READY')post('STATE',{board:copy(board),gm:game.user.isGM,readOnly:!game.users.activeGM});
  if(msg.kind==='PATCH') {
    if(activeRequest){post('ERROR',{text:'Дождись подтверждения предыдущего изменения.',board:copy(board)});return;}
    submit(msg.patch,msg.base,msg.baseRevision);
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
  const root=document.createElement('section');root.id='niti-board-window';root.hidden=true;
  root.innerHTML=`<div class="niti-window-header"><strong>⌁ Нити — общая доска связей <small>0.1.0-beta.2</small></strong><button class="niti-shell-button" type="button" data-action="expand" title="Развернуть">▢</button><button class="niti-shell-button" type="button" data-action="close" title="Закрыть">×</button></div><iframe title="Общая доска Нити"></iframe><div class="niti-drop-overlay">Отпусти Actor, чтобы добавить на доску</div><div class="niti-resize" aria-label="Изменить размер"></div>`;
  document.body.appendChild(root);frame=root.querySelector('iframe');
  fetch('modules/niti-board/ui/board.html',{cache:'no-store'}).then(response=>{if(!response.ok)throw Error(`HTTP ${response.status}`);return response.text()}).then(html=>{
    frame.srcdoc=html.replace('<html lang="ru">','<html lang="ru" data-niti-foundry="true">');
  }).catch(error=>{console.error('[Нити] Не удалось открыть доску',error);ui.notifications.error('Нити: не удалось загрузить интерфейс доски');});
  const overlay=root.querySelector('.niti-drop-overlay');
  document.addEventListener('dragstart',event=>{
    if(root.hidden)return;
    let drag={};try{drag=foundry.applications.ux.TextEditor.getDragEventData(event)}catch{}
    if(drag.type==='Actor')root.classList.add('niti-external-drag');
  },false);
  document.addEventListener('dragend',()=>root.classList.remove('niti-external-drag'),true);
  overlay.addEventListener('dragover',event=>{event.preventDefault();event.dataTransfer.dropEffect='copy';});
  overlay.addEventListener('drop',event=>{
    event.preventDefault();root.classList.remove('niti-external-drag');
    const drag=foundry.applications.ux.TextEditor.getDragEventData(event);
    if(drag.type!=='Actor')return;
    const r=frame.getBoundingClientRect();
    importActor({uuid:drag.uuid,id:drag.id,x:event.clientX-r.left,y:event.clientY-r.top}).catch(error=>post('WARN',{text:error.message}));
  });
  let saved;try{saved=JSON.parse(localStorage.getItem('niti-board-window-v1')||'null')}catch{}
  if(saved)for(const key of ['left','top','width','height'])if(/^\d+(?:\.\d+)?(?:px|vw|vh)$/.test(saved[key]||''))root.style[key]=saved[key];
  const keep=()=>localStorage.setItem('niti-board-window-v1',JSON.stringify(Object.fromEntries(['left','top','width','height'].map(k=>[k,root.style[k]]))));
  launch.addEventListener('click',()=>{root.hidden=!root.hidden;launch.setAttribute('aria-expanded',String(!root.hidden));if(!root.hidden)post('OPEN');});
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
