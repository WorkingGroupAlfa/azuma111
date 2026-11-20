/* =====================================================================
   Paper-folding intro.
   A square sheet is folded for real: every fold reflects part of the
   sheet across a crease, drawn as an orthographic 3D rotation
   (p -> foot + (p - foot) * cos θ), with the paper's back side and
   light falloff shown while it turns. Then the folded triangle squashes
   into the crane body and the tail, neck and wing are folded out of it
   around their hinges.
   ===================================================================== */
// crane colours come from the theme: --crane / --crane-back (logo red in dark, lime green in light)
let FRONT='#ed2d23', BACK='#b51f17';
function readCraneColours(){ const cs=getComputedStyle(document.documentElement);
  FRONT=cs.getPropertyValue('--crane').trim()||FRONT; BACK=cs.getPropertyValue('--crane-back').trim()||BACK;
  Object.keys(SHADE).forEach(k=>SHADE[k]=FRONT); }
const T=[425,95], R=[575,245], B=[425,395], L=[275,245], C=[425,245];
const FINAL={ // traced from the logo
  body:[[359,295],[395,262],[487,257],[485,342],[460,328],[374,397]],
  tail:[[269,147],[395,262],[370,282],[273,156]],
  neck:[[487,257],[552,184],[565,181],[580,218],[557,207],[485,342]],
  wing:[[395,262],[397,225],[467,91],[505,225],[487,257]],
};
const SHADE={body:FRONT,tail:FRONT,neck:FRONT,wing:FRONT}; // the logo crane is one flat colour
const HINGE={tail:[[395,262],[370,282]], neck:[[487,257],[485,342]], wing:[[395,262],[487,257]]};
const pts=a=>a.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
const lerp=(a,b,t)=>a+(b-a)*t;
const clamp=t=>Math.min(Math.max(t,0),1);
const eio=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
const eout=t=>1-Math.pow(1-t,3);
function foldPt(p,[a,b],cos){ // partial reflection of p across line ab
  const dx=b[0]-a[0], dy=b[1]-a[1], l2=dx*dx+dy*dy;
  const k=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2, f=[a[0]+k*dx,a[1]+k*dy];
  return [f[0]+(p[0]-f[0])*cos, f[1]+(p[1]-f[1])*cos];
}
function mixHex(h1,h2,t){const a=parseInt(h1.slice(1),16),b=parseInt(h2.slice(1),16),m=(x,y)=>Math.round(lerp(x,y,t));
  return `rgb(${m(a>>16,b>>16)},${m(a>>8&255,b>>8&255)},${m(a&255,b&255)})`;}
function shade(hex,f){ const n=parseInt(hex.slice(1),16);
  return `rgb(${Math.round((n>>16)*f)},${Math.round((n>>8&255)*f)},${Math.round((n&255)*f)})`; }

const FOLD1=[L,R], FOLD2=[C,B];
const PIECES=[ // quarter triangles of the sheet, with the folds each one takes part in
  {id:'BR',p:[C,R,B],folds:[]},
  {id:'TR',p:[T,R,C],folds:[1]},
  {id:'TL',p:[L,T,C],folds:[1,2]},
  {id:'BL',p:[L,C,B],folds:[2]},
];
const paper=document.getElementById('paper');
const NS='http://www.w3.org/2000/svg';
function poly(){const e=document.createElementNS(NS,'polygon');e.setAttribute('stroke-linejoin','round');paper.appendChild(e);return e;}
let P={};
function resetPaper(){ paper.innerHTML=''; P={};
  P.U=poly(); // solid underlay: hides hairline seams between the quarter pieces
  PIECES.forEach(pc=>P[pc.id]=poly());
  ['body','tail','neck','wing'].forEach(k=>{P[k]=poly(); P[k].style.opacity=0;});
}
function setPoly(el,points,fill,lifted){ el.setAttribute('points',pts(points)); el.setAttribute('fill',fill); el.setAttribute('stroke',fill); el.setAttribute('stroke-width','.7');
  if(lifted) el.setAttribute('filter','url(#lift)'); else el.removeAttribute('filter'); }

