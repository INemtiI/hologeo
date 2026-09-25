'use strict';
/* ===== проекция и отрисовка сцены ===== */
function mkProj(yaw,pitch,cx,cy,s){
  const ca=Math.cos(yaw),sa=Math.sin(yaw),cb=Math.cos(pitch),sb=Math.sin(pitch);
  const rot=p=>{const y0=p.x*sa+p.y*ca;return{x:p.x*ca-p.y*sa,y2:y0*cb+p.z*sb,z2:p.z*cb-y0*sb};};
  const pr=p=>{const r=rot(p);return{x:cx+r.x*s,y:cy-r.z2*s,d:r.y2};};
  return{pr,rot};
}
function line3(ctx,P,a,b){
  const p=P.pr(a),q=P.pr(b);
  ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();
}

/* декартова сетка и оси */
function drawGridAxes(ctx,P){
  const G=3;
  ctx.lineWidth=1;
  ctx.strokeStyle='rgba(120,160,220,.13)';
  for(let i=-G;i<=G;i++){
    if(i===0)continue;
    line3(ctx,P,V(i,-G,0),V(i,G,0));
    line3(ctx,P,V(-G,i,0),V(G,i,0));
  }
  const AX=[['#ff7a6b',V(G+.7,0,0),'X'],['#69f0a0',V(0,G+.7,0),'Y'],['#5fe6ff',V(0,0,G+.7),'Z']];
  for(const[col,end,lab]of AX){
    const o=P.pr(V(0,0,0)),e=P.pr(end);
    ctx.strokeStyle=col;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(o.x,o.y);ctx.lineTo(e.x,e.y);ctx.stroke();
    const dx=e.x-o.x,dy=e.y-o.y,l=Math.hypot(dx,dy)||1,ux=dx/l,uy=dy/l;
    ctx.fillStyle=col;
    ctx.beginPath();ctx.moveTo(e.x,e.y);
    ctx.lineTo(e.x-ux*9-uy*4,e.y-uy*9+ux*4);
    ctx.lineTo(e.x-ux*9+uy*4,e.y-uy*9-ux*4);
    ctx.closePath();ctx.fill();
    ctx.font='700 11px "JetBrains Mono"';
    ctx.fillText(lab,e.x+ux*10-4,e.y+uy*10+4);
  }
  ctx.font='9px "JetBrains Mono"';
  const num=i=>i<0?'−'+(-i):String(i);
  for(let i=-G;i<=G;i++){
    if(i===0)continue;
    const tx=P.pr(V(i,0,0));ctx.fillStyle='rgba(255,122,107,.75)';ctx.fillText(num(i),tx.x-3,tx.y+13);
    const ty=P.pr(V(0,i,0));ctx.fillStyle='rgba(105,240,160,.75)';ctx.fillText(num(i),ty.x+7,ty.y+3);
    const tz=P.pr(V(0,0,i));ctx.fillStyle='rgba(95,230,255,.75)';ctx.fillText(num(i),tz.x+7,tz.y+3);
  }
  const o=P.pr(V(0,0,0));
  ctx.fillStyle='rgba(200,220,245,.8)';ctx.font='10px "JetBrains Mono"';
  ctx.fillText('O',o.x-14,o.y+13);
}

