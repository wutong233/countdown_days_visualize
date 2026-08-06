/* ===== 主入口：应用函数、主题、全屏、防烧屏、快捷键、初始化 ===== */
window.App = window.App || {};
(function(A){
  "use strict";
  const {$}=A.util, {state,persist,util}=A;
  const {fmtInput}=util;

  const THEME_LABEL={light:"日间",dark:"暗色",oled:"OLED"};

  /* ---------- 应用函数（供面板实时预览与初始化调用） ---------- */
  const apply={
    theme(){
      document.documentElement.dataset.theme=state.theme;
      $("icoSun").style.display=state.theme==="light"?"":"none";
      $("icoMoon").style.display=state.theme==="dark"?"":"none";
      $("icoOled").style.display=state.theme==="oled"?"":"none";
      $("btnTheme").title=`主题：${THEME_LABEL[state.theme]}（点击切换，快捷键 T）`;
      A.grid.applyAccents();
      A.grid.rebuild(true);
    },
    scheme(){
      A.grid.applyAccents();
      A.grid.rebuild(true);
    },
    layout(){
      /* 瞬时设置（用于初始化/恢复快照），不动画 */
      curRatio = state.layout==="right-big"?1:(state.layout==="half"?0.5:0);
      setSplit(curRatio);
      document.documentElement.dataset.layout=state.layout;
      A.grid.rebuild();
    },
    dates(){
      A.tick();
    },
    background(){
      const layer=$("bgLayer"),dim=$("bgDim");
      if(state.bg){
        layer.style.backgroundImage=`url(${state.bg})`;
        layer.style.filter=state.bgBlur>0?`blur(${state.bgBlur}px)`:"";
        layer.classList.add("on");
        dim.style.background=`rgba(0,0,0,${state.bgDim/100})`;
      }else{
        layer.style.backgroundImage="";
        layer.classList.remove("on");
        dim.style.background="rgba(0,0,0,0)";
      }
      /* 同步背景图 + 模糊 + 压暗到粒子流体（用于液面折射） */
      const pf=A.grid?.boxes?.today?.fluidInst;
      if(pf&&pf.setBackground)pf.setBackground(state.bg||null, state.bgBlur||0, (state.bgDim||0)/100);
    },
    antiBurn(){
      restartBurn();
    },
    all(){
      apply.theme();
      apply.layout();
      apply.background();
      apply.antiBurn();
      A.panel.syncInputs();
      A.tick();
    }
  };
  A.apply=apply;

  /* ---------- 烤鸡模式 CPU 压力测试：多线程循环计算圆周率 ----------
     与 GPU 压力（ParticleFluid 烤鸡参数）互补。烤鸡模式开启时自动启动，
     关闭时终止所有 Worker。使用 Blob URL 内联创建 Worker，无需额外文件。
     - Worker 数取 navigator.hardwareConcurrency-3（留余量给主线程/GPU/系统）。
     - 负载控制：每轮计算后测量耗时，插入 25% 空闲（目标 80% CPU 占用）。
       用 setTimeout 实现，因每轮计算耗时远超 4ms 钳制阈值，精度足够。 */
  A.toastCpu=(function(){
    let workers=[], blobUrl=null;
    /* Worker 源码：收到 "start" 后进入循环，每轮用 Leibniz 级数计算 5000 万次累加，
       测量本轮耗时后插入 25% 空闲时间（目标 80% CPU 占用），再继续下一轮。
       计算耗时 / (计算耗时 + 空闲) = 0.8 → 空闲 = 计算耗时 × 0.25。 */
    const workerSrc=[
      "self.onmessage=function(e){",
      "  if(e.data!==\"start\")return;",
      "  let total=0;",
      "  function run(){",
      "    const t0=performance.now();",
      "    let pi=0;const N=50000000;",
      "    for(let i=0;i<N;i++){pi+=(i%2===0?1:-1)/(2*i+1);}",
      "    pi*=4;total++;",
      "    self.postMessage({iter:total,pi:pi});",
      "    const calcMs=performance.now()-t0;",
      "    const idleMs=calcMs*0.25;",
      "    setTimeout(run,idleMs);",
      "  }",
      "  run();",
      "};"
    ].join("\n");
    function start(){
      if(workers.length)return; /* 已启动 */
      if(!blobUrl){
        const blob=new Blob([workerSrc],{type:"application/javascript"});
        blobUrl=URL.createObjectURL(blob);
      }
      /* CPU 线程数留 4 个余量给主线程/GPU 驱动/系统，保证 GPU 渲染调度不被饿死。
         最少 1 个，保证仍有 CPU 压力。 */
      const count=Math.max(1,(navigator.hardwareConcurrency||8)-4);
      for(let i=0;i<count;i++){
        const w=new Worker(blobUrl);
        w.onerror=function(err){console.error("[toastCpu] Worker error:",err.message||err);};
        w.postMessage("start");
        workers.push(w);
      }
      console.log("[toastCpu] started "+count+" workers");
    }
    function stop(){
      workers.forEach(w=>w.terminate());
      workers=[];
      if(blobUrl){URL.revokeObjectURL(blobUrl);blobUrl=null;}
      console.log("[toastCpu] stopped");
    }
    function set(on){on?start():stop();}
    return {start,stop,set,isActive:()=>workers.length>0};
  })();

  /* ---------- 布局切换动画（rAF 驱动 --split-today / --split-total） ----------
     r=0   → 今日为主(left-big:  today 1fr    / total 0.55fr)
     r=0.5 → 各占一半(half:      today 0.775fr/ total 0.775fr，即 1:1)
     r=1   → 总进度为主(right-big: today 0.55fr/ total 1fr) */
  let curRatio=0, layoutAnim=null;
  function setSplit(r){
    const t=1-0.45*r, tot=0.55+0.45*r;
    const root=document.documentElement;
    root.style.setProperty("--split-today",t.toFixed(4)+"fr");
    root.style.setProperty("--split-total",tot.toFixed(4)+"fr");
  }
  function animateLayout(target){
    const targetR=target==="right-big"?1:(target==="half"?0.5:0);
    if(layoutAnim)cancelAnimationFrame(layoutAnim);
    const startR=curRatio,startT=performance.now(),dur=420;
    function step(now){
      const p=Math.min(1,(now-startT)/dur);
      const e=1-Math.pow(1-p,3); /* easeOutCubic */
      curRatio=startR+(targetR-startR)*e;
      setSplit(curRatio);
      /* 实时重绘方格（CSS auto-fill 自动重排，paint 更新填充比例） */
      if(A._lastE)A.grid.paint(A._lastE.today,A._lastE.total);
      if(p<1){layoutAnim=requestAnimationFrame(step)}
      else{
        layoutAnim=null;
        state.layout=target;
        curRatio=targetR;
        document.documentElement.dataset.layout=target;
        A.panel.syncInputs();
        persist(state);
        /* 布局宽度变化后重算方格：ensureCells 补足变宽一侧缺失的方格，
           autoSize 适配新尺寸，否则方格数量不会随分栏变化 */
        A.grid.rebuild();
      }
    }
    layoutAnim=requestAnimationFrame(step);
  }
  A.animateLayout=animateLayout;

  /* 点击中间分隔条循环切换三种布局：今日为主 → 各占一半 → 总进度为主 → … */
  $("drift").querySelector(".grid-divider").addEventListener("click",()=>{
    const order=["left-big","half","right-big"];
    const next=order[(order.indexOf(state.layout)+1)%order.length];
    animateLayout(next);
  });

  /* ---------- 主题切换按钮 ---------- */
  $("btnTheme").onclick=()=>{
    const order=["light","dark","oled"];
    state.theme=order[(order.indexOf(state.theme)+1)%3];
    apply.theme();
    A.panel.syncInputs();
    persist(state);
  };

  /* ---------- 防烧屏：缓慢随机位移 ---------- */
  const drift=$("drift");
  let burnTimer=null;
  function shiftNow(){
    const x=(Math.random()*16-8).toFixed(1),y=(Math.random()*16-8).toFixed(1);
    drift.style.transform=`translate(${x}px,${y}px)`;
  }
  function restartBurn(){
    clearTimeout(burnTimer);burnTimer=null;
    if(!state.antiBurn){drift.style.transform="";return}
    shiftNow();
    const iv=state.burnInterval*1000;
    if(iv>0)burnTimer=setInterval(shiftNow,iv);
  }

  /* ---------- 全屏 ---------- */
  function toggleFull(){
    if(document.fullscreenElement)document.exitFullscreen();
    else if(document.documentElement.requestFullscreen)document.documentElement.requestFullscreen();
  }
  $("btnFull").onclick=toggleFull;
  document.getElementById("todayGrid").addEventListener("dblclick",toggleFull);
  document.getElementById("totalGrid").addEventListener("dblclick",toggleFull);
  document.addEventListener("fullscreenchange",()=>{
    const fs=!!document.fullscreenElement;
    $("icoExpand").style.display=fs?"none":"";
    $("icoCollapse").style.display=fs?"":"none";
    if(!fs)document.body.classList.remove("idle");
    setTimeout(()=>A.grid.rebuild(),80);
  });

  /* 闲置隐藏界面 */
  let idleTimer=null;
  function poke(){
    document.body.classList.remove("idle");
    clearTimeout(idleTimer);
    if(document.fullscreenElement)idleTimer=setTimeout(()=>document.body.classList.add("idle"),3000);
  }
  ["mousemove","mousedown","keydown","touchstart"].forEach(ev=>addEventListener(ev,poke,{passive:true}));

  /* ---------- 快捷键 ---------- */
  addEventListener("keydown",e=>{
    if(e.target.closest("input,textarea"))return;
    const k=e.key.toLowerCase();
    if(k==="f")toggleFull();
    else if(k==="s")panel.classList.contains("open")?A.panel.closePanel():A.panel.openPanel();
    else if(k==="t")$("btnTheme").click();
    else if(k==="escape"){if(panel.classList.contains("open"))A.panel.closePanel()}
  });
  const panel=$("panel");

  $("btnSettings").onclick=A.panel.openPanel;

  /* ---------- 启动 ----------
     外部 CSS 异步加载，须等 load 后再读取布局尺寸，否则方格列数算错。 */
  function init(){
    A.panel.buildSchemeGrid();
    A.panel.bindLive();
    A.panel.bindActions();
    A.panel.bindCropper();
    apply.theme();
    apply.layout();
    apply.background();
    apply.antiBurn();
    A.grid.buildAll();
    A.tick();
    setInterval(A.tick,500);
    const saved=!!localStorage.getItem(A.util.KEY);
    if(!saved)A.panel.openPanel();
  }
  if(document.readyState==="complete")init();
  else window.addEventListener("load",init);
})(window.App);