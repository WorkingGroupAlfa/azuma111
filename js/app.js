const DATA = window.AZUMA_DATA;

/* ===================== app ===================== */
const ICON={ // original icons from the current site: pepper = mildly spicy, pepper with flame = hot
  1:'<img class="ic" src="img/Spicy.svg" width="14" height="14" alt="">',
  2:'<img class="ic" src="img/Extra.svg" width="14" height="14" alt="">'
};
const SECTIONS=[
  {key:'menu',k:'料理',ua:'Кухня',en:'Menu',noteUa:'страв',noteEn:'dishes'},
  {key:'bar',k:'酒',ua:'Бар',en:'Bar',noteUa:'позицій',noteEn:'drinks'},
  {key:'tea',k:'茶',ua:'Чай',en:'Tea',noteUa:'сортів',noteEn:'teas'},
  {key:'wine',k:'葡萄酒',ua:'Вина',en:'Wine',noteUa:'вин',noteEn:'wines'},
];
// category marks: Japanese menu terms
const KANJI={
  'asia-best':'東','2':'握','3':'刺身','4':'軍艦','5':'手巻','6':'巻物','7':'菜','8':'前菜','9':'汁','10':'温菜','13':'海鮮','12':'点心','14':'餃子','15':'副菜','16':'主菜','17':'魚','18':'甘味','19':'菓子',
  b1:'日本酒',b2:'火酒',b3:'葡萄',b4:'和',b5:'杜松',b6:'竜舌蘭',b7:'甘蔗',b8:'蒸留',b9:'林檎',b10:'和',b12:'米',b13:'米',b14:'蘇格蘭',b15:'単一',b16:'愛',b17:'果実酒',b18:'薬草',b19:'香草',b20:'一杯',b21:'麦酒',b22:'雞尾酒',b23:'珈琲',b24:'水',b25:'果汁',b26:'無酒精',
  t2:'紅茶',t3:'緑茶',t4:'烏龍',t51:'花茶',t6:'普洱',t8:'草',t9:'果',
  w1:'杯',w2:'半',w3:'泡',w4:'発泡',w5:'白',w6:'赤'
};
const UI={
 ua:{callA:'Подзвонити',delivery:'Замовити доставку',hoursL:'Години роботи',hoursV:'Щодня 12:00 – 23:00',copied:'Скопійовано',addrL:'Адреса',addr:'Французький бульвар, 54/23',telL:'Телефон',call:'Подзвонити',ph:'Пошук',none:'Нічого не знайдено. Спробуйте іншу назву або інгредієнт.',
   cur:'грн',choice:'На вибір',tagM:'Пікантна страва',tagH:'Гостра страва'},
 en:{callA:'Call',delivery:'Order delivery',hoursL:'Working hours',hoursV:'Daily 12:00 – 23:00',copied:'Copied',addrL:'Address',addr:'54/23 Frantsuzkyi Blvd',telL:'Phone',call:'Call',ph:'Search',none:'Nothing found. Try another name or ingredient.',
   cur:'UAH',choice:'Your choice',tagM:'Mildly spicy',tagH:'Hot'}
};
let lang='ua', cur=null, query='';
// language: the guest's saved choice, otherwise the phone's language (Ukrainian/Russian -> UA, anything else -> EN)
(function(){ let saved=null; try{saved=localStorage.getItem('azuma-lang');}catch(e){}
  if(saved==='ua'||saved==='en'){lang=saved;return;}
  const nav=(navigator.languages&&navigator.languages[0])||navigator.language||'uk';
  lang=/^(uk|ru)/i.test(nav)?'ua':'en'; })();
const LI=()=>lang==='ua'?0:1;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function hi(s){ if(!query) return esc(s); const i=s.toLowerCase().indexOf(query); if(i<0) return esc(s);
  return esc(s.slice(0,i))+'<mark>'+esc(s.slice(i,i+query.length))+'</mark>'+esc(s.slice(i+query.length)); }
