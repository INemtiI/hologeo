'use strict';
/* ===== состояние, интерфейс, события ===== */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];

const S={
  fig:null,taskIndex:0,curPts:[],pts3:[],plane:null,trace:null,sec:{poly:[],raw:[],name:'—'},
  yaw:0,pitch:-1.08,zoom:1,autoRot:true,
  stepsOn:false,step:1,stepAnim:1,
  showSec:true,showVtx:true,showGrid:true,
  sel:null,anglePicks:[],angleMode:false,
  bodyStyle:{color:'#6ea8ff',alpha:0.13},
  faceStyle:{},
  extEdges:new Set(),extSection:false,
  picks:{verts:[],edges:[],faces:[]},
};
let dragging=false,lx=0,ly=0,moved=0,pinchD=0;
const pointers=new Map();

const viewCv=$('#viewCv'),vctx=viewCv.getContext('2d');
const holoCv=$('#holoCv'),off=document.createElement('canvas');
const tip=$('#tip');
const entityMenu=$('#entityMenu');
const entityMenuTitle=$('#entityMenuTitle');
const entityMenuBody=$('#entityMenuBody');
const dpr=Math.min(window.devicePixelRatio||1,2);

/* ---------- общий экран: ведущий управляет, подключённое устройство отображает ---------- */
/* Два транспорта на выбор, автоматически:
   1) РЕТРАНСЛЯТОР — маленький HTTP-сервер без зависимостей (relay/server.js). Обычные
      запросы, проходит через любые прокси; запускается вместе с сайтом или на своём хосте.
      Свой адрес: ?relay=http://хост:порт. В предпросмотре адрес определяется сам.
   2) MQTT через публичные брокеры (библиотека локальная, см. js/vendor) — запасной канал,
      если ретранслятор не задан/недоступен. Свой брокер: ?broker=wss://хост:порт/путь.   */
const MQTT_BROKERS=[
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt'
];
let BROKER_CONNECT_TIMEOUT=8000; /* сколько ждать ответа одного брокера */
const SYNC={client:null,clientId:'',role:null,room:'',brokerUrl:'',relayBase:'',transport:'',
            applying:false,lastSent:0,relayTs:0,pollMisses:0,pollAbort:null,relayFailed:false,
            leaving:false,reopening:false,viewers:new Set(),lastStateTs:0,staleNotified:false,
            liveConfirmed:false,relayTimers:[]};
function roomStatus(text,kind=''){
  const el=$('#roomStatus');
  if(el){el.textContent=text;el.className='room-status '+kind;}
  const chip=$('#displayChip');
  if(chip){chip.textContent=text;chip.dataset.kind=kind;}
}
function roomSupportError(){
  if(typeof fetch!=='function')return 'Браузер устарел и не поддерживает fetch — обновите его.';
  if(location.protocol==='file:')return 'Файл открыт с диска — браузер блокирует сетевые соединения. Откройте сайт по ссылке (через HTTPS).';
  return null;
}
/* --- адрес ретранслятора: параметр ?relay, иначе автоопределение для предпросмотра --- */
function relayBaseUrl(){
  const q=new URLSearchParams(location.search);
  const own=q.get('relay');
  if(own)return own.replace(/\/+$/,'');
  /* предпросмотр вида 8080-abc123.e2b.app → ретранслятор на 8081-abc123.e2b.app */
  const m=location.hostname.match(/^(\d+)-(.+)$/);
  if(m&&location.hostname.includes('.e2b.app'))return location.protocol+'//8081-'+m[2];
  if(location.hostname==='localhost'||location.hostname==='127.0.0.1'){
    return location.protocol+'//'+location.hostname+':8081';
  }
  return '';
}
async function detectRelay(){
  if(SYNC.relayFailed)return null;
  const base=relayBaseUrl();
  if(!base)return null;
  try{
    const ctl=new AbortController();
    const timer=setTimeout(()=>ctl.abort(),3500);
    const r=await fetch(base+'/ping',{signal:ctl.signal,cache:'no-store'});
    clearTimeout(timer);
    return r.ok?base:null;
  }catch(err){return null;}
}
function brokerChain(){
  const q=new URLSearchParams(location.search);
  const own=q.get('broker');
  return own?[own,...MQTT_BROKERS]:MQTT_BROKERS.slice();
}
function roomTopic(){return 'hologeo/'+SYNC.room;}
function sceneState(){
  return{
    type:'scene-state',ts:Date.now(),taskIndex:S.taskIndex,pts:S.curPts.map(p=>p.t),
    yaw:S.yaw,pitch:S.pitch,zoom:S.zoom,autoRot:S.autoRot,
    showSec:S.showSec,showVtx:S.showVtx,showGrid:S.showGrid,
    stepsOn:S.stepsOn,step:S.step,stepAnim:S.stepAnim,
    bodyStyle:S.bodyStyle,faceStyle:S.faceStyle,
    extEdges:[...S.extEdges],extSection:S.extSection,
    holo:$('#holoOv').classList.contains('on'),holoMir:$('#holoMir').checked
  };
}
function sendSceneState(force=false){
  if(SYNC.role!=='host'||SYNC.applying||!SYNC.room)return;
  const now=performance.now();
  if(!force&&now-SYNC.lastSent<70)return;
  if(SYNC.transport==='relay'){
    if(!SYNC.relayBase)return;
    SYNC.lastSent=now;
    fetch(SYNC.relayBase+'/room/'+SYNC.room+'/state',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(sceneState())
    }).then(r=>{
      if(!r.ok)throw new Error('relay '+r.status);
      SYNC.pollMisses=0;
    }).catch(()=>{
      if(SYNC.leaving)return;
      SYNC.pollMisses++;
      if(SYNC.pollMisses>=5){
        SYNC.relayFailed=true;
        roomStatus('Ретранслятор недоступен — переключаемся на резервный канал…');
        reopenChannel();
      }
    });
    return;
  }
  if(SYNC.transport==='mqtt'){
    if(!SYNC.client||!SYNC.client.connected)return;
    SYNC.lastSent=now;
    /* retain:true — дисплей, подключившийся позже, сразу получает последнюю сцену */
    try{SYNC.client.publish(roomTopic()+'/state',JSON.stringify(sceneState()),{qos:0,retain:true});}catch(err){}
  }
}
function scheduleSceneState(){sendSceneState();}
function reopenChannel(){
  if(SYNC.leaving||!SYNC.role||!SYNC.room)return;
  if(SYNC.client){try{SYNC.client.end(true);}catch(err){}SYNC.client=null;}
  stopRelayTimers();
  SYNC.transport='';
  SYNC.reopening=true;
  setTimeout(()=>{if(!SYNC.leaving)openChannel();},800);
}
function stopRelayTimers(){
  for(const t of SYNC.relayTimers){clearInterval(t);clearTimeout(t);}
  SYNC.relayTimers=[];
  if(SYNC.pollAbort){try{SYNC.pollAbort.abort();}catch(err){}SYNC.pollAbort=null;}
}
function setRoomUi(active){
  $('#roomCreate').disabled=active&&SYNC.role==='host';
  $('#roomJoin').disabled=active&&SYNC.role==='viewer';
  $('#roomCopy').disabled=!SYNC.room;
  $('#roomLeave').disabled=!active;
}

