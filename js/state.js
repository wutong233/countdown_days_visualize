/* ===== 状态管理 ===== */
window.App = window.App || {};
(function(A){
  "use strict";
  const DAY=86400000, KEY="countdown-page-v5";

  const $=id=>document.getElementById(id);
  const pad=n=>String(n).padStart(2,"0");
  const fmtInput=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const parseInput=s=>{const p=s.split("-").map(Number);return new Date(p[0],p[1]-1,p[2])};
  const clamp01=x=>Math.min(1,Math.max(0,x));
  const hms=ms=>{const s=Math.floor(Math.max(0,ms)/1000);return `${pad(Math.floor(s/3600))}:${pad(Math.floor(s/60)%60)}:${pad(s%60)}`};

  /* 配色方案：每种方案在三种主题下的双色 [start,end]
     参考Tailwind调色板，保留默认蓝色（极光），其余替换为协调美观的方案。 */
  const SCHEMES={
    aurora  :{label:"极光",dark:[[56,189,248],[129,140,248]],oled:[[34,211,238],[167,139,250]],light:[[2,132,199],[79,70,229]]},
    twilight:{label:"暮光",dark:[[167,139,250],[232,121,249]],oled:[[196,181,253],[240,171,252]],light:[[124,58,237],[217,70,239]]},
    ember   :{label:"余烬",dark:[[251,191,36],[251,113,133]],oled:[[252,211,77],[251,113,133]],light:[[217,119,6],[225,29,72]]},
    mint    :{label:"薄荷",dark:[[52,211,153],[45,212,191]],oled:[[52,211,153],[94,234,212]],light:[[5,150,105],[13,148,136]]},
    graphite:{label:"石墨",dark:[[148,163,184],[100,116,139]],oled:[[203,213,225],[148,163,184]],light:[[71,85,105],[51,65,85]]}
  };
  const SCHEME_DONE={dark:[[251,191,36],[251,113,133]],oled:[[252,211,77],[251,113,133]],light:[[217,119,6],[225,29,72]]};

  const lerpC=(a,b,t)=>`rgb(${Math.round(a[0]+(b[0]-a[0])*t)},${Math.round(a[1]+(b[1]-a[1])*t)},${Math.round(a[2]+(b[2]-a[2])*t)})`;

  function defaults(){
    const t=new Date();
    return{
      name:"",
      start:fmtInput(t),
      target:fmtInput(new Date(t.getTime()+30*DAY)),
      theme:"light",
      scheme:"aurora",
      antiBurn:false,
      burnInterval:28,
      layout:"left-big",
      cellToday:30,
      cellTotal:30,
      todayStyle:"grid", /* grid | liquid | fluid | particles */
      toastMode:false, /* 烤鸡模式：仅粒子模式下生效，极致负载压力测试 */
      fluidCustom:false, /* 自定义流体颜色开关 */
      fluidC1:"#ffffff", /* 流体底部色（纯白） */
      fluidC2:"#d6edff", /* 流体表面色（214,237,255） */
      bg:"",
      bgBlur:0,
      bgDim:0,
      customSchemes:{} /* 用户自定义配色覆盖：{ schemeKey: { theme: [[r,g,b],[r,g,b]] } } */
    };
  }

  function load(){
    let saved=null;
    try{saved=JSON.parse(localStorage.getItem(KEY))}catch(e){}
    saved=saved||{};
    /* 迁移旧版单一 cellSize → 分离参数 */
    if(saved.cellSize!=null && saved.cellToday==null){saved.cellToday=saved.cellSize;saved.cellTotal=saved.cellSize}
    /* 迁移：方格大小下限提升到 9px，旧值 0(自动)/<9 重置为默认 30 */
    if(saved.cellToday!=null && saved.cellToday<9)saved.cellToday=30;
    if(saved.cellTotal!=null && saved.cellTotal<9)saved.cellTotal=30;
    const s=Object.assign(defaults(),saved);
    /* 应用用户自定义配色覆盖到 SCHEMES */
    applyCustomSchemes(s);
    return s;
  }
  function persist(s){localStorage.setItem(KEY,JSON.stringify(s))}

  /* SCHEMES 原始默认副本（深拷贝），用于重置自定义配色 */
  const SCHEMES_DEFAULT=JSON.parse(JSON.stringify(SCHEMES));
  /* 把 state.customSchemes 中的覆盖应用到内存 SCHEMES */
  function applyCustomSchemes(s){
    const cs=s.customSchemes||{};
    for(const key in cs){
      if(!SCHEMES[key])continue;
      for(const theme in cs[key]){
        const pair=cs[key][theme];
        if(pair&&pair.length===2&&pair[0]&&pair[1]){
          SCHEMES[key][theme]=[pair[0].slice(),pair[1].slice()];
        }
      }
    }
  }
  /* 重置指定方案为默认 */
  function resetScheme(key){
    if(!SCHEMES_DEFAULT[key])return;
    SCHEMES[key]=JSON.parse(JSON.stringify(SCHEMES_DEFAULT[key]));
  }

  A.util={$,pad,fmtInput,parseInput,clamp01,hms,lerpC,DAY,KEY};
  A.SCHEMES=SCHEMES;
  A.SCHEMES_DEFAULT=SCHEMES_DEFAULT;
  A.SCHEME_DONE=SCHEME_DONE;
  A.applyCustomSchemes=applyCustomSchemes;
  A.resetScheme=resetScheme;
  A.state=load();
  A.snapshot=null;
  A.defaults=defaults;
  A.persist=persist;
  A.takeSnapshot=()=>{A.snapshot=JSON.parse(JSON.stringify(A.state))};
  A.restoreSnapshot=()=>{if(A.snapshot)Object.assign(A.state,A.snapshot)};
})(window.App);