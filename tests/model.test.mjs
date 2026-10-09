import test from 'node:test';
import assert from 'node:assert/strict';
import {EMPTY, cleanNode, cleanEdge, cleanPatch, cleanBoard, checkProposal, confirmsProposal, applyPatch, diffBoard} from '../src/niti-board/scripts/model.js';

const card=(id,x=100)=>({id,type:'card',x,y:100,title:id,subtitle:'',compact:false,photo:'',actorUuid:'',locked:false});
const edge=(id,from,to)=>({id,from,to,label:'служит',color:'#be6b78',dashed:false,arrow:true});

test('empty board has independent arrays',()=>{
  const a=EMPTY(),b=EMPTY();a.nodes.push(card('foo'));assert.equal(b.nodes.length,0);
});
test('normalizes a valid card and truncates name',()=>{
  const n=cleanNode({...card('npc1'),title:'X'.repeat(200)});assert.equal(n.id,'npc1');assert.equal(n.title.length,80);
});
test('rejects invalid HTML-like ids',()=>{
  assert.equal(cleanNode({...card('bad<>')}),null);
  assert.equal(cleanEdge(edge('e','same','same')),null);
});
test('applies add, move and multiple links',()=>{
  let state=applyPatch(EMPTY(),{nodes:[{id:'a',value:card('a')},{id:'b',value:card('b',350)}],edges:[]});
  state=applyPatch(state,{nodes:[],edges:[{id:'e1',value:edge('e1','a','b')},{id:'e2',value:edge('e2','b','a')}]});
  state=applyPatch(state,{nodes:[{id:'a',value:card('a',450)}],edges:[]});
  assert.equal(state.edges.length,2);assert.equal(state.nodes.find(n=>n.id==='a').x,450);
});
test('deleting a node removes orphan links',()=>{
  let state=applyPatch(EMPTY(),{nodes:[{id:'a',value:card('a')},{id:'b',value:card('b')}],edges:[]});
  state=applyPatch(state,{nodes:[],edges:[{id:'e',value:edge('e','a','b')}]});
  state=applyPatch(state,{nodes:[{id:'b',value:null}],edges:[]});
  assert.deepEqual(state.edges,[]);
});
test('diff roundtrip',()=>{
  const a=EMPTY(),b=applyPatch(a,{nodes:[{id:'a',value:card('a')}],edges:[]});
  const patch=diffBoard(a,b);assert.deepEqual(applyPatch(a,patch).nodes,b.nodes);
});
test('rejects a malformed oversized patch',()=>{
  assert.equal(cleanPatch({nodes:[{id:'x',value:card('x')}],edges:'bad'}),null);
  assert.equal(cleanPatch({nodes:Array.from({length:81},()=>({id:'x',value:card('x')})),edges:[]}),null);
});
const proposal=(state,patch)=>({baseRevision:state.revision,patch,base:{nodes:patch.nodes.map(op=>({id:op.id,value:state.nodes.find(n=>n.id===op.id)||null})),edges:patch.edges.map(op=>({id:op.id,value:state.edges.find(e=>e.id===op.id)||null}))}});
test('parallel independent edits survive an old revision',()=>{
  let state=applyPatch(EMPTY(),{nodes:[{id:'a',value:card('a')},{id:'b',value:card('b')}],edges:[]});
  const first=proposal(state,{nodes:[{id:'a',value:card('a',220)}],edges:[]});
  const second=proposal(state,{nodes:[{id:'b',value:card('b',420)}],edges:[]});
  state=checkProposal(state,first).next;
  state=checkProposal(state,second).next;
  assert.equal(state.nodes.find(x=>x.id==='a').x,220);
  assert.equal(state.nodes.find(x=>x.id==='b').x,420);
  assert.equal(state.revision,2);
});
test('same-object stale edit is rejected, never silently overwritten',()=>{
  const state=applyPatch(EMPTY(),{nodes:[{id:'a',value:card('a')}],edges:[]});
  const stale=proposal(state,{nodes:[{id:'a',value:card('a',300)}],edges:[]});
  const newer=checkProposal(state,proposal(state,{nodes:[{id:'a',value:card('a',200)}],edges:[]})).next;
  assert.throws(()=>checkProposal(newer,stale),/Конфликт/);
});
test('concurrent link creation prevents deletion that would erase it',()=>{
  const state=applyPatch(EMPTY(),{nodes:[{id:'a',value:card('a')},{id:'b',value:card('b')}],edges:[]});
  const deletion=proposal(state,{nodes:[{id:'a',value:null}],edges:[]});
  const linked=checkProposal(state,proposal(state,{nodes:[],edges:[{id:'e',value:edge('e','a','b')}]})).next;
  assert.throws(()=>checkProposal(linked,deletion),/Конфликт/);
});
test('protected card cannot be removed by player but accepts links',()=>{
  const locked={...card('a'),locked:true};
  const state=applyPatch(EMPTY(),{nodes:[{id:'a',value:locked},{id:'b',value:card('b')}],edges:[]});
  assert.throws(()=>checkProposal(state,proposal(state,{nodes:[{id:'a',value:null}],edges:[]})),/защищена/);
  assert.equal(checkProposal(state,proposal(state,{nodes:[],edges:[{id:'e',value:edge('e','b','a')}]})).next.edges.length,1);
});
test('import roundtrip rejects duplicate IDs, dangling links and unsafe photo',()=>{
  const state=cleanBoard({nodes:[card('a'),card('b')],edges:[edge('e','a','b')],revision:4});
  assert.deepEqual(cleanBoard(JSON.parse(JSON.stringify(state))),state);
  assert.throws(()=>cleanBoard({...state,nodes:[card('a'),card('a')]}),/ID/);
  assert.throws(()=>cleanBoard({...state,edges:[edge('e','a','missing')]}),/отсутствующей/);
  assert.equal(cleanNode({...card('a'),photo:'javascript:alert(1)'}).photo,'');
  assert.equal(cleanNode({...card('a'),photo:'data:image/svg+xml,<svg onload=alert(1)>'}).photo,'');
});
test('sender confirmation requires an exact locally pending operation',()=>{
  const op={opId:'operation1',authorId:'gm',patch:{nodes:[],edges:[]}};
  assert.equal(confirmsProposal(undefined,op),false);
  assert.equal(confirmsProposal(op,{...op,authorId:'forged'}),false);
  assert.equal(confirmsProposal(op,{...op,patch:{nodes:[{id:'x',value:null}],edges:[]}}),false);
  assert.equal(confirmsProposal(op,JSON.parse(JSON.stringify(op))),true);
});
