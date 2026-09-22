'use strict';
/* ===== векторная математика и геометрия ===== */
const V=(x,y,z)=>({x,y,z});
const sub=(a,b)=>V(a.x-b.x,a.y-b.y,a.z-b.z);
const add=(a,b)=>V(a.x+b.x,a.y+b.y,a.z+b.z);
const mul=(a,k)=>V(a.x*k,a.y*k,a.z*k);
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>V(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x);
const len=a=>Math.hypot(a.x,a.y,a.z);
const nrm=a=>{const l=len(a)||1;return mul(a,1/l)};
const lerp3=(a,b,t)=>V(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t);
const dist2=(a,b)=>{const d=sub(a,b);return dot(d,d)};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const TAU=Math.PI*2;

/* площадь плоского многоугольника в 3D */
function polyArea3D(pts){
  let s=V(0,0,0);
  for(let i=0;i<pts.length;i++)s=add(s,cross(pts[i],pts[(i+1)%pts.length]));
  return len(s)/2;
}
function polyCentroid(pts){return mul(pts.reduce(add,V(0,0,0)),1/pts.length)}
function polyPerimeter3D(pts){
  let p=0;
  for(let i=0;i<pts.length;i++)p+=len(sub(pts[i],pts[(i+1)%pts.length]));
  return p;
}
function hexToRgba(hex,a){
  const n=parseInt(hex.slice(1),16);
  return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`;
}
const fmt=v=>(Math.abs(v)<1e-10?0:v).toFixed(2).replace('.',',');
const fmtC=p=>`(${fmt(p.x)}; ${fmt(p.y)}; ${fmt(p.z)})`;

/* 2D-хит-тесты для выделения */
function ptSegDist(px,py,x1,y1,x2,y2){
  const dx=x2-x1,dy=y2-y1,l2=dx*dx+dy*dy;
  let t=l2?((px-x1)*dx+(py-y1)*dy)/l2:0;
  t=clamp(t,0,1);
  return Math.hypot(px-(x1+dx*t),py-(y1+dy*t));
}
function pointInPoly(px,py,pts){
  let inside=false;
  for(let i=0,j=pts.length-1;i<pts.length;j=i++){
    const xi=pts[i].x,yi=pts[i].y,xj=pts[j].x,yj=pts[j].y;
    if(((yi>py)!==(yj>py))&&(px<(xj-xi)*(py-yi)/(yj-yi)+xi))inside=!inside;
  }
  return inside;
}