const count=key=>DATA[key].reduce((n,s)=>n+s.items.filter(Array.isArray).length,0);
const cap=s=>s.charAt(0)+s.slice(1).toLowerCase();

function renderChrome(){
  const u=UI[lang]; document.documentElement.lang=lang==='ua'?'uk':'en';
  document.querySelectorAll('[data-t]').forEach(el=>el.textContent=u[el.dataset.t]);
  document.querySelectorAll('[data-t-aria]').forEach(el=>el.setAttribute('aria-label',u[el.dataset.tAria]));
  document.querySelectorAll('[data-lang]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.lang===lang));
  document.getElementById('q').placeholder=u.ph;
  document.getElementById('tiles').innerHTML=SECTIONS.map(s=>`<a class="tile" href="#${s.key}"><span class="k" aria-hidden="true">${s.k}</span><b>${s[lang]}</b></a>`).join('');
}

// serving options a guest picks from (e.g. edamame: spicy or salted) - shown only in the dish sheet,
// as two equal tiles in the site's tile style, the spicy one carries the pepper icon
function optsHtml(it){ const o=it[9]; if(!o) return '';
  return `<div class="opts"><div class="opts-l">${UI[lang].choice}</div><div class="opts-g${o[0].length>4?' many':''}">`+
    o[LI()].map((x,i)=>`<span class="opt">${i===0&&it[5]?ICON[1]:''}${esc(x)}</span>`).join('')+`</div></div>`; }
// dish name; a spicy icon is glued to the last word so it never wraps onto a line of its own
function nameHtml(name,spice){
  if(!spice) return hi(name);
  const i=name.lastIndexOf(' ');
  return hi(name.slice(0,i+1))+`<span class="nw">${hi(name.slice(i+1))}${ICON[spice]}</span>`;
}
function renderList(){
  const u=UI[lang], key=cur, sec=SECTIONS.find(s=>s.key===key);
  document.getElementById('title').innerHTML=`<span class="k">${sec.k}</span>${esc(sec[lang])}`;
  let html='', rail='', total=0;
  DATA[key].forEach(cat=>{
    let rows='', n=0; const ents=cat.items;
    // a query that matches the category title (either language) shows the whole category, headings included
    const catHit=!!query && [cat.ua,cat.en].some(t=>t && String(t).toLowerCase().includes(query));
    const filter=query && !catHit;
    ents.forEach((it,i)=>{
      if(!Array.isArray(it)){ // wine sub-heading; a heading followed by another heading is a country
        if(filter) return;
        const country=ents[i+1] && !Array.isArray(ents[i+1]);
        rows+=`<div class="sub-h${country?' country':''}">${esc(lang==='ua'&&it.ua?it.ua:it.h)}</div>`; return;
      }
      if(filter && !(it.slice(0,5).concat(it[6]||'',it[7]||'').join(' ').toLowerCase().includes(query))) return;
      n++;
      rows+=`<button class="item" type="button" data-c="${cat.id}" data-i="${i}"><span class="nm">${nameHtml(it[LI()],it[5])}</span><span class="pr">${esc(it[2])}</span>${it[3+LI()]?`<span class="ds">${hi(it[3+LI()])}</span>`:''}</button>`;
    });
    if(!n) return; total+=n;
    const title=cat[lang==='ua'?'ua':'en'], k=KANJI[cat.id]||'';
    rail+=`<a href="#" data-id="${cat.id}">${k?`<span class="k" aria-hidden="true">${k}</span>`:''}<span class="t">${esc(title)}</span></a>`;
    html+=`<section class="cat" id="c-${cat.id}"><div class="cat-h">${k?`<span class="k${k.length>2?' long':''}" aria-hidden="true">${k}</span>`:''}<h2>${hi(title)}</h2></div>${rows}</section>`;
  });
  document.getElementById('list').innerHTML=total?html:`<div class="empty">${u.none}</div>`;
  document.getElementById('rail').innerHTML=rail;
  document.querySelector('#rail a')?.classList.add('active'); // first category is active until the reader scrolls
  requestAnimationFrame(railEdge);
  spy();
}

/* routing: #menu #bar #tea #wine, empty = home */
function route(){
  const h=location.hash.slice(1);
  const key=SECTIONS.some(s=>s.key===h)?h:null;
  document.getElementById('home').hidden=!!key; document.getElementById('screen').hidden=!key;
  closeSheet();
  if(key){ if(key!==cur){cur=key; query=''; document.getElementById('q').value='';}
    renderList(); const sc=document.getElementById('screen'); sc.classList.remove('view'); void sc.offsetWidth; sc.classList.add('view'); scrollTo({top:0}); }
  else { cur=null; const hm=document.getElementById('home'); hm.classList.remove('view'); void hm.offsetWidth; hm.classList.add('view'); }
}
addEventListener('hashchange',route);
document.getElementById('back').addEventListener('click',()=>{ location.hash=''; });

/* scroll spy: highlights the category being read. While the page is scrolling to a category the
   reader tapped, the spy is paused so the categories passed on the way do not flash one by one. */
let io, spyPaused=false, spyTimer=0;
function setActive(id){
  document.querySelectorAll('#rail a').forEach(a=>{const on=a.dataset.id===id; a.classList.toggle('active',on);
    if(on) a.scrollIntoView({inline:'center',block:'nearest',behavior:'smooth'});});
}
function spy(){ io&&io.disconnect();
  io=new IntersectionObserver(es=>{ if(spyPaused) return;
    es.forEach(e=>{ if(e.isIntersecting) setActive(e.target.id.slice(2)); }); },{rootMargin:'-130px 0px -65% 0px'});
  document.querySelectorAll('section.cat').forEach(s=>io.observe(s)); }
function resumeSpyWhenStill(){ // resume once scrolling has been quiet for a moment (or after a safety limit)
  clearTimeout(spyTimer); spyTimer=setTimeout(()=>{ spyPaused=false; removeEventListener('scroll',resumeSpyWhenStill); },180);
}
// right-edge fade only while there is more rail to scroll to
const railEl=document.getElementById('rail');
function railEdge(){ railEl.classList.toggle('at-end', railEl.scrollLeft+railEl.clientWidth >= railEl.scrollWidth-2); }
railEl.addEventListener('scroll',railEdge,{passive:true}); addEventListener('resize',railEdge);
railEl.addEventListener('click',e=>{const a=e.target.closest('a'); if(!a) return; e.preventDefault();
  setActive(a.dataset.id);                 // highlight the tapped category right away
  spyPaused=true; addEventListener('scroll',resumeSpyWhenStill,{passive:true}); resumeSpyWhenStill();
  setTimeout(()=>{ if(spyPaused){ spyPaused=false; removeEventListener('scroll',resumeSpyWhenStill);} },2500);
  document.getElementById('c-'+a.dataset.id).scrollIntoView({behavior:'smooth'});});

/* controls */
document.getElementById('q').addEventListener('input',e=>{query=e.target.value.trim().toLowerCase(); renderList();});
document.querySelectorAll('[data-lang]').forEach(b=>b.addEventListener('click',()=>{ lang=b.dataset.lang; try{localStorage.setItem('azuma-lang',lang);}catch(e){} renderChrome(); if(cur) renderList(); }));

/* sheet */
const sheet=document.getElementById('sheet'), scrim=document.getElementById('scrim');
document.getElementById('list').addEventListener('click',e=>{
  const b=e.target.closest('.item'); if(!b) return;
  const cat=DATA[cur].find(c=>c.id===b.dataset.c), it=cat.items[+b.dataset.i], u=UI[lang], k=KANJI[cat.id]||'';
  // category line above the name (kanji + category), and a large vertical kanji watermark when there is no photo
  document.getElementById('sCat').innerHTML=(k?`<span class="k">${k}</span>`:'')+esc(cat[lang==='ua'?'ua':'en']);
  const wm=document.getElementById('sWm'); wm.textContent=k;
  wm.style.fontSize=(k.length<=2?84:k.length===3?60:46)+'px'; // long marks (日本酒, 竜舌蘭) shrink so the column fits the sheet
  document.getElementById('sName').textContent=it[LI()];
  document.getElementById('sDesc').textContent=it[3+LI()]||'';
  document.getElementById('sOpts').innerHTML=optsHtml(it);
  document.getElementById('sLong').textContent=it[6+LI()]||'';
  document.getElementById('sPrice').textContent=`${it[2]} ${u.cur}`;
  document.getElementById('sTag').innerHTML=it[5]?ICON[it[5]]+(it[5]===2?u.tagH:u.tagM):'';
  // dish photo when there is one; no photo block at all otherwise (bar, tea, wine have none)
  const ph=document.getElementById('sPhoto'), src=it[8]||'';
  ph.hidden=!src; ph.innerHTML=src?`<img src="${src}" alt="" decoding="async">`:'';
  sheet.classList.toggle('nophoto',!src);
  sheet.classList.add('on'); scrim.classList.add('on'); lockScroll();
});
function closeSheet(){ sheet.classList.remove('on'); scrim.classList.remove('on'); sheet.style.transform=''; scrim.style.opacity=''; unlockScroll(); }

// the page behind an open sheet does not scroll (body pinned in place, works on iOS too) and returns to the same spot
let lockedY=null;
function lockScroll(){ if(lockedY!==null) return; lockedY=scrollY;
  Object.assign(document.body.style,{position:'fixed',top:`-${lockedY}px`,left:'0',right:'0',width:'100%'}); }
function unlockScroll(){ if(lockedY===null) return; const y=lockedY; lockedY=null;
  Object.assign(document.body.style,{position:'',top:'',left:'',right:'',width:''}); scrollTo(0,y); }

// close by tapping outside, Escape, or swiping the sheet down (it follows the finger, the backdrop fades with it)
scrim.addEventListener('click',closeSheet);
addEventListener('keydown',e=>{ if(e.key==='Escape'){ closeSheet(); endIntro(); } });
let y0=null, t0=0, dy=0;
sheet.addEventListener('touchstart',e=>{ y0=e.touches[0].clientY; t0=Date.now(); dy=0; sheet.style.transition='none'; },{passive:true});
sheet.addEventListener('touchmove',e=>{ if(y0===null) return; dy=Math.max(0,e.touches[0].clientY-y0);
  sheet.style.transform=`translateY(${dy}px)`; scrim.style.opacity=String(Math.max(0,1-dy/(sheet.offsetHeight||1))); },{passive:true});
sheet.addEventListener('touchend',()=>{ if(y0===null) return;
  const fast=dy>40 && dy/(Date.now()-t0)>.5;          // a quick flick also closes
  sheet.style.transition=''; y0=null;
  if(dy>110 || fast) closeSheet(); else { sheet.style.transform=''; scrim.style.opacity=''; } });
// touches on the dimmed backdrop never scroll the page
scrim.addEventListener('touchmove',e=>e.preventDefault(),{passive:false});

renderChrome(); route(); playIntroOnce();

/* footer: tap the Wi-Fi row to copy the password; the label briefly confirms it */
(function wifiCopy(){
  const btn=document.getElementById('wifiCopy'); if(!btn) return;
  const lab=btn.querySelector('.lab'), pass=btn.dataset.copy;
  function fallback(){ const t=document.createElement('textarea'); t.value=pass; t.setAttribute('readonly','');
    t.style.cssText='position:fixed;opacity:0;top:0;left:0'; document.body.appendChild(t); t.select();
    let ok=false; try{ ok=document.execCommand('copy'); }catch(e){} t.remove(); return ok; }
  function done(){ lab.textContent=UI[lang].copied; btn.classList.add('copied');
    clearTimeout(done.t); done.t=setTimeout(()=>{ lab.textContent='Wi-Fi'; btn.classList.remove('copied'); },1600); }
  btn.addEventListener('click',()=>{
    if(navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(pass).then(done,()=>{ if(fallback()) done(); });
    else if(fallback()) done();
  });
})();
