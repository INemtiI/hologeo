'use strict';
/* ===== алгоритмы сечения и следа ===== */
function polyName(k){return{3:'треугольник',4:'четырёхугольник',5:'пятиугольник',6:'шестиугольник'}[k]||k+'-угольник';}

function orderPoly(poly,n){
  const c=polyCentroid(poly);
  const up=Math.abs(n.z)<0.9?V(0,0,1):V(1,0,0);
  const u=nrm(cross(up,n)),v=cross(n,u);
  return poly.slice().sort((p,q)=>
    Math.atan2(dot(sub(p,c),v),dot(sub(p,c),u))-Math.atan2(dot(sub(q,c),v),dot(sub(q,c),u)));
}
function secMesh(fig,plane){
  const {n,d}=plane,raw=[];
  for(const [a,b] of fig.edges){
    const A=fig.verts[a],B=fig.verts[b];
    const da=dot(n,A)+d,db=dot(n,B)+d;
    if(da*db<0)raw.push(lerp3(A,B,da/(da-db)));
    else if(Math.abs(da)<1e-7)raw.push(A);
    else if(Math.abs(db)<1e-7)raw.push(B);
  }
  const poly=[];
  for(const p of raw)if(!poly.some(q=>dist2(q,p)<1e-7))poly.push(p);
  const ordered=poly.length>=3?orderPoly(poly,n):[];
  return{poly:ordered,raw,name:ordered.length>=3?polyName(ordered.length):'—'};
}
function secSphere(fig,plane){
  const {n,d}=plane,R=fig.r,dist=Math.abs(d);
  if(dist>=R-1e-6)return{poly:[],raw:[],name:'—'};
  const c=mul(n,-d),rr=Math.sqrt(R*R-d*d);
  const up=Math.abs(n.z)<0.9?V(0,0,1):V(1,0,0);
  const u=nrm(cross(up,n)),v=cross(n,u),poly=[];
  for(let i=0;i<48;i++){
    const a=i/48*TAU;
    poly.push(add(c,add(mul(u,rr*Math.cos(a)),mul(v,rr*Math.sin(a)))));
  }
  return{poly,raw:[],name:'окружность'};
}
/* след секущей плоскости на плоскости z=0 */
function mkTrace(plane){
  const {n,d}=plane;
  if(Math.hypot(n.x,n.y)<1e-4)return null;
  const p0=Math.abs(n.x)>Math.abs(n.y)?V(-d/n.x,0,0):V(0,-d/n.y,0);
  const dir=nrm(V(-n.y,n.x,0));
  return[add(p0,mul(dir,-4.2)),add(p0,mul(dir,4.2))];
}