/* ---------- загрузка тел и задач ---------- */
function mkEdgePt(a,b,t){
  const ia=S.fig.labIdx[a],ib=S.fig.labIdx[b];
  const hint=t===0?'вершина '+a:(t===1?'вершина '+b:'ребро '+a+b);
  return{fn:tt=>lerp3(S.fig.verts[ia],S.fig.verts[ib],tt),t,hint};
}
function setFig(k){
  S.fig=buildFig(k);
  S.faceStyle={};S.extEdges.clear();S.extSection=false;S.sel=null;S.anglePicks=[];S.angleMode=false;
  $$('.fbtn').forEach(b=>b.classList.toggle('on',b.dataset.k===k));
  $('#cbVtx').disabled=!S.fig.labeled;
}
function loadTask(i){
  const t=TASKS[i];
  S.taskIndex=i;
  setFig(t.f);
  S.curPts=t.pts.map(p=>Array.isArray(p)?mkEdgePt(p[0],p[1],p[2]):{fn:p.fn,t:p.t,hint:p.hint});
  syncSliders();recompute();
  scheduleSceneState();
}
function syncSliders(){
  S.curPts.forEach((p,i)=>{
    $('#r'+i).value=Math.round(p.t*1000);
    $('#h'+i).textContent=p.hint;
    $('#v'+i).textContent=Math.round(p.t*100)+'%';
  });
}
function recompute(){
  S.pts3=S.curPts.map(p=>p.fn(p.t));
  S.plane=null;S.trace=null;S.sec={poly:[],raw:[],name:'—'};
  const n0=cross(sub(S.pts3[1],S.pts3[0]),sub(S.pts3[2],S.pts3[0]));
  if(len(n0)>1e-6){
    S.plane={n:nrm(n0)};S.plane.d=-dot(S.plane.n,S.pts3[0]);
    S.sec=S.fig.kind==='sph'?secSphere(S.fig,S.plane):secMesh(S.fig,S.plane);
    S.trace=mkTrace(S.plane);
  }
  S.pts3.forEach((p,i)=>{
    const c=$('#c'+i);if(c)c.textContent=['P','Q','R'][i]+' '+fmtC(p);
  });
  updSteps();updInspector();
}

/* ---------- панель измерений ---------- */
function updInspector(){
  $('#btnFace').disabled=!(S.sel&&S.sel.type==='face');
  $('#btnExtEdge').disabled=!(S.sel&&S.sel.type==='edge');
  if(S.sel&&S.sel.type==='edge'){
    const k=Math.min(S.sel.a,S.sel.b)+'_'+Math.max(S.sel.a,S.sel.b);
    $('#btnExtEdge').textContent=S.extEdges.has(k)?'✓ ребро продлено':'∞ Продлить ребро';
  }else $('#btnExtEdge').textContent='∞ Продлить ребро';
  $('#btnExtSec').textContent=S.extSection?'✓ Стороны сечения':'∞ Стороны сечения';
  updateAnglePanel();
}

/* ---------- шаги построения ---------- */
function stepText(){
  if(!S.plane)return'Точки вырождены — подвиньте ползунки.';
  switch(S.step){
    case 1:return'Шаг 1. Три точки P, Q, R задают секущую плоскость — она единственная.';
    case 2:return S.trace?'Шаг 2. Строим след плоскости на плоскости основания — прямую ℓ.':
                          'Шаг 2. Плоскость параллельна основанию — след отсутствует.';
    case 3:return S.fig.kind==='sph'?'Шаг 3. Плоскость пересекает сферу по окружности.':
                          `Шаг 3. Находим точки пересечения плоскости с рёбрами: ${S.sec.raw.length} шт.`;
    case 4:return S.sec.poly.length>=3?`Шаг 4. Соединяем точки в плоскости сечения — получаем: ${S.sec.name}.`:
                          'Плоскость почти не задевает тело — подвиньте точки.';
  }
}
function updSteps(){
  $('#stPrev').disabled=S.step<=1;$('#stNext').disabled=S.step>=4;
  $$('#stDots i').forEach((d,i)=>d.classList.toggle('on',i<S.step));
  $('#stTxt').textContent=stepText();
}
$('#stPrev').onclick=()=>{S.step=Math.max(1,S.step-1);updSteps();scheduleSceneState();};
$('#stNext').onclick=()=>{S.step=Math.min(4,S.step+1);if(S.step===4)S.stepAnim=0;updSteps();scheduleSceneState();};
$('#cbSteps').onchange=e=>{
  S.stepsOn=e.target.checked;
  $('#stepsBar').classList.toggle('on',S.stepsOn);
  S.step=1;S.stepAnim=0;updSteps();scheduleSceneState();
};
$('#cbSec').onchange=e=>{S.showSec=e.target.checked;scheduleSceneState();};
$('#cbVtx').onchange=e=>{S.showVtx=e.target.checked;scheduleSceneState();};
$('#cbGrid').onchange=e=>{S.showGrid=e.target.checked;scheduleSceneState();};
$('#cbAuto').onchange=e=>{S.autoRot=e.target.checked;scheduleSceneState();};

/* ---------- внешний вид ---------- */
$('#alpIn').oninput=e=>$('#alpVal').textContent=e.target.value+'%';
$('#btnFace').onclick=()=>{
  if(S.sel&&S.sel.type==='face'){
    S.faceStyle[S.sel.index]={color:$('#colIn').value,alpha:+$('#alpIn').value/100};
    updInspector();scheduleSceneState();
  }
};
$('#btnBody').onclick=()=>{
  S.bodyStyle={color:$('#colIn').value,alpha:+$('#alpIn').value/100};
  scheduleSceneState();
};
$('#btnExtEdge').onclick=()=>{
  if(S.sel&&S.sel.type==='edge'){
    const k=Math.min(S.sel.a,S.sel.b)+'_'+Math.max(S.sel.a,S.sel.b);
    S.extEdges.has(k)?S.extEdges.delete(k):S.extEdges.add(k);
    updInspector();scheduleSceneState();
  }
};
$('#btnExtSec').onclick=()=>{S.extSection=!S.extSection;updInspector();scheduleSceneState();};
$('#btnClear').onclick=()=>{
  S.faceStyle={};S.bodyStyle={color:'#6ea8ff',alpha:0.13};
  S.extEdges.clear();S.extSection=false;S.sel=null;S.anglePicks=[];
  updInspector();scheduleSceneState();
};

