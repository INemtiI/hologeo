'use strict';
/* ===== построители тел и библиотека задач =====
   Все тела заданы «красивыми» координатами в декартовой системе,
   начало координат — в центре тела. Единица сетки = 1. */

function faceNormal(v,ids){
  let x=0,y=0,z=0;
  for(let i=0;i<ids.length;i++){
    const a=v[ids[i]],b=v[ids[(i+1)%ids.length]];
    x+=(a.y-b.y)*(a.z+b.z); y+=(a.z-b.z)*(a.x+b.x); z+=(a.x-b.x)*(a.y+b.y);
  }
  return nrm(V(x,y,z));
}
function finalize(f){
  if(f.kind==='poly'){
    f.R=Math.max(...f.verts.map(len));
    const c=mul(f.verts.reduce(add,V(0,0,0)),1/f.verts.length);
    f.fn=f.faces.map(ids=>{
      let n=faceNormal(f.verts,ids);
      const fc=polyCentroid(ids.map(i=>f.verts[i]));
      if(dot(n,sub(fc,c))<0)n=mul(n,-1);
      return n;
    });
    f.ef={};
    f.faces.forEach((ids,fi)=>{
      for(let i=0;i<ids.length;i++){
        const a=ids[i],b=ids[(i+1)%ids.length];
        const k=Math.min(a,b)+'_'+Math.max(a,b);
        (f.ef[k]=f.ef[k]||[]).push(fi);
      }
    });
    if(f.labeled){f.labIdx={};f.labels.forEach((l,i)=>f.labIdx[l]=i);}
  } else f.R=f.r||1.5;
  return f;
}
function box(hx,hy,hz,name){
  const v=[V(-hx,-hy,-hz),V(hx,-hy,-hz),V(hx,hy,-hz),V(-hx,hy,-hz),
           V(-hx,-hy,hz),V(hx,-hy,hz),V(hx,hy,hz),V(-hx,hy,hz)];
  return finalize({kind:'poly',name,verts:v,
    faces:[[0,1,2,3],[4,7,6,5],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]],
    edges:[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]],
    labels:['A','B','C','D','A₁','B₁','C₁','D₁'],labeled:true});
}
function buildFig(key){
  let f;
  switch(key){
    case 'cube': f=box(1,1,1,'Куб');break;
    case 'par':  f=box(2,1.5,1.5,'Параллелепипед');break;
    case 'pri':{
      const v=[V(-2,-1,-1.5),V(2,-1,-1.5),V(0,2,-1.5),
               V(-2,-1, 1.5),V(2,-1, 1.5),V(0,2, 1.5)];
      f=finalize({kind:'poly',name:'Треуг. призма',verts:v,
        faces:[[0,1,2],[3,5,4],[0,1,4,3],[1,2,5,4],[2,0,3,5]],
        edges:[[0,1],[1,2],[2,0],[3,4],[4,5],[5,3],[0,3],[1,4],[2,5]],
        labels:['A','B','C','A₁','B₁','C₁'],labeled:true});
      break;}
    case 'pyr':{
      const v=[V(-2,-2,-1.5),V(2,-2,-1.5),V(2,2,-1.5),V(-2,2,-1.5),V(0,0,2.5)];
      f=finalize({kind:'poly',name:'Пирамида',verts:v,
        faces:[[0,1,2,3],[0,1,4],[1,2,4],[2,3,4],[3,0,4]],
        edges:[[0,1],[1,2],[2,3],[3,0],[0,4],[1,4],[2,4],[3,4]],
        labels:['A','B','C','D','S'],labeled:true});
      break;}
    case 'tet':{
      const v=[V(0,0,2),V(-1.5,-1.5,-1),V(1.5,-1.5,-1),V(0,1.5,-1)];
      f=finalize({kind:'poly',name:'Тетраэдр',verts:v,
        faces:[[1,2,3],[0,1,2],[0,2,3],[0,3,1]],
        edges:[[1,2],[2,3],[3,1],[0,1],[0,2],[0,3]],
        labels:['S','A','B','C'],labeled:true});
      break;}
    case 'cyl':{
      const n=30,r=1.5,hz=1.5,vs=[],edges=[],faces=[];
      for(let i=0;i<n;i++)vs.push(V(r*Math.cos(i*TAU/n),r*Math.sin(i*TAU/n),-hz));
      for(let i=0;i<n;i++)vs.push(V(r*Math.cos(i*TAU/n),r*Math.sin(i*TAU/n), hz));
      for(let i=0;i<n;i++){const j=(i+1)%n;
        edges.push([i,j],[n+i,n+j],[i,n+i]);
        faces.push([i,j,n+j,n+i]);}
      faces.push([...Array(n).keys()],Array.from({length:n},(_,i)=>n+i));
      f=finalize({kind:'poly',name:'Цилиндр',verts:vs,faces,edges,labels:null,labeled:false});
      f.dims={r:1.5,h:3};
      break;}
    case 'cone':{
      const n=30,r=1.5,z0=-1.5,vs=[],edges=[],faces=[];
      for(let i=0;i<n;i++)vs.push(V(r*Math.cos(i*TAU/n),r*Math.sin(i*TAU/n),z0));
      vs.push(V(0,0,2));
      for(let i=0;i<n;i++){const j=(i+1)%n;
        edges.push([i,j],[i,n]);
        faces.push([i,j,n]);}
      faces.push([...Array(n).keys()]);
      f=finalize({kind:'poly',name:'Конус',verts:vs,faces,edges,labels:null,labeled:false});
      f.dims={r:1.5,h:3.5};
      break;}
    case 'sph':
      f={kind:'sph',name:'Сфера',r:1.5,R:1.5,labeled:false,labels:null,dims:{r:1.5}};
      break;
  }
  f.key=key;
  return f;
}
const FIGKEYS=[['cube','Куб'],['par','Параллелепипед'],['pri','Треуг. призма'],['pyr','Пирамида'],
               ['tet','Тетраэдр'],['cyl','Цилиндр'],['cone','Конус'],['sph','Сфера']];