function drawSheet(c1,c2){ // c1,c2 = progress of fold 1 and fold 2 (0..1)
  const cos1=Math.cos(Math.PI*c1), cos2=Math.cos(Math.PI*c2);
  PIECES.forEach(pc=>{
    let p=pc.p, flips=1, light=1, moving=false;
    if(pc.folds.includes(1)){ p=p.map(q=>foldPt(q,FOLD1,cos1)); flips*=Math.sign(cos1)||1; if(c1>0&&c1<1){light=.62+.38*Math.abs(cos1);moving=true;} }
    if(pc.folds.includes(2)){ p=p.map(q=>foldPt(q,FOLD2,cos2)); flips*=Math.sign(cos2)||1; if(c2>0&&c2<1){light=.62+.38*Math.abs(cos2);moving=true;} }
    setPoly(P[pc.id],p,shade(flips>0?FRONT:BACK,light),moving);
  });
  // underlay = the part of the sheet that is lying flat right now
  const under = c2>0 ? [C,R,B] : c1>0 ? [L,R,B] : [L,T,R,B];
  P.U.style.opacity=1; setPoly(P.U,under,FRONT,false); paper.appendChild(P.U);
  // stacking: folding layers travel on top
  const order = c2>0 ? ['BR','TR','TL','BL'] : ['BL','BR','TL','TR'];
  order.forEach(id=>paper.appendChild(P[id]));
}
function drawCrane(sq,fl){ // sq = squash progress, fl = {tail,neck,wing} unfold progress
  const from=[C,C,R,R,[500,320],B];
  setPoly(P.body,from.map((p,i)=>[lerp(p[0],FINAL.body[i][0],sq),lerp(p[1],FINAL.body[i][1],sq)]),
    mixHex(BACK,SHADE.body,sq),false);
  ['tail','neck','wing'].forEach(k=>{
    const t=fl[k]; const cos=Math.cos(Math.PI*(1-t)); // starts folded flat over the body (θ=π), opens to θ=0
    const p=FINAL[k].map(q=>foldPt(q,HINGE[k],cos));
    const front=cos>=0, light=.62+.38*Math.abs(cos);
    // no drop shadow on the crane's flaps: near the end it read as a dark band across the body under the hinge
    setPoly(P[k],p,shade(front?SHADE[k]:BACK,light),false);
    P[k].style.opacity=clamp(t*6);
  });
  ['body','tail','neck','wing'].forEach(k=>paper.appendChild(P[k]));
}

const intro=document.getElementById('intro'), iwm=document.getElementById('iwm'), isub=document.getElementById('isub');
let raf, done=true;
// the intro plays once per visit (browser session): if it already ran, hide the overlay right away,
// before the first paint, so it never flashes; playIntro() itself stays callable
let introSeen=false;
try{ introSeen=sessionStorage.getItem('azuma-intro')==='1'; }catch(e){}
if(introSeen) intro.hidden=true;
function playIntroOnce(){ if(!introSeen) playIntro(); }
function playIntro(){
  readCraneColours();
  done=false; intro.hidden=false; intro.classList.remove('out'); iwm.classList.remove('on'); isub.classList.remove('on');
  [...iwm.children].forEach((s,i)=>s.style.transitionDelay=(i*70)+'ms');
  resetPaper();
  const stage=document.querySelector('.stage svg');
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){
    PIECES.forEach(pc=>P[pc.id].style.opacity=0); P.U.style.opacity=0; drawCrane(1,{tail:1,neck:1,wing:1});
    iwm.classList.add('on'); isub.classList.add('on'); setTimeout(endIntro,1000); return;
  }
  clearTimeout(playIntro.g); playIntro.g=setTimeout(endIntro,5600);
  const t0=performance.now(); cancelAnimationFrame(raf);
  (function tick(now){
    const t=now-t0;
    // 0–400 sheet lays down
    const a=eout(clamp(t/400));
    stage.style.transform=`perspective(900px) rotateX(${(1-a)*55}deg) scale(${.9+.1*a})`; stage.style.opacity=a;
    // 450–1050 fold 1: top half over the bottom, along the horizontal diagonal
    const c1=eio(clamp((t-450)/600));
    // 1120–1680 fold 2: left half over the right
    const c2=eio(clamp((t-1120)/560));
    if(t<1720){
      PIECES.forEach(pc=>P[pc.id].style.opacity=1);
      drawSheet(c1,c2);
    } else {
      // 1720–2050 squash fold into the body, 1960+ tail and neck, then the wing
      PIECES.forEach(pc=>P[pc.id].style.opacity=0); P.U.style.opacity=0; P.body.style.opacity=1;
      const sq=eio(clamp((t-1720)/330));
      drawCrane(sq,{tail:eio(clamp((t-1960)/520)), neck:eio(clamp((t-2060)/520)), wing:eio(clamp((t-2300)/620))});
    }
    if(t>2850 && !iwm.classList.contains('on')){iwm.classList.add('on');isub.classList.add('on');}
    if(t<3900) raf=requestAnimationFrame(tick); else endIntro();
  })(t0);
}
function endIntro(){ if(done) return; done=true; cancelAnimationFrame(raf); clearTimeout(playIntro.g);
  intro.classList.add('out'); setTimeout(()=>{ if(done) intro.hidden=true; },650);
  try{sessionStorage.setItem('azuma-intro','1');}catch(e){}
}
intro.addEventListener('click',endIntro);

// static crane for home, sheet, etc.
// static crane follows the theme live through the CSS variable
const CRANE_SVG=Object.keys(FINAL).map(k=>`<polygon points="${pts(FINAL[k])}" style="fill:var(--crane);stroke:var(--crane)" stroke-width=".7" stroke-linejoin="round"/>`).join('');
document.querySelectorAll('.craneFinal').forEach(s=>s.innerHTML=CRANE_SVG);
