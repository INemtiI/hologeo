'use strict';
/* ===== состояние, интерфейс, события ===== */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];

const S={
  fig:null,curPts:[],pts3:[],plane:null,trace:null,sec:{poly:[],raw:[],name:'—'},
  yaw:-0.62,pitch:0.46,zoom:1,autoRot:true,
  stepsOn:false,step:1,stepAnim:1,
  showSec:true,showVtx:true,showGrid:true,
  sel:null,
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
const dpr=Math.min(window.devicePixelRatio||1,2);

/* ---------- загрузка тел и задач ---------- */
function mkEdgePt(a,b,t){
  const ia=S.fig.labIdx[a],ib=S.fig.labIdx[b];
  const hint=t===0?'вершина '+a:(t===1?'вершина '+b:'ребро '+a+b);
  return{fn:tt=>lerp3(S.fig.verts[ia],S.fig.verts[ib],tt),t,hint};
}
function setFig(k){
  S.fig=buildFig(k);
  S.faceStyle={};S.extEdges.clear();S.extSection=false;S.sel=null;
  $$('.fbtn').forEach(b=>b.classList.toggle('on',b.dataset.k===k));
  $('#cbVtx').disabled=!S.fig.labeled;
}
function loadTask(i){
  const t=TASKS[i];
  setFig(t.f);
  S.curPts=t.pts.map(p=>Array.isArray(p)?mkEdgePt(p[0],p[1],p[2]):{fn:p.fn,t:p.t,hint:p.hint});
  syncSliders();recompute();
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
  const f=S.fig;
  let mFig=`<span class="val">${f.name}</span><br><b>V</b> = <span class="val">${fmt(figVolume(f))}</span>&nbsp;&nbsp;<b>S<sub>пов</sub></b> = <span class="val">${fmt(figSurface(f))}</span>`;
  if(f.kind!=='sph')mFig+=`<br>вершин: ${f.verts.length} · рёбер: ${f.edges.length} · граней: ${f.faces.length}`;
  $('#mFig').innerHTML=mFig;

  let hs='<span class="dim">кликни по вершине, ребру или грани</span>';
  if(S.sel){
    if(S.sel.type==='vertex'){
      const i=S.sel.index,lb=f.labeled?f.labels[i]:('v'+i);
      hs=`<b>${lb}</b> — вершина<br>координаты: <span class="val">${fmtC(f.verts[i])}</span>`;
    }else if(S.sel.type==='edge'){
      const A=f.verts[S.sel.a],B=f.verts[S.sel.b];
      const la=f.labeled?f.labels[S.sel.a]:('v'+S.sel.a);
      const lb=f.labeled?f.labels[S.sel.b]:('v'+S.sel.b);
      hs=`<b>${la}${lb}</b> — ребро<br><b>|${la}${lb}|</b> = <span class="val">${fmt(len(sub(B,A)))}</span><br>${la} <span class="val">${fmtC(A)}</span><br>${lb} <span class="val">${fmtC(B)}</span>`;
    }else if(S.sel.type==='face'){
      const ids=f.faces[S.sel.index],pts=ids.map(i=>f.verts[i]);
      const names=f.labeled?ids.map(i=>f.labels[i]).join(''):('грань №'+(S.sel.index+1));
      hs=`<b>${names}</b> — грань (${ids.length} верш.)<br><b>S</b> = <span class="val">${fmt(polyArea3D(pts))}</span>&nbsp;&nbsp;<b>P</b> = <span class="val">${fmt(polyPerimeter3D(pts))}</span>`;
    }
  }
  $('#mSel').innerHTML=hs;
  $('#btnFace').disabled=!(S.sel&&S.sel.type==='face');
  $('#btnExtEdge').disabled=!(S.sel&&S.sel.type==='edge');
  if(S.sel&&S.sel.type==='edge'){
    const k=Math.min(S.sel.a,S.sel.b)+'_'+Math.max(S.sel.a,S.sel.b);
    $('#btnExtEdge').textContent=S.extEdges.has(k)?'✓ ребро продлено':'∞ продлить ребро';
  }else $('#btnExtEdge').textContent='∞ продлить ребро';
  $('#btnExtSec').textContent=S.extSection?'✓ стороны продлены':'∞ продлить стороны сечения';

  let hc='—';
  if(S.plane&&S.sec.poly.length>=3){
    const pts=S.sec.poly,sides=[];
    for(let i=0;i<pts.length;i++)sides.push(fmt(len(sub(pts[i],pts[(i+1)%pts.length]))));
    hc=`<b>${S.sec.name}</b><br><b>S</b> = <span class="val">${fmt(polyArea3D(pts))}</span>&nbsp;&nbsp;<b>P</b> = <span class="val">${fmt(polyPerimeter3D(pts))}</span>`+
      `<details><summary>координаты вершин (${pts.length})</summary><div class="coord-list">${pts.map((p,i)=>'P'+(i+1)+' '+fmtC(p)).join('<br>')}</div></details>`+
      `<details><summary>длины сторон</summary><div class="coord-list">${sides.join(' · ')}</div></details>`;
  }else if(S.plane)hc='<span class="dim">плоскость почти не задевает тело</span>';
  $('#mSec').innerHTML=hc;
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
$('#stPrev').onclick=()=>{S.step=Math.max(1,S.step-1);updSteps();};
$('#stNext').onclick=()=>{S.step=Math.min(4,S.step+1);if(S.step===4)S.stepAnim=0;updSteps();};
$('#cbSteps').onchange=e=>{
  S.stepsOn=e.target.checked;
  $('#stepsBar').classList.toggle('on',S.stepsOn);
  S.step=1;S.stepAnim=0;updSteps();
};
$('#cbSec').onchange=e=>S.showSec=e.target.checked;
$('#cbVtx').onchange=e=>S.showVtx=e.target.checked;
$('#cbGrid').onchange=e=>S.showGrid=e.target.checked;
$('#cbAuto').onchange=e=>S.autoRot=e.target.checked;

/* ---------- внешний вид ---------- */
$('#alpIn').oninput=e=>$('#alpVal').textContent=e.target.value+'%';
$('#btnFace').onclick=()=>{
  if(S.sel&&S.sel.type==='face'){
    S.faceStyle[S.sel.index]={color:$('#colIn').value,alpha:+$('#alpIn').value/100};
    updInspector();
  }
};
$('#btnBody').onclick=()=>{
  S.bodyStyle={color:$('#colIn').value,alpha:+$('#alpIn').value/100};
};
$('#btnExtEdge').onclick=()=>{
  if(S.sel&&S.sel.type==='edge'){
    const k=Math.min(S.sel.a,S.sel.b)+'_'+Math.max(S.sel.a,S.sel.b);
    S.extEdges.has(k)?S.extEdges.delete(k):S.extEdges.add(k);
    updInspector();
  }
};
$('#btnExtSec').onclick=()=>{S.extSection=!S.extSection;updInspector();};
$('#btnClear').onclick=()=>{
  S.faceStyle={};S.bodyStyle={color:'#6ea8ff',alpha:0.13};
  S.extEdges.clear();S.extSection=false;S.sel=null;
  updInspector();
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

/* ---------- виды и клавиатура ---------- */
const VIEWS={iso:[-0.62,0.46],front:[0,0.02],top:[0,1.55],left:[-Math.PI/2,0.02]};
$$('.tbtn').forEach(b=>b.onclick=()=>{
  const v=b.dataset.v;
  if(v==='reset'){S.yaw=-0.62;S.pitch=0.46;S.zoom=1;return;}
  [S.yaw,S.pitch]=VIEWS[v];
});
addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT')return;
  if(e.key==='Escape'){S.sel=null;updInspector();closeHolo();}
  if(e.key==='r'||e.key==='к'){S.yaw=-0.62;S.pitch=0.46;S.zoom=1;}
  if(e.key==='g'||e.key==='п'){S.showGrid=!S.showGrid;$('#cbGrid').checked=S.showGrid;}
});

/* ---------- управление мышью / касанием ---------- */
const pinchDist=()=>{
  const p=[...pointers.values()];
  return Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
};
viewCv.addEventListener('pointerdown',e=>{
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
    S.pitch=clamp(S.pitch-dy*0.005,-0.15,1.56);
    lx=e.clientX;ly=e.clientY;
  }else hoverAt(e);
});
const endPointer=e=>{
  pointers.delete(e.pointerId);
  if(pointers.size<2)pinchD=0;
  if(dragging&&pointers.size===0){
    dragging=false;
    if(moved<6)handleClick(e);
  }
};
viewCv.addEventListener('pointerup',endPointer);
viewCv.addEventListener('pointercancel',endPointer);
viewCv.addEventListener('wheel',e=>{
  e.preventDefault();
  S.zoom=clamp(S.zoom*Math.exp(-e.deltaY*0.0012),0.4,4);
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
function handleClick(e){
  const r=viewCv.getBoundingClientRect();
  const p=pickAt(e.clientX-r.left,e.clientY-r.top);
  S.sel=p;
  updInspector();
}

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
  if(S.stepsOn&&S.step===4&&S.stepAnim<1)S.stepAnim=Math.min(1,S.stepAnim+dt*1.1);
  if($('#holoOv').classList.contains('on'))drawHolo();else drawMain();
  requestAnimationFrame(loop);
}

/* ---------- голограмма ---------- */
const sel=$('#holoFig');
FIGKEYS.forEach(([k,n])=>{const o=document.createElement('option');o.value=k;o.textContent=n;sel.appendChild(o);});
sel.onchange=()=>{const i=TASKS.findIndex(t=>t.f===sel.value);if(i>=0)loadTask(i);};
function openHolo(){$('#holoOv').classList.add('on');sel.value=S.fig.key;document.body.style.overflow='hidden';}
function closeHolo(){$('#holoOv').classList.remove('on');document.body.style.overflow='';}
$('#holoOpen').onclick=openHolo;$('#holoOpen2').onclick=openHolo;$('#holoOpen3').onclick=openHolo;
$('#holoClose').onclick=closeHolo;

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
    `<text x="${cx2-14}" y="176" font-family="JetBrains Mono" font-size="10" fill="#ffc24b">a=${a}</text>`+
    `<line x1="${cx2+b*sc/2}" y1="${y0-h*sc}" x2="${cx2-b*sc/2}" y2="${y0-h*sc}" stroke="#8ba3c4" stroke-width="1"/>`+
    `<text x="${cx2-12}" y="${y0-h*sc-6}" font-family="JetBrains Mono" font-size="10" fill="#ffc24b">b=${b}</text>`+
    `<line x1="${cx2+a*sc/2+14}" y1="${y0}" x2="${cx2+a*sc/2+14}" y2="${y0-h*sc}" stroke="#8ba3c4" stroke-width="1"/>`+
    `<text x="${cx2+a*sc/2+19}" y="${y0-h*sc/2}" font-family="JetBrains Mono" font-size="10" fill="#ffc24b">h=${Math.round(h)}</text>`+
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