/* ---------- UI: тела, ползунки, задачи ---------- */
FIGKEYS.forEach(([k,n])=>{
  const b=document.createElement('button');
  b.className='fbtn';b.dataset.k=k;b.textContent=n;
  b.onclick=()=>{const i=TASKS.findIndex(t=>t.f===k);loadTask(i>=0?i:0);};
  $('#fGrid').appendChild(b);
});
['P','Q','R'].forEach((nm,i)=>{
  const row=document.createElement('div');row.className='pt-row';
  row.innerHTML=`<b>${nm}</b><input type="range" id="r${i}" min="0" max="1000" value="500"><span class="val" id="v${i}">50%</span><small id="h${i}"></small><small class="coord" id="c${i}"></small>`;
  $('#ptRows').appendChild(row);
  row.querySelector('input').addEventListener('input',e=>{
    S.curPts[i].t=e.target.value/1000;
    $('#v'+i).textContent=Math.round(S.curPts[i].t*100)+'%';
    recompute();
    scheduleSceneState();
  });
});
$('#taskGrid').innerHTML=TASKS.map((t,i)=>`
  <article class="tcard rev" data-i="${i}">
    <span class="ghost">${String(i+1).padStart(2,'0')}</span>
    <div class="chips"><span class="chip">${buildFig(t.f).name}</span><span class="chip dim">3 точки</span></div>
    <h3>${t.title}</h3><p>${t.text}</p>
    <button class="btn sm">Открыть в симуляторе →</button>
  </article>`).join('');
$('#taskGrid').addEventListener('click',e=>{
  const c=e.target.closest('.tcard');if(!c)return;
  loadTask(+c.dataset.i);
  document.getElementById('sim').scrollIntoView({behavior:'smooth'});
  const vp=$('#viewport');vp.classList.add('flash');setTimeout(()=>vp.classList.remove('flash'),900);
});

/* ---------- клавиатура ---------- */
addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT')return;
  if(e.key==='Escape'){S.sel=null;hideEntityMenu();updInspector();closeHolo();}
  if(e.key==='r'||e.key==='к'){S.yaw=0;S.pitch=-1.08;S.zoom=1;scheduleSceneState();}
  if(e.key==='g'||e.key==='п'){S.showGrid=!S.showGrid;$('#cbGrid').checked=S.showGrid;scheduleSceneState();}
});

/* ---------- управление мышью / касанием ---------- */
const pinchDist=()=>{
  const p=[...pointers.values()];
  return Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
};
viewCv.addEventListener('pointerdown',e=>{
  /* Правая кнопка нужна контекстному меню, а не вращению сцены. */
  if(e.button!==0&&e.pointerType==='mouse')return;
  hideEntityMenu();
  viewCv.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pointers.size===1){
    dragging=true;lx=e.clientX;ly=e.clientY;moved=0;
    S.autoRot=false;$('#cbAuto').checked=false;
  }else if(pointers.size===2){dragging=false;pinchD=pinchDist();}
});
viewCv.addEventListener('pointermove',e=>{
  if(pointers.has(e.pointerId))pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pointers.size===2){
    const d=pinchDist();
    if(pinchD)S.zoom=clamp(S.zoom*d/pinchD,0.4,4);
    pinchD=d;return;
  }
  if(dragging){
    const dx=e.clientX-lx,dy=e.clientY-ly;
    moved+=Math.abs(dx)+Math.abs(dy);
    S.yaw+=dx*0.006;
    S.pitch=clamp(S.pitch-dy*0.005,-1.56,1.56);
    lx=e.clientX;ly=e.clientY;
    scheduleSceneState();
  }else hoverAt(e);
});
const endPointer=e=>{
  pointers.delete(e.pointerId);
  if(pointers.size<2)pinchD=0;
  if(dragging&&pointers.size===0){
    dragging=false;
    if(moved<6&&e.button===0)handleClick(e);
  }
};
viewCv.addEventListener('pointerup',endPointer);
viewCv.addEventListener('pointercancel',endPointer);
viewCv.addEventListener('wheel',e=>{
  e.preventDefault();
  S.zoom=clamp(S.zoom*Math.exp(-e.deltaY*0.0012),0.4,4);
  scheduleSceneState();
},{passive:false});
viewCv.addEventListener('dblclick',()=>{S.sel=null;updInspector();});
viewCv.addEventListener('pointerleave',()=>{tip.style.display='none';});

