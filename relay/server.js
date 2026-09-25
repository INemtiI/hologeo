'use strict';
/* ===== ГОЛОГРАНЬ · ретранслятор «Общего экрана» =====
   Крошечный сервер без зависимостей: хранит последнее состояние сцены каждой
   комнаты и раздаёт его дисплеям через обычный HTTP (long-poll). Подходит любой
   хостинг, где запускается Node 18+.

   Запуск:        node relay/server.js            (порт 8081)
   Другой порт:   PORT=9000 node relay/server.js
   Затем добавьте к ссылке сайта:  ?relay=http://ваш-хост:8081

   Маршруты:
     GET  /ping                          — проверка доступности
     POST /room/:код/state               — ведущий публикует сцену (тело: JSON)
     GET  /room/:код/state?after=<ts>    — дисплей ждёт новую сцену (до ~1 с)
     POST /room/:код/viewers/:id         — присутствие дисплея {online: true|false}
     GET  /room/:код/viewers             — список живых дисплеев
*/
const http=require('http');
const PORT=+(process.env.PORT||8081);
const HOST=process.env.HOST||'0.0.0.0';
const ROOM_TTL=10*60*1000;      /* сколько жить пустой комнате */
const VIEWER_TTL=25*1000;       /* через сколько забывать дисплей без сигнала */
const LONGPOLL_MS=950;          /* макс. ожидание в long-poll */

const rooms=new Map();
function getRoom(code){
  let r=rooms.get(code);
  if(!r){r={state:null,waiters:[],viewers:new Map(),touched:Date.now()};rooms.set(code,r);}
  return r;
}
function safeCode(s){return (s||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12);}

const server=http.createServer((req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  let u;
  try{u=new URL(req.url,'http://localhost');}catch(err){res.writeHead(400);res.end('bad url');return;}
  const parts=u.pathname.split('/').filter(Boolean);

  if(parts[0]==='ping'){
    res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});
    res.end('ok');return;
  }

  if(parts[0]==='room'&&parts[1]){
    const r=getRoom(safeCode(parts[1]));
    r.touched=Date.now();

    /* --- сцена --- */
    if(parts[2]==='state'){
      if(req.method==='POST'){
        let body='';
        req.on('data',d=>{body+=d;if(body.length>262144)req.destroy();});
        req.on('end',()=>{
          let data=null;
          try{data=JSON.parse(body);}catch(err){data=null;}
          if(!data||data.type!=='scene-state'){res.writeHead(400);res.end('bad state');return;}
          r.state={ts:Date.now(),data};
          const waiters=r.waiters.splice(0);
          for(const w of waiters)w(r.state);
          res.writeHead(200,{'Content-Type':'application/json'});
          res.end(JSON.stringify(r.state));
        });
        return;
      }
      if(req.method==='GET'){
        const after=+u.searchParams.get('after')||0;
        const send=s=>{
          if(s){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(s));}
          else{res.writeHead(204);res.end();}
        };
        if(r.state&&r.state.ts>after){send(r.state);return;}
        let done=false;
        const waiter=s=>{if(done)return;done=true;clearTimeout(timer);send(s);};
        const timer=setTimeout(()=>waiter(null),LONGPOLL_MS);
        r.waiters.push(waiter);
        req.on('close',()=>{
          if(done)return;done=true;clearTimeout(timer);
          const i=r.waiters.indexOf(waiter);
          if(i>=0)r.waiters.splice(i,1);
        });
        return;
      }
    }

    /* --- присутствие дисплеев --- */
    if(parts[2]==='viewers'){
      if(req.method==='GET'){
        const now=Date.now();
        const ids=[];
        for(const[id,ts]of r.viewers)if(now-ts<VIEWER_TTL)ids.push(id);
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ids}));
        return;
      }
      if(req.method==='POST'&&parts[3]){
        let body='';
        req.on('data',d=>{body+=d;if(body.length>1024)req.destroy();});
        req.on('end',()=>{
          let online=true;
          try{online=JSON.parse(body||'{}').online!==false;}catch(err){}
          const id=String(parts[3]).slice(0,64);
          if(online)r.viewers.set(id,Date.now());else r.viewers.delete(id);
          res.writeHead(200,{'Content-Type':'text/plain'});
          res.end('ok');
        });
        return;
      }
    }
  }
  res.writeHead(404,{'Content-Type':'text/plain'});
  res.end('not found');
});

/* уборка: пустые комнаты и протухшие записи дисплеев */
setInterval(()=>{
  const now=Date.now();
  for(const[code,r]of rooms){
    for(const[id,ts]of r.viewers)if(now-ts>VIEWER_TTL)r.viewers.delete(id);
    if(now-r.touched>ROOM_TTL&&!r.waiters.length)rooms.delete(code);
  }
},60*1000).unref();

server.listen(PORT,HOST,()=>{
  console.log('[hologeo relay] http://'+HOST+':'+PORT+' — комнаты /room/<КОД>/state, проверка /ping');
});
