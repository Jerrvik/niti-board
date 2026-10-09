import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync('src/niti-board/ui/board.html','utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
if(scripts.length!==1)throw Error('Ожидался один встроенный скрипт доски');
new vm.Script(scripts[0][1],{filename:'src/niti-board/ui/board.html'});
console.log('Синтаксис встроенного скрипта доски проверен');
