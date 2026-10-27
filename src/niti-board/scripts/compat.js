// getRandomValues also works on HTTP origins, where randomUUID/subtle may be absent.
export function operationId(api=globalThis.crypto){
  const bytes=new Uint8Array(16);
  if(api?.getRandomValues)api.getRandomValues(bytes);
  else for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);
  return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
}

// Foundry's query timeout does not cover a missing socket acknowledgement locally.
export function withDeadline(task,timeout=15000){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Нет ответа от GM или сервера. Проверь подключение и повтори действие.')),timeout);
    Promise.resolve().then(task).then(value=>{clearTimeout(timer);resolve(value)},error=>{clearTimeout(timer);reject(error)});
  });
}