function hoverAt(e){
  const r=viewCv.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
  let best=null,bd=11;
  for(const v of S.picks.verts){const d=Math.hypot(v.x-x,v.y-y);if(d<bd){bd=d;best=v;}}
  if(best){
    const lb=S.fig.labeled?S.fig.labels[best.idx]:('v'+best.idx);
    tip.textContent=lb+' '+fmtC(S.fig.verts[best.idx]);
    tip.style.display='block';
    tip.style.left=(best.x+14)+'px';tip.style.top=(best.y-10)+'px';
    viewCv.style.cursor='pointer';
  }else{
    tip.style.display='none';
    viewCv.style.cursor='grab';
  }
}
function pickAt(x,y){
  let best=null,bd=11;
  for(const v of S.picks.verts){const d=Math.hypot(v.x-x,v.y-y);if(d<bd){bd=d;best={type:'vertex',index:v.idx};}}
  if(best)return best;
  bd=7;let be=null;
  for(const e of S.picks.edges){const d=ptSegDist(x,y,e.x1,e.y1,e.x2,e.y2);if(d<bd){bd=d;be=e;}}
  if(be)return{type:'edge',a:be.a,b:be.b};
  const faces=[...S.picks.faces].sort((a,b)=>a.d-b.d);
  for(const f of faces)if(pointInPoly(x,y,f.poly))return{type:'face',index:f.idx};
  return null;
}
function anglePickKey(p){
  if(p.type==='edge')return'edge:'+Math.min(p.a,p.b)+'_'+Math.max(p.a,p.b);
  return'face:'+p.index;
}
function edgeDirection(a,b){
  const common=[a.a,a.b].find(v=>v===b.a||v===b.b);
  if(common!==undefined){
    const ao=a.a===common?a.b:a.a;
    const bo=b.a===common?b.b:b.a;
    return[sub(S.fig.verts[ao],S.fig.verts[common]),sub(S.fig.verts[bo],S.fig.verts[common])];
  }
  return[sub(S.fig.verts[a.b],S.fig.verts[a.a]),sub(S.fig.verts[b.b],S.fig.verts[b.a])];
}
function degrees(rad){return rad*180/Math.PI}
function angleResult(){
  if(S.anglePicks.length<2)return null;
  const[a,b]=S.anglePicks;
  if(a.type==='edge'&&b.type==='edge'){
    const[v1,v2]=edgeDirection(a,b);
    return{title:'Плоский угол',value:degrees(Math.acos(clamp(dot(nrm(v1),nrm(v2)),-1,1))),detail:'между двумя рёбрами'};
  }
  if(a.type==='face'&&b.type==='face'){
    const normal=degrees(Math.acos(clamp(dot(S.fig.fn[a.index],S.fig.fn[b.index]),-1,1)));
    return{title:'Двугранный угол',value:180-normal,detail:'внутренний угол между гранями'};
  }
  return{title:'Несовместимый выбор',value:null,detail:'выберите два ребра или две грани одного типа'};
}
function updateAnglePanel(){
  const btn=$('#angleMode'),hint=$('#angleHint'),out=$('#angleValue');
  if(!btn||!hint||!out)return;
  btn.classList.toggle('on',S.angleMode);
  btn.textContent=S.angleMode?'Завершить выбор':'Измерить угол';
  const result=angleResult();
  if(!S.anglePicks.length){
    hint.textContent='Выберите два ребра для плоского угла или две грани для двугранного.';
    out.textContent='—';
  }else if(!result){
    hint.textContent='Выберите второй объект такого же типа.';
    out.textContent='Выбрано: '+entityName(S.anglePicks[0]);
  }else if(result.value===null){
    hint.textContent=result.detail;
    out.textContent='—';
  }else{
    hint.textContent=result.detail;
    out.innerHTML='<b>'+result.title+'</b><strong>'+fmt(result.value)+'°</strong>';
  }
}
function handleClick(e){
  const r=viewCv.getBoundingClientRect();
  const p=pickAt(e.clientX-r.left,e.clientY-r.top);
  if(S.angleMode){
    if(p&&(p.type==='edge'||p.type==='face')){
      const key=anglePickKey(p);
      if(!S.anglePicks.some(q=>anglePickKey(q)===key))S.anglePicks.push(p);
      S.sel=p;
      if(S.anglePicks.length>=2)S.angleMode=false;
      updInspector();
    }
    return;
  }
  S.sel=p;
  updInspector();
}
$('#angleMode').onclick=()=>{
  S.angleMode=!S.angleMode;
  if(S.angleMode)S.anglePicks=[];
  updateAnglePanel();
};
$('#angleClear').onclick=()=>{S.angleMode=false;S.anglePicks=[];updateAnglePanel();};

/* ---------- контекстная информация по точке, ребру или грани ---------- */
function entityName(entity){
  const f=S.fig;
  if(entity.type==='vertex')return f.labeled?f.labels[entity.index]:'v'+entity.index;
  if(entity.type==='edge'){
    const a=f.labeled?f.labels[entity.a]:'v'+entity.a;
    const b=f.labeled?f.labels[entity.b]:'v'+entity.b;
    return a+b;
  }
  if(entity.type==='face'){
    const ids=f.faces[entity.index];
    return f.labeled?ids.map(i=>f.labels[i]).join(''):'грань №'+(entity.index+1);
  }
  return 'объект';
}
function showEntityMenu(entity,x,y){
  if(!entity){hideEntityMenu();return;}
  const f=S.fig,name=entityName(entity);
  S.sel=entity;
  updInspector();
  entityMenuTitle.textContent=name+' · '+({vertex:'точка',edge:'ребро',face:'грань'}[entity.type]||'объект');
  if(entity.type==='vertex'){
    entityMenuBody.innerHTML='<strong>Координаты</strong><br><span class="menu-value">'+fmtC(f.verts[entity.index])+'</span>';
  }else if(entity.type==='edge'){
    const a=f.verts[entity.a],b=f.verts[entity.b];
    entityMenuBody.innerHTML='<strong>Длина ребра</strong><br><span class="menu-value">|'+name+'| = '+fmt(len(sub(b,a)))+'</span>';
  }else if(entity.type==='face'){
    const pts=f.faces[entity.index].map(i=>f.verts[i]);
    entityMenuBody.innerHTML='<strong>Площадь грани</strong><br><span class="menu-value">S = '+fmt(polyArea3D(pts))+'</span>';
  }
  entityMenu.hidden=false;
  /* Сначала ставим карточку рядом с курсором, затем не даём ей уйти за экран. */
  const gap=12,rect=entityMenu.getBoundingClientRect();
  const left=x+gap+rect.width>innerWidth?x-rect.width-gap:x+gap;
  const top=y+gap+rect.height>innerHeight?y-rect.height-gap:y+gap;
  entityMenu.style.left=Math.max(8,Math.min(left,innerWidth-rect.width-8))+'px';
  entityMenu.style.top=Math.max(8,Math.min(top,innerHeight-rect.height-8))+'px';
}
function hideEntityMenu(){
  if(entityMenu)entityMenu.hidden=true;
}
viewCv.addEventListener('contextmenu',e=>{
  e.preventDefault();
  const r=viewCv.getBoundingClientRect();
  const entity=pickAt(e.clientX-r.left,e.clientY-r.top);
  if(entity)showEntityMenu(entity,e.clientX,e.clientY);
  else{
    hideEntityMenu();
    S.sel=null;
    updInspector();
  }
});
document.addEventListener('pointerdown',e=>{
  if(entityMenu&&!entityMenu.contains(e.target)&&e.target!==viewCv)hideEntityMenu();
});

/* ---------- полноэкранное окно демонстрации ---------- */
const stageFull=$('#stageFull');
function syncFullscreenButton(){
  const active=document.fullscreenElement=== $('#viewport') || $('#viewport').classList.contains('fullscreen-fallback');
  stageFull.textContent=active?'⤢':'⛶';
  stageFull.title=active?'Выйти из полноэкранного режима':'Развернуть демонстрацию на весь экран';
}
async function toggleStageFullscreen(){
  const stage=$('#viewport');
  try{
    if(document.fullscreenElement)await document.exitFullscreen();
    else if(stage.requestFullscreen)await stage.requestFullscreen();
    else throw new Error('fullscreen is not supported');
  }catch(err){
    stage.classList.toggle('fullscreen-fallback');
    document.body.classList.toggle('stage-is-fullscreen',stage.classList.contains('fullscreen-fallback'));
    syncFullscreenButton();
  }
}
stageFull.onclick=toggleStageFullscreen;
document.addEventListener('fullscreenchange',syncFullscreenButton);