function drawSphWire(ctx,P,fig,holo){
  const R=fig.r,N=44;
  const seg=(a,b)=>{
    const m=mul(add(a,b),0.5),front=P.rot(m).y2<0;
    const p1=P.pr(a),p2=P.pr(b);
    ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);
    ctx.lineWidth=front?(holo?1.2:1.4):1;
    ctx.strokeStyle=front?(holo?'#8ef1ff':'#d9e8fb'):(holo?'rgba(142,241,255,.22)':'rgba(146,176,216,.26)');
    if(!front&&!holo)ctx.setLineDash([4,5]);
    ctx.stroke();ctx.setLineDash([]);
  };
  if(holo){ctx.save();ctx.shadowColor='#37cfff';ctx.shadowBlur=7;}
  for(const zl of[-0.8,-0.4,0,0.4,0.8]){
    const z=zl*R,rr=Math.sqrt(R*R-z*z);
    for(let i=0;i<N;i++){
      const a1=i/N*TAU,a2=(i+1)/N*TAU;
      seg(V(rr*Math.cos(a1),rr*Math.sin(a1),z),V(rr*Math.cos(a2),rr*Math.sin(a2),z));
    }
  }
  for(let k=0;k<6;k++){
    const ph=k*Math.PI/6;
    for(let i=0;i<N;i++){
      const t1=i/N*TAU,t2=(i+1)/N*TAU;
      seg(V(R*Math.cos(t1)*Math.cos(ph),R*Math.cos(t1)*Math.sin(ph),R*Math.sin(t1)),
          V(R*Math.cos(t2)*Math.cos(ph),R*Math.cos(t2)*Math.sin(ph),R*Math.sin(t2)));
    }
  }
  if(holo)ctx.restore();
}