/* объём и площадь поверхности */
function figVolume(f){
  if(f.key==='cyl')return Math.PI*f.dims.r*f.dims.r*f.dims.h;
  if(f.key==='cone')return Math.PI*f.dims.r*f.dims.r*f.dims.h/3;
  if(f.key==='sph')return 4/3*Math.PI*Math.pow(f.dims.r,3);
  let v=0;
  f.faces.forEach((ids,i)=>{
    const pts=ids.map(j=>f.verts[j]);
    v+=dot(f.fn[i],polyCentroid(pts))*polyArea3D(pts);
  });
  return Math.abs(v)/3;
}
function figSurface(f){
  if(f.key==='cyl'){const{r,h}=f.dims;return 2*Math.PI*r*(r+h);}
  if(f.key==='cone'){const{r,h}=f.dims,l=Math.hypot(r,h);return Math.PI*r*(r+l);}
  if(f.key==='sph')return 4*Math.PI*f.dims.r*f.dims.r;
  return f.faces.reduce((s,ids)=>s+polyArea3D(ids.map(j=>f.verts[j])),0);
}

/* ===== библиотека задач ===== */
const sphP=(thF,ph)=>t=>V(1.5*Math.sin(ph)*Math.cos(thF(t)),1.5*Math.sin(ph)*Math.sin(thF(t)),1.5*Math.cos(ph));
const th=t=>TAU*t;
const TASKS=[
 {f:'cube',title:'Через середины трёх рёбер',text:'Куб ABCDA₁B₁C₁D₁. Постройте сечение через середины рёбер AA₁, BC и C₁D₁. Какая фигура в сечении?',
  pts:[['A','A₁',.5],['B','C',.5],['C₁','D₁',.5]]},
 {f:'par',title:'Через вершину и две середины',text:'Параллелепипед. Постройте сечение через вершину A и середины рёбер B₁C₁ и D₁C₁.',
  pts:[['A','B',0],['B₁','C₁',.5],['D₁','C₁',.5]]},
 {f:'pyr',title:'Сечение пирамиды',text:'Пирамида SABCD. Сечение проходит через середины рёбер SA, SB и вершину D. Определите вид сечения.',
  pts:[['S','A',.5],['S','B',.5],['D','C',0]]},
 {f:'tet',title:'Плоскость параллельна основанию',text:'Тетраэдр SABC. Сечение через середины рёбер SA, SB и SC. Докажите, что оно параллельно плоскости ABC.',
  pts:[['S','A',.5],['S','B',.5],['S','C',.5]]},
 {f:'pri',title:'Сечение призмы',text:'Треугольная призма. Постройте сечение через вершину B и середины рёбер AA₁ и CC₁.',
  pts:[['B','C',0],['A','A₁',.5],['C','C₁',.5]]},
 {f:'cyl',title:'Осевое сечение цилиндра',text:'Плоскость проходит через ось цилиндра. В сечении — прямоугольник. Двигайте точки и следите за формой.',
  pts:[{fn:t=>V(1.5*Math.cos(th(t)),1.5*Math.sin(th(t)),1.5),t:.15,hint:'верхняя окружность'},
       {fn:t=>V(1.5*Math.cos(th(t)+Math.PI),1.5*Math.sin(th(t)+Math.PI),-1.5),t:.15,hint:'нижняя окружность'},
       {fn:t=>V(1.5*Math.cos(th(t)+1.9),1.5*Math.sin(th(t)+1.9),1.5),t:.15,hint:'верхняя окружность'}]},
 {f:'cone',title:'Наклонное сечение конуса',text:'Плоскость пересекает все образующие конуса. Докажите, что в сечении — эллипс (двигайте точки).',
  pts:[{fn:t=>V(1.5*Math.cos(th(t)),1.5*Math.sin(th(t)),-1.5),t:.25,hint:'окружность основания'},
       {fn:t=>V(1.5*Math.cos(th(t)+2.6),1.5*Math.sin(th(t)+2.6),-1.5),t:.25,hint:'окружность основания'},
       {fn:t=>lerp3(V(0,0,2),V(1.5*Math.cos(2.1),1.5*Math.sin(2.1),-1.5),.35+.5*t),t:.5,hint:'точка на образующей'}]},
 {f:'sph',title:'Сечение сферы',text:'Сфера радиуса 1,5. Плоскость не проходит через центр. Докажите, что сечение — окружность, и найдите её радиус.',
  pts:[{fn:sphP(th,0.9),t:.1,hint:'точка на поверхности'},
       {fn:sphP(t=>th(t)+2.1,1.55),t:.1,hint:'точка на поверхности'},
       {fn:sphP(t=>th(t)+4.3,2.1),t:.1,hint:'точка на поверхности'}]},
];