/* ---------- комнаты общего экрана ---------- */
const ROOM_PREFIX='hologeo-';
const roomAlphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomRoomCode(){
  return Array.from({length:6},()=>roomAlphabet[Math.floor(Math.random()*roomAlphabet.length)]).join('');
}
function normalizeRoomCode(v){return (v||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');}
function roomLink(){
  const url=new URL(location.href);
  url.searchParams.set('room',SYNC.room);
  url.searchParams.set('mode','display');
  if(SYNC.transport==='mqtt'&&SYNC.brokerUrl)url.searchParams.set('broker',SYNC.brokerUrl);
  if(SYNC.transport==='relay'&&SYNC.relayBase)url.searchParams.set('relay',SYNC.relayBase);
  url.hash='sim';
  return url.toString();
}
function drawRoomQr(){
  const qr=$('#roomQr');
  if(!SYNC.room||SYNC.role!=='host'){qr.hidden=true;return;}
  if(!window.qrcode){qr.hidden=true;return;}
  try{
    const m=window.qrcode(0,'M');
    m.addData(roomLink());m.make();
    const n=m.getModuleCount(),pad=2,total=n+pad*2;
    const px=Math.max(2,Math.floor(156/total));
    qr.width=px*total;qr.height=px*total;
    const ctx=qr.getContext('2d');
    ctx.fillStyle='#dffaff';ctx.fillRect(0,0,qr.width,qr.height);
    ctx.fillStyle='#081120';
    for(let r=0;r<n;r++)for(let c=0;c<n;c++){
      if(m.isDark(r,c))ctx.fillRect((c+pad)*px,(r+pad)*px,px,px);
    }
    qr.hidden=false;
  }catch(err){qr.hidden=true;}
}
/* Подключение к брокерам по очереди, пока один не ответит. */
function connectMqtt(onOpen){
  const chain=brokerChain();
  const clientId=SYNC.clientId||('hologeo_'+Math.random().toString(16).slice(2,10));
  SYNC.clientId=clientId;
  let idx=0;
  const tryNext=()=>{
    if(SYNC.leaving)return;
    if(idx>=chain.length){
      roomStatus('Не удалось подключиться ни к одному серверу связи. Проверьте интернет — пробуем ещё раз…','error');
      SYNC.reopening=true;
      setTimeout(()=>{if(!SYNC.leaving&&SYNC.role&&!SYNC.client)openChannel();},10000);
      return;
    }
    const url=chain[idx++];
    SYNC.brokerUrl=url;
    roomStatus((SYNC.reopening?'Переподключение':'Подключение')+' к серверу связи '+(idx)+'/'+chain.length+'…');
    const opts={clientId,clean:true,connectTimeout:BROKER_CONNECT_TIMEOUT,reconnectPeriod:0,keepalive:30};
    /* Если дисплей оборвётся без «Выйти», брокер сам снимет его с учёта (last will). */
    if(SYNC.role==='viewer'&&SYNC.room){
      opts.will={topic:roomTopic()+'/viewers/'+clientId,payload:'',qos:0,retain:true};
    }
    let client;
    try{
      client=window.mqtt.connect(url,opts);
    }catch(err){tryNext();return;}
    let settled=false;
    const giveUp=setTimeout(()=>{
      if(settled)return;settled=true;
      try{client.end(true);}catch(err){}
      tryNext();
    },BROKER_CONNECT_TIMEOUT+1500);
    /* если брокер быстро ответил отказом (или сеть сбросила соединение) —
       не ждём таймаута, сразу пробуем следующий */
    const failover=()=>{
      if(settled)return;settled=true;clearTimeout(giveUp);
      try{client.end(true);}catch(err){}
      tryNext();
    };
    client.on('error',failover);
    client.on('offline',failover);
    client.on('connect',()=>{
      if(settled)return;settled=true;clearTimeout(giveUp);
      if(SYNC.leaving){try{client.end(true);}catch(err){}return;}
      SYNC.client=client;
      /* при обрыве связи пробуем заново (с перебором брокеров) */
      client.on('close',()=>{
        if(SYNC.leaving||SYNC.client!==client)return;
        SYNC.reopening=true;
        try{client.end(true);}catch(err){}
        SYNC.client=null;
        setTimeout(()=>{if(!SYNC.leaving)openChannel();},1200);
      });
      onOpen(client);
    });
  };
  tryNext();
}
function onMqttMessage(topic,payload){
  if(SYNC.leaving||!SYNC.room)return;
  const text=typeof payload==='string'?payload:String(payload);
  if(SYNC.role==='host'&&topic.indexOf(roomTopic()+'/viewers/')===0){
    const id=topic.slice(topic.lastIndexOf('/')+1);
    if(text==='1')SYNC.viewers.add(id);else SYNC.viewers.delete(id);
    hostConnectedStatus();
    return;
  }
  if(SYNC.role==='viewer'&&topic===roomTopic()+'/state'){
    let data=null;
    try{data=JSON.parse(text);}catch(err){return;}
    if(!data||data.type!=='scene-state')return;
    SYNC.lastStateTs=Date.now();
    if(SYNC.staleNotified){SYNC.staleNotified=false;roomStatus('Подключено · '+channelLabel()+' · устройство повторяет сцену ведущего.','ready');}
    applySceneState(data);
    if(!SYNC.liveConfirmed){SYNC.liveConfirmed=true;roomStatus('Подключено · '+channelLabel()+' · устройство повторяет сцену ведущего.','ready');}
  }
}
function channelLabel(){
  return SYNC.transport==='relay'?'ретранслятор':(SYNC.transport==='mqtt'?'MQTT-брокер':'канал');
}
function hostConnectedStatus(){
  const n=SYNC.viewers.size;
  roomStatus(n
    ?'Дисплеев подключено: '+n+' · '+channelLabel()+' · изображение синхронизируется.'
    :'Код '+SYNC.room+' · '+channelLabel()+' · ожидаем подключение дисплея…','ready');
}
function publishPresence(online){
  if(!SYNC.client||!SYNC.client.connected)return;
  try{
    SYNC.client.publish(roomTopic()+'/viewers/'+SYNC.clientId,online?'1':'',{qos:0,retain:true});
  }catch(err){}
}
/* ---------- канал через ретранслятор (обычный HTTP, без WebSocket) ---------- */
function openRelayChannel(base){
  SYNC.transport='relay';SYNC.relayBase=base;SYNC.pollMisses=0;SYNC.relayTs=0;
  if(SYNC.role==='host'){
    hostConnectedStatus();
    drawRoomQr();
    sendSceneState(true);
    const t=setInterval(()=>{ /* счётчик дисплеев */
      if(SYNC.leaving||SYNC.transport!=='relay')return;
      fetch(SYNC.relayBase+'/room/'+SYNC.room+'/viewers',{cache:'no-store'})
        .then(r=>r.ok?r.json():null)
        .then(j=>{
          if(!j||SYNC.leaving||SYNC.transport!=='relay')return;
          SYNC.viewers=new Set(j.ids||[]);
          hostConnectedStatus();
        }).catch(()=>{});
    },2500);
    SYNC.relayTimers.push(t);
  }else{
    roomStatus('Подключено · '+channelLabel()+' · ожидание сцены от ведущего…','ready');
    requestDisplayFullscreen();
    relayViewerPoll();
    /* присутствие: отметка раз в 8 с; молчащих сервер забывает сам */
    const beat=()=>{
      if(SYNC.leaving||SYNC.transport!=='relay')return;
      fetch(SYNC.relayBase+'/room/'+SYNC.room+'/viewers/'+SYNC.clientId,{
        method:'POST',headers:{'Content-Type':'application/json'},body:'{"online":true}'
      }).catch(()=>{});
    };
    beat();
    SYNC.relayTimers.push(setInterval(beat,8000));
  }
  SYNC.reopening=false;
  SYNC.lastStateTs=Date.now();
}
function relayViewerPoll(){
  if(SYNC.leaving||SYNC.transport!=='relay')return;
  const ctl=new AbortController();
  SYNC.pollAbort=ctl;
  fetch(SYNC.relayBase+'/room/'+SYNC.room+'/state?after='+SYNC.relayTs,{signal:ctl.signal,cache:'no-store'})
    .then(async r=>{
      if(SYNC.leaving||SYNC.transport!=='relay')return;
      if(r.status===204){relayViewerPoll();return;}
      if(!r.ok)throw new Error('relay '+r.status);
      const s=await r.json();
      if(s&&s.ts&&s.data){
        SYNC.relayTs=s.ts;
        SYNC.lastStateTs=Date.now();
        if(SYNC.staleNotified){SYNC.staleNotified=false;roomStatus('Подключено · '+channelLabel()+' · устройство повторяет сцену ведущего.','ready');}
        applySceneState(s.data);
        if(!SYNC.liveConfirmed){SYNC.liveConfirmed=true;roomStatus('Подключено · '+channelLabel()+' · устройство повторяет сцену ведущего.','ready');}
      }
      relayViewerPoll();
    })
    .catch(err=>{
      if(SYNC.leaving||SYNC.transport!=='relay')return;
      if(err&&err.name==='AbortError')return;
      SYNC.pollMisses++;
      if(SYNC.pollMisses>=4){
        SYNC.relayFailed=true;
        roomStatus('Ретранслятор недоступен — переключаемся на резервный канал…');
        reopenChannel();
        return;
      }
      setTimeout(relayViewerPoll,800);
    });
}
/* Сначала пробуем ретранслятор, затем запасной MQTT-канал. */
async function openChannel(){
  if(SYNC.leaving)return;
  const relay=await detectRelay();
  if(SYNC.leaving)return;
  if(relay){openRelayChannel(relay);return;}
  openMqttChannel();
}
function openMqttChannel(){
  connectMqtt(client=>{
    SYNC.transport='mqtt';
    client.on('message',onMqttMessage);
    if(SYNC.role==='host'){
      client.subscribe(roomTopic()+'/viewers/#',{qos:0});
      hostConnectedStatus();
      drawRoomQr();
      sendSceneState(true);
    }else{
      client.subscribe(roomTopic()+'/state',{qos:0});
      publishPresence(true);
      roomStatus('Подключено · '+channelLabel()+' · ожидание сцены от ведущего…','ready');
      requestDisplayFullscreen();
    }
    SYNC.reopening=false;
    SYNC.lastStateTs=Date.now();
  });
}
function closeRoom(silent=false){
  SYNC.leaving=true;SYNC.reopening=false;
  stopRelayTimers();
  if(SYNC.transport==='relay'&&SYNC.relayBase&&SYNC.role==='viewer'&&SYNC.room&&SYNC.clientId){
    /* снять присутствие; при обрыве сервер забудет дисплей сам по таймауту */
    try{
      fetch(SYNC.relayBase+'/room/'+SYNC.room+'/viewers/'+SYNC.clientId,{
        method:'POST',headers:{'Content-Type':'application/json'},body:'{"online":false}'
      }).catch(()=>{});
    }catch(err){}
  }
  if(SYNC.role==='viewer'&&SYNC.room&&SYNC.clientId)publishPresence(false);
  if(SYNC.role==='host'&&SYNC.room&&SYNC.client&&SYNC.client.connected){
    /* стереть «запомненную» сцену, чтобы поздние дисплеи не видели призрак комнаты */
    try{SYNC.client.publish(roomTopic()+'/state','',{qos:0,retain:true});}catch(err){}
  }
  if(SYNC.client){try{SYNC.client.end(false);}catch(err){try{SYNC.client.end(true);}catch(e){}}}
  SYNC.client=null;SYNC.role=null;SYNC.room='';SYNC.brokerUrl='';SYNC.relayBase='';SYNC.transport='';
  SYNC.viewers.clear();SYNC.lastStateTs=0;SYNC.staleNotified=false;SYNC.liveConfirmed=false;
  $('#roomQr').hidden=true;setRoomUi(false);
  if(!silent)roomStatus('Комната не создана');
}
function createRoom(){
  const supportErr=roomSupportError();
  if(supportErr){roomStatus(supportErr,'error');return;}
  closeRoom(true);
  SYNC.leaving=false;SYNC.reopening=false;SYNC.relayFailed=false;
  SYNC.role='host';SYNC.room=randomRoomCode();
  SYNC.clientId=ROOM_PREFIX.toLowerCase()+Math.random().toString(16).slice(2,10);
  $('#roomCode').value=SYNC.room;setRoomUi(true);
  roomStatus('Создаём комнату…');
  openChannel();
}
function joinRoom(){
  const supportErr=roomSupportError();
  if(supportErr){roomStatus(supportErr,'error');return;}
  const code=normalizeRoomCode($('#roomCode').value);
  if(code.length<4){roomStatus('Введите код комнаты (6 символов).','error');return;}
  closeRoom(true);
  SYNC.leaving=false;SYNC.reopening=false;SYNC.relayFailed=false;
  SYNC.role='viewer';SYNC.room=code;
  SYNC.clientId=ROOM_PREFIX.toLowerCase()+Math.random().toString(16).slice(2,10);
  $('#roomCode').value=code;setRoomUi(true);
  roomStatus('Подключаемся к '+code+'…');
  openChannel();
}
function applySceneState(state){
  if(!state||SYNC.role!=='viewer')return;
  SYNC.applying=true;
  if(Number.isInteger(state.taskIndex)&&TASKS[state.taskIndex]&&state.taskIndex!==S.taskIndex)loadTask(state.taskIndex);
  if(Array.isArray(state.pts))S.curPts.forEach((p,i)=>{if(state.pts[i]!==undefined)p.t=state.pts[i];});
  syncSliders();recompute();
  S.yaw=Number.isFinite(state.yaw)?state.yaw:S.yaw;
  S.pitch=Number.isFinite(state.pitch)?state.pitch:S.pitch;
  S.zoom=Number.isFinite(state.zoom)?state.zoom:S.zoom;
  S.showSec=state.showSec!==false;S.showVtx=state.showVtx!==false;S.showGrid=state.showGrid!==false;
  S.stepsOn=!!state.stepsOn;S.step=state.step||1;S.stepAnim=state.stepAnim||1;
  S.bodyStyle=state.bodyStyle||S.bodyStyle;S.faceStyle=state.faceStyle||{};
  S.extEdges=new Set(state.extEdges||[]);S.extSection=!!state.extSection;
  /* Дисплей не вращает сцену сам — ракурс непрерывно присылает ведущий. */
  S.autoRot=false;
  $('#cbSec').checked=S.showSec;$('#cbVtx').checked=S.showVtx;$('#cbGrid').checked=S.showGrid;
  $('#cbAuto').checked=false;$('#cbSteps').checked=S.stepsOn;
  $('#stepsBar').classList.toggle('on',S.stepsOn);updSteps();updInspector();
  /* Режим «Голограмма» синхронизируется: дисплей под пирамидой показывает 4 проекции. */
  const ov=$('#holoOv'),holoOn=!!state.holo;
  if(ov.classList.contains('on')!==holoOn){
    ov.classList.toggle('on',holoOn);
    document.body.style.overflow=holoOn?'hidden':'';
  }
  $('#holoMir').checked=!!state.holoMir;
  SYNC.applying=false;
}
/* Сторожок: дисплей замечает, что ведущий пропал. */
function roomWatchdogTick(){
  if(SYNC.leaving||!SYNC.role||!SYNC.room)return;
  if(SYNC.role==='viewer'){
    if(SYNC.liveConfirmed&&SYNC.lastStateTs&&Date.now()-SYNC.lastStateTs>9000&&!SYNC.staleNotified){
      SYNC.staleNotified=true;
      roomStatus('Ведущий не отправляет сцену. Проверьте, что у него открыта комната.','error');
    }
  }
}
setInterval(roomWatchdogTick,3000);
$('#roomCreate').onclick=()=>createRoom();
$('#roomJoin').onclick=()=>joinRoom();
$('#roomLeave').onclick=()=>closeRoom();
$('#roomCopy').onclick=async()=>{
  if(!SYNC.room)return;
  try{await navigator.clipboard.writeText(roomLink());roomStatus('Ссылка дисплея скопирована.','ready');}
  catch(err){roomStatus('Скопируйте код комнаты: '+SYNC.room,'ready');}
};
$('#roomCode').addEventListener('input',e=>{e.target.value=normalizeRoomCode(e.target.value);});

/* Устройство-дисплей (?mode=display из ссылки/QR): только сцена, без панелей. */
const urlRoomParams=new URLSearchParams(location.search);
const isDisplayMode=urlRoomParams.get('mode')==='display';
if(isDisplayMode){
  document.body.classList.add('display-mode');
  const chip=document.createElement('div');
  chip.id='displayChip';chip.textContent='Ожидание ведущего…';
  document.body.appendChild(chip);
  /* Полноэкранный режим браузеры разрешают только по жесту пользователя. */
  document.addEventListener('pointerdown',requestDisplayFullscreen);
}
function requestDisplayFullscreen(){
  if(!isDisplayMode||document.fullscreenElement)return;
  const vp=$('#viewport');
  if(vp&&vp.requestFullscreen)vp.requestFullscreen().catch(()=>{});
}
const urlRoom=urlRoomParams.get('room');
if(urlRoom){$('#roomCode').value=normalizeRoomCode(urlRoom).slice(0,6);setTimeout(joinRoom,350);}

/* ---------- главный цикл ---------- */
let last=performance.now();
function drawMain(){
  const r=viewCv.getBoundingClientRect();
  if(viewCv.width!==(r.width*dpr|0)||viewCv.height!==(r.height*dpr|0)){
    viewCv.width=r.width*dpr;viewCv.height=r.height*dpr;
  }
  vctx.setTransform(dpr,0,0,dpr,0,0);
  const s=Math.min(r.width,r.height)*0.34/S.fig.R*S.zoom;
  renderScene(vctx,r.width,r.height,{
    yaw:S.yaw,pitch:S.pitch,cx:r.width/2,cy:r.height/2+8,scale:s,
    holo:false,fig:S.fig,st:S,picksOut:S.picks
  });
}
let holoSize=0;
function drawHolo(){
  const S2=Math.max(240,Math.min(innerWidth,innerHeight)-96);
  if(holoSize!==S2){holoSize=S2;holoCv.width=S2*dpr;holoCv.height=S2*dpr;holoCv.style.width=S2+'px';holoCv.style.height=S2+'px';}
  const ctx=holoCv.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.fillStyle='#000';ctx.fillRect(0,0,S2,S2);
  const q=S2/2;
  if(off.width!==(q*dpr|0)){off.width=q*dpr;off.height=q*dpr;}
  const oc=off.getContext('2d');
  for(let k=0;k<4;k++){
    oc.setTransform(dpr,0,0,dpr,0,0);oc.clearRect(0,0,q,q);
    renderScene(oc,q,q,{
      yaw:S.yaw+k*Math.PI/2,pitch:0.5,cx:q/2,cy:q*0.52,scale:q*0.24/S.fig.R,
      holo:true,fig:S.fig,st:S,picksOut:null
    });
    ctx.save();ctx.translate(S2/2,S2/2);ctx.rotate(k*Math.PI/2);
    if($('#holoMir').checked)ctx.scale(-1,1);
    ctx.drawImage(off,0,0,q*dpr,q*dpr,-q/2,-q,q,q);
    ctx.restore();
  }
  ctx.strokeStyle='rgba(95,230,255,.25)';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(S2/2,0);ctx.lineTo(S2/2,S2);ctx.moveTo(0,S2/2);ctx.lineTo(S2,S2/2);ctx.stroke();
  ctx.beginPath();ctx.arc(S2/2,S2/2,8,0,TAU);ctx.stroke();
}
function loop(now){
  const dt=Math.min(.05,(now-last)/1000);last=now;
  if(S.autoRot&&!dragging)S.yaw+=dt*0.35;
  if(SYNC.role==='host'&&now-SYNC.lastSent>120)sendSceneState(true);
  if(S.stepsOn&&S.step===4&&S.stepAnim<1)S.stepAnim=Math.min(1,S.stepAnim+dt*1.1);
  if($('#holoOv').classList.contains('on'))drawHolo();else drawMain();
  requestAnimationFrame(loop);
}

/* ---------- голограмма ---------- */
const sel=$('#holoFig');
FIGKEYS.forEach(([k,n])=>{const o=document.createElement('option');o.value=k;o.textContent=n;sel.appendChild(o);});
sel.onchange=()=>{const i=TASKS.findIndex(t=>t.f===sel.value);if(i>=0)loadTask(i);};
function openHolo(){$('#holoOv').classList.add('on');sel.value=S.fig.key;document.body.style.overflow='hidden';scheduleSceneState();}
function closeHolo(){$('#holoOv').classList.remove('on');document.body.style.overflow='';scheduleSceneState();}
$('#holoOpen').onclick=openHolo;$('#holoOpen2').onclick=openHolo;$('#holoOpen3').onclick=openHolo;
$('#holoClose').onclick=closeHolo;
$('#holoMir').onchange=()=>scheduleSceneState();

/* ---------- калькулятор пирамиды ---------- */
function calcPyr(){
  const a=+$('#inA').value||170,b=Math.min(+$('#inB').value||50,a-10);
  const h=(a-b)/2,L=h*Math.SQRT2;
  $('#outH').textContent=Math.round(h)+' мм';
  $('#outL').textContent=Math.round(L)+' мм';
  $('#outS').textContent='≈ '+(a/25.4).toFixed(1)+'″';
  const sc=Math.min(240/a,110/Math.max(h,1)),cx2=150,y0=150;
  const p=[[cx2-a*sc/2,y0],[cx2+a*sc/2,y0],[cx2+b*sc/2,y0-h*sc],[cx2-b*sc/2,y0-h*sc]];
  $('#pyrPrev').innerHTML=
    `<path d="M${p.map(q=>q.join(',')).join(' L ')} Z" fill="rgba(95,230,255,.08)" stroke="#5fe6ff" stroke-width="1.4"/>`+
    `<line x1="${cx2-a*sc/2}" y1="164" x2="${cx2+a*sc/2}" y2="164" stroke="#8ba3c4" stroke-width="1"/>`+
    `<text x="${cx2-14}" y="176" font-family="JetBrains Mono" font-size="10" fill="#2dd4bf">a=${a}</text>`+
    `<line x1="${cx2+b*sc/2}" y1="${y0-h*sc}" x2="${cx2-b*sc/2}" y2="${y0-h*sc}" stroke="#8ba3c4" stroke-width="1"/>`+
    `<text x="${cx2-12}" y="${y0-h*sc-6}" font-family="JetBrains Mono" font-size="10" fill="#2dd4bf">b=${b}</text>`+
    `<line x1="${cx2+a*sc/2+14}" y1="${y0}" x2="${cx2+a*sc/2+14}" y2="${y0-h*sc}" stroke="#8ba3c4" stroke-width="1"/>`+
    `<text x="${cx2+a*sc/2+19}" y="${y0-h*sc/2}" font-family="JetBrains Mono" font-size="10" fill="#2dd4bf">h=${Math.round(h)}</text>`+
    `<text x="12" y="20" font-family="JetBrains Mono" font-size="10" fill="#5fe6ff">ГРАНЬ · УГОЛ 45°</text>`;
}
$('#inA').oninput=calcPyr;$('#inB').oninput=calcPyr;
$('#dlTpl').onclick=()=>{
  const a=+$('#inA').value||170,b=Math.min(+$('#inB').value||50,a-10);
  const h=(a-b)/2,L=h*Math.SQRT2,pad=24;
  const W=a*2+pad*3,H=L*2+pad*3+34;
  const trap=(x,y)=>{
    const x1=x+(a-b)/2,x2=x+(a+b)/2;
    return `<path d="M${x},${y+L} L${x+a},${y+L} L${x2},${y} L${x1},${y} Z" fill="none" stroke="#c00" stroke-width="0.5"/>`+
           `<path d="M${x+a},${y+L} L${x2},${y} L${x2+9},${y+8} L${x+a+9},${y+L-8} Z" fill="none" stroke="#c00" stroke-width="0.3" stroke-dasharray="3 2"/>`;
  };
  const xs=[pad,pad*2+a],ys=[pad+30,pad*2+30+L];
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#fff"/>`;
  svg+=`<text x="${pad}" y="20" font-family="monospace" font-size="10" fill="#000">ГОЛОГРАНЬ · шаблон пирамиды · a=${a} b=${b} h=${Math.round(h)} L=${Math.round(L)} мм · угол 45° · печать в масштабе 100%</text>`;
  xs.forEach(x=>ys.forEach(y=>svg+=trap(x,y)));
  svg+='</svg>';
  const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
  const l=document.createElement('a');l.href=url;l.download='hologran-pyramid-template.svg';l.click();
  URL.revokeObjectURL(url);
};

/* ---------- чек-лист ---------- */
const todos=$$('.todo input');
const saved=JSON.parse(localStorage.getItem('hologran_todo')||'[]');
todos.forEach((c,i)=>{
  c.checked=!!saved[i];
  c.onchange=()=>{
    localStorage.setItem('hologran_todo',JSON.stringify(todos.map(t=>t.checked)));
    updProg();
  };
});
function updProg(){
  const n=todos.filter(t=>t.checked).length;
  $('#progBar').style.width=(n/todos.length*100)+'%';
  $('#progTxt').textContent=n+' / '+todos.length;
}

/* ---------- появление при скролле ---------- */
const io=new IntersectionObserver(es=>es.forEach(e=>{
  if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}
}),{threshold:.12});
$$('.rev').forEach(el=>io.observe(el));

/* ---------- старт ---------- */
updProg();
calcPyr();
loadTask(0);
requestAnimationFrame(loop);