/* главная функция кадра. o = {yaw,pitch,cx,cy,scale,holo,fig,st,picksOut} */
function renderScene(ctx,W,H,o){
  const fig=o.fig,st=o.st;
  ctx.clearRect(0,0,W,H);
  const P=mkProj(o.yaw,o.pitch,o.cx,o.cy,o.scale);
  const holo=!!o.holo;
  if(o.picksOut){o.picksOut.verts=[];o.picksOut.edges=[];o.picksOut.faces=[];}

  if(!holo&&st.showGrid)drawGridAxes(ctx,P);

  /* продлённые рёбра */
  if(!holo&&st.extEdges.size){
    ctx.strokeStyle='rgba(255,194,75,.55)';ctx.lineWidth=1.2;
    for(const k of st.extEdges){
      const[a,b]=k.split('_').map(Number);
      const A=fig.verts[a],B=fig.verts[b],d=nrm(sub(B,A));
      line3(ctx,P,sub(A,mul(d,7)),add(B,mul(d,7)));
    }
  }

  let pv=null;
  if(fig.kind==='sph'){
    drawSphWire(ctx,P,fig,holo);
  }else{
    pv=fig.verts.map(p=>P.pr(p));
    if(o.picksOut)fig.verts.forEach((v,i)=>o.picksOut.verts.push({x:pv[i].x,y:pv[i].y,idx:i}));

    /* грани: сортировка по глубине, покраска */
    const vis=[],order=[];
    fig.faces.forEach((f,i)=>{let d=0;f.forEach(id=>d+=pv[id].d);order.push([i,d/f.length]);});
    order.sort((a,b)=>b[1]-a[1]);
    for(const[i,d]of order){
      const front=P.rot(fig.fn[i]).y2<0;vis[i]=front;
      if(o.picksOut)o.picksOut.faces.push({poly:fig.faces[i].map(id=>({x:pv[id].x,y:pv[id].y})),idx:i,d,front});
      if(front&&!holo){
        const fs=st.faceStyle[i]||st.bodyStyle;
        let al=fs.alpha;
        if(st.sel&&st.sel.type==='face'&&st.sel.index===i)al=Math.min(1,al+0.18);
        ctx.beginPath();
        fig.faces[i].forEach((id,j)=>j?ctx.lineTo(pv[id].x,pv[id].y):ctx.moveTo(pv[id].x,pv[id].y));
        ctx.closePath();
        ctx.fillStyle=hexToRgba(fs.color,al);
        ctx.fill();
      }
    }
    /* рёбра: невидимые штрихом, видимые сплошной */
    const drawSeg=(a,b,evis)=>{
      ctx.beginPath();ctx.moveTo(pv[a].x,pv[a].y);ctx.lineTo(pv[b].x,pv[b].y);
      if(!evis&&!holo){ctx.setLineDash([5,5]);ctx.strokeStyle='rgba(146,176,216,.34)';ctx.lineWidth=1;}
      else{ctx.setLineDash([]);ctx.strokeStyle=holo?'#8ef1ff':'#d9e8fb';ctx.lineWidth=holo?1.3:1.6;}
      ctx.stroke();ctx.setLineDash([]);
    };
    const segs=fig.edges.map(([a,b])=>{
      const k=Math.min(a,b)+'_'+Math.max(a,b);
      const fl=fig.ef[k];
      return{a,b,evis:fl?fl.some(i=>vis[i]):true};
    });
    if(o.picksOut)segs.forEach(s=>o.picksOut.edges.push({x1:pv[s.a].x,y1:pv[s.a].y,x2:pv[s.b].x,y2:pv[s.b].y,a:s.a,b:s.b}));
    if(holo){ctx.save();ctx.shadowColor='#37cfff';ctx.shadowBlur=8;segs.forEach(s=>drawSeg(s.a,s.b,true));ctx.restore();}
    else{segs.filter(s=>!s.evis).forEach(s=>drawSeg(s.a,s.b,false));segs.filter(s=>s.evis).forEach(s=>drawSeg(s.a,s.b,true));}
  }

  /* продлённые стороны сечения */
  if(!holo&&st.extSection&&st.sec.poly.length>=3){
    ctx.strokeStyle='rgba(95,230,255,.45)';ctx.lineWidth=1.1;
    const pl=st.sec.poly,m=pl.length;
    for(let i=0;i<m;i++){
      const A=pl[i],B=pl[(i+1)%m],d=nrm(sub(B,A));
      line3(ctx,P,sub(A,mul(d,3)),add(B,mul(d,3)));
    }
  }

  /* след плоскости */
  if(!holo&&st.trace&&(st.stepsOn?st.step>=2:true)){
    const a=P.pr(st.trace[0]),b=P.pr(st.trace[1]);
    ctx.setLineDash([7,6]);ctx.strokeStyle='rgba(255,194,75,.85)';ctx.lineWidth=1.3;
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
    ctx.font='italic 13px "JetBrains Mono"';ctx.fillStyle='rgba(255,194,75,.9)';
    ctx.fillText('ℓ',b.x+6,b.y+4);
  }

  /* точки пересечения (шаг 3+) */
  if(!holo&&st.stepsOn&&st.step>=3){
    const raws=st.step===3?st.sec.raw:st.sec.poly;
    ctx.fillStyle='#ffc24b';
    raws.forEach(p=>{const q=P.pr(p);ctx.beginPath();ctx.arc(q.x,q.y,2.6,0,TAU);ctx.fill();});
  }

  /* многоугольник сечения */
  if(st.sec.poly.length>=3){
    const drawPoly=holo?true:(st.stepsOn?st.step===4:st.showSec);
    if(drawPoly){
      const pp=st.sec.poly.map(p=>P.pr(p));
      const prog=(st.stepsOn&&st.step===4)?st.stepAnim:1;
      if(holo){ctx.save();ctx.shadowColor='#7df3ff';ctx.shadowBlur=10;}
      if(prog>=1){
        ctx.beginPath();pp.forEach((q,i)=>i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y));
        ctx.closePath();ctx.fillStyle=holo?'rgba(120,240,255,.14)':'rgba(95,230,255,.18)';ctx.fill();
      }
      ctx.strokeStyle=holo?'#e6feff':'#5fe6ff';ctx.lineWidth=holo?1.6:2.2;
      const m=pp.length,k=prog*m;
      for(let i=0;i<m;i++){
        const A=pp[i],B=pp[(i+1)%m];
        ctx.beginPath();ctx.moveTo(A.x,A.y);
        if(k>=i+1)ctx.lineTo(B.x,B.y);
        else if(k>i){const f=k-i;ctx.lineTo(A.x+(B.x-A.x)*f,A.y+(B.y-A.y)*f);}
        else break;
        ctx.stroke();
      }
      if(holo)ctx.restore();
      if(!holo&&prog>=1){
        ctx.fillStyle='#5fe6ff';
        pp.forEach(q=>{ctx.beginPath();ctx.arc(q.x,q.y,2.6,0,TAU);ctx.fill();});
      }
    }
  }

  /* подсветка выделения */
  if(!holo&&st.sel&&pv){
    ctx.save();ctx.shadowColor='rgba(255,194,75,.7)';ctx.shadowBlur=8;
    if(st.sel.type==='face'){
      const ids=fig.faces[st.sel.index];
      ctx.beginPath();ids.forEach((id,j)=>j?ctx.lineTo(pv[id].x,pv[id].y):ctx.moveTo(pv[id].x,pv[id].y));
      ctx.closePath();ctx.strokeStyle='#ffc24b';ctx.lineWidth=2;ctx.stroke();
    }else if(st.sel.type==='edge'){
      ctx.beginPath();ctx.moveTo(pv[st.sel.a].x,pv[st.sel.a].y);
      ctx.lineTo(pv[st.sel.b].x,pv[st.sel.b].y);
      ctx.strokeStyle='#ffc24b';ctx.lineWidth=3.2;ctx.stroke();
    }else if(st.sel.type==='vertex'){
      const q=pv[st.sel.index];
      ctx.beginPath();ctx.arc(q.x,q.y,6.5,0,TAU);
      ctx.strokeStyle='#ffc24b';ctx.lineWidth=2;ctx.stroke();
    }
    ctx.restore();
  }

  /* выбранные объекты для измерения угла */
  if(!holo&&st.anglePicks&&st.anglePicks.length){
    ctx.save();ctx.shadowColor='rgba(105,240,160,.75)';ctx.shadowBlur=7;
    ctx.strokeStyle='#69f0a0';ctx.lineWidth=2.4;
    st.anglePicks.forEach(p=>{
      if(p.type==='edge'){
        ctx.beginPath();ctx.moveTo(pv[p.a].x,pv[p.a].y);ctx.lineTo(pv[p.b].x,pv[p.b].y);ctx.stroke();
      }else if(p.type==='face'){
        const ids=fig.faces[p.index];ctx.beginPath();ids.forEach((id,j)=>j?ctx.lineTo(pv[id].x,pv[id].y):ctx.moveTo(pv[id].x,pv[id].y));ctx.closePath();ctx.stroke();
      }
    });
    ctx.restore();
  }

  /* точки P, Q, R */
  if(!holo){
    ctx.font='700 12px "JetBrains Mono"';
    ['P','Q','R'].forEach((nm,i)=>{
      if(!st.pts3[i])return;
      const q=P.pr(st.pts3[i]);
      ctx.beginPath();ctx.arc(q.x,q.y,5,0,TAU);
      ctx.fillStyle='#ffc24b';ctx.fill();
      ctx.lineWidth=2;ctx.strokeStyle='#081120';ctx.stroke();
      ctx.fillStyle='#ffc24b';ctx.fillText(nm,q.x+9,q.y-8);
    });
  }

  /* подписи вершин */
  if(!holo&&fig.labeled&&st.showVtx){
    let cx=0,cy=0;
    pv.forEach(q=>{cx+=q.x;cy+=q.y});cx/=pv.length;cy/=pv.length;
    ctx.font='600 11px "JetBrains Mono"';
    pv.forEach((q,i)=>{
      ctx.fillStyle='rgba(231,239,251,.9)';
      ctx.beginPath();ctx.arc(q.x,q.y,2,0,TAU);ctx.fill();
      const dx=q.x-cx,dy=q.y-cy,l=Math.hypot(dx,dy)||1;
      ctx.fillStyle='rgba(200,220,245,.85)';
      ctx.fillText(fig.labels[i],q.x+dx/l*14-4,q.y+dy/l*14+4);
    });
  }

  /* HUD */
  if(!holo){
    ctx.font='11px "JetBrains Mono"';ctx.fillStyle='rgba(160,190,225,.85)';
    ctx.fillText(fig.name.toUpperCase()+' · СЕЧЕНИЕ: '+st.sec.name.toUpperCase(),14,22);
    ctx.fillText(st.stepsOn?('РЕЖИМ: ПО ШАГАМ · '+st.step+'/4'):(st.autoRot?'РЕЖИМ: АВТОВРАЩЕНИЕ':'РЕЖИМ: РУЧНОЙ'),14,38);
  }
}
