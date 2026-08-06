/* ===== 双栏方格矩阵 / 今日液体容器 =====
   核心策略：
   - 方格 DOM 按需创建（ensureCells），布局变化时只增不删，避免闪烁
   - align-content:start 让方格从顶部填充，paintBox 从索引 0 开始染色
   - rebuild(refreshAll)：refreshAll=true 时刷新颜色（主题/配色变化） */
window.App = window.App || {};
(function(A){
  "use strict";
  const {$,lerpC}=A.util, {SCHEMES,SCHEME_DONE,state}=A;
  const GAP=4;

  const boxes={
    today:{el:$("todayGrid"),cells:[],colors:[],size:30,lastFilled:0,lastPartial:-1,key:"cellToday",liquid:null,liquidSvg:null,fluidInst:null},
    total:{el:$("totalGrid"),cells:[],colors:[],size:20,lastFilled:0,lastPartial:-1,key:"cellTotal",liquid:null,liquidSvg:null}
  };

  function palette(){
    const done=document.documentElement.classList.contains("done");
    const sch=SCHEMES[state.scheme]||SCHEMES.aurora;
    if(done)return SCHEME_DONE[state.theme]||SCHEME_DONE.dark;
    return sch[state.theme]||sch.dark;
  }
  /* 流体配色：开启自定义时用 hex，否则默认底/顶均纯白（接近透明，仅靠光照与折射显形） */
  function fluidPalette(){
    if(state.fluidCustom){
      const hex2rgb=h=>{
        const n=parseInt(h.slice(1),16);
        return [(n>>16)&255,(n>>8)&255,n&255];
      };
      return [hex2rgb(state.fluidC1),hex2rgb(state.fluidC2)];
    }
    return [[255,255,255],[255,255,255]];
  }

  function applyAccents(){
    const [c1,c2]=palette();
    const toRGB=a=>`rgb(${a[0]},${a[1]},${a[2]})`;
    const root=document.documentElement;
    root.style.setProperty("--num1",toRGB(c1));
    root.style.setProperty("--num2",toRGB(c2));
    root.style.setProperty("--today1",toRGB(c1));
    root.style.setProperty("--today2",toRGB(c2));
    /* 同步 WebGL 流体颜色（自定义或配色方案） */
    if(boxes.today.fluidInst){
      const [fc1,fc2]=fluidPalette();
      boxes.today.fluidInst.setColors(fc1,fc2);
    }
  }

  /* ===== 今日样式统一切换：grid / liquid(SVG) / fluid(浅水方程) / particles(GPU粒子) =====
     各模式互斥，切换时清理上一模式的资源（DOM/SVG/canvas/RAF）。 */
  function applyTodayStyle(){
    const box=boxes.today, st=state.todayStyle;
    /* 清理 fluid / particles（WebGL 实例） */
    if(box.fluidInst){box.fluidInst.destroy();box.fluidInst=null}
    box.el.classList.remove("liquid-mode","fluid-mode","particles-mode");
    /* 非方格模式隐藏 .cell */
    const hideCells = st!=="grid";
    /* liquid：SVG 波浪 */
    if(st==="liquid"){buildLiquid(box)}
    else{removeLiquid(box)}
    /* fluid / particles：创建 WebGL 实例（粒子模式可叠加烤鸡） */
    if((st==="fluid"||st==="particles")&&A.fluid){
      const isParticle = st==="particles";
      const Cls = isParticle?A.fluid.ParticleFluid:A.fluid.HeightFieldFluid;
      box.el.classList.add(isParticle?"particles-mode":"fluid-mode");
      const inst=new Cls(box.el, isParticle && state.toastMode);
      if(!inst._fail){
        inst.resize();
        const [fc1,fc2]=fluidPalette();
        inst.setColors(fc1,fc2);
        inst.setProgress(box._lastE||0);
        if(inst.setBackground)inst.setBackground(state.bg||null, state.bgBlur||0, (state.bgDim||0)/100);
        inst.start();
        box.fluidInst=inst;
      }
    }
    /* 烤鸡模式 CPU 压力测试：粒子模式 + 烤鸡开启时启动 4 线程圆周率计算 */
    if(A.toastCpu)A.toastCpu.set(st==="particles" && state.toastMode);
    /* 方格显隐 */
    for(const c of box.cells)c.style.display=hideCells?"none":"";
  }

  function autoSize(box){
    const w=box.el.clientWidth,h=box.el.clientHeight;
    for(const s of [16,20,24,28,34,40]){
      const c=Math.floor((w+GAP)/(s+GAP)),r=Math.floor((h+GAP)/(s+GAP));
      if(c>0&&r>0&&c*r<=2000)return s;
    }
    return 40;
  }

  /* 计算当前可见方格数 */
  function getVisibleN(box){
    const size=box.size||28;
    const w=box.el.clientWidth,h=box.el.clientHeight;
    const cols=Math.max(1,Math.floor((w+GAP)/(size+GAP)));
    const rows=Math.max(1,Math.floor((h+GAP)/(size+GAP)));
    return cols*rows;
  }

  /* 按需创建方格 DOM（只增不删，避免布局动画时闪烁） */
  function ensureCells(box){
    const needed=getVisibleN(box)+10;
    /* 今日框在非方格模式（液体/流体/粒子）下新建的方格也应隐藏，
       否则调整方格大小或变更布局后新创建的 .cell 会露出来 */
    const hideNew=(box===boxes.today)&&state.todayStyle!=="grid";
    while(box.cells.length<needed){
      const d=document.createElement("div");
      d.className="cell";
      if(hideNew)d.style.display="none";
      box.el.appendChild(d);
      box.cells.push(d);
    }
  }

  /* 更新方格尺寸 CSS */
  function updateBoxStyle(box){
    const preferred=state[box.key];
    const size=(preferred&&preferred>0)?preferred:autoSize(box);
    box.size=size;
    const host=box.el;
    host.style.setProperty("--cell",size+"px");
    host.style.setProperty("--gap",GAP+"px");
    host.style.setProperty("--radius",Math.max(2,Math.round(size*0.18))+"px");
    host.style.gridTemplateColumns=`repeat(auto-fill, ${size}px)`;
  }

  /* 重新生成颜色数组（配色/主题变化或方格数变化时） */
  function regenColors(box){
    const [c1,c2]=palette();
    const n=box.cells.length;
    box.colors.length=0;
    for(let i=0;i<n;i++){
      box.colors.push(lerpC(c1,c2,n>1?i/(n-1):0));
    }
    /* 清空所有方格背景，强制完整重绘 */
    for(let i=0;i<n;i++)box.cells[i].style.background="";
    box.lastFilled=0;box.lastPartial=-1;
  }

  function paintBox(box,e){
    if(!box.cells.length)return;
    const visibleN=getVisibleN(box);
    const f=Math.min(1,Math.max(0,e))*visibleN;
    const filled=Math.min(box.cells.length,Math.floor(f));
    const frac=f-filled;
    const cells=box.cells,colors=box.colors,n=cells.length;
    if(filled>box.lastFilled){
      for(let i=box.lastFilled;i<filled;i++)cells[i].style.background=colors[i];
    }else if(filled<box.lastFilled){
      for(let i=filled;i<box.lastFilled;i++)cells[i].style.background="";
    }
    if(box.lastPartial>=0&&box.lastPartial<n&&box.lastPartial!==filled){
      cells[box.lastPartial].style.background=box.lastPartial<filled?colors[box.lastPartial]:"";
    }
    if(filled<visibleN&&filled<n){
      const p=(frac*100).toFixed(2);
      cells[filled].style.background=`linear-gradient(to top, ${colors[filled]} ${p}%, transparent ${p}%)`;
    }
    box.lastFilled=filled;box.lastPartial=filled<visibleN?filled:-1;
  }

  /* ===== 今日液体容器（流体化：液体在玻璃背景内流动，无独立边框） =====
     参考经典 liquid wave loader：
     - 三层波浪视差（远/中/近），不同速度、振幅、透明度
     - 复合正弦波（基频 + 倍频分量），告别单调正弦
     - 水面高光线（沿液面的细亮带 + 柔化），模拟水面反光
     - 容器顶部柔光，模拟玻璃顶部的环境光反射
     - 平移距离 = 波浪周期 (200)，无缝循环；路径覆盖 -300..700 杜绝露边 */
  function buildLiquid(box){
    const host=box.el;
    host.classList.add("liquid-mode");
    if(!box.liquidSvg){
      const svgNS="http://www.w3.org/2000/svg";
      const svg=document.createElementNS(svgNS,"svg");
      svg.setAttribute("class","liq-vessel-svg");
      svg.setAttribute("viewBox","0 0 400 400");
      svg.setAttribute("preserveAspectRatio","none");
      svg.setAttribute("aria-hidden","true");
      svg.innerHTML=
        '<defs>'+
          /* 液体深度渐变：底部 num1 → 表面 num2 */
          '<linearGradient id="liqGrad" gradientUnits="userSpaceOnUse" x1="0" y1="400" x2="0" y2="0">'+
            '<stop class="lg1" offset="0"/>'+
            '<stop class="lg2" offset="1"/>'+
          '</linearGradient>'+
          /* 水面高光：沿液面垂直方向的细亮带 */
          '<linearGradient id="liqShine" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="1">'+
            '<stop offset="0" stop-color="rgba(255,255,255,0.85)"/>'+
            '<stop offset="1" stop-color="rgba(255,255,255,0)"/>'+
          '</linearGradient>'+
          /* 容器顶部环境光反射 */
          '<linearGradient id="liqTopGlow" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="1">'+
            '<stop offset="0" stop-color="rgba(255,255,255,0.20)"/>'+
            '<stop offset="1" stop-color="rgba(255,255,255,0)"/>'+
          '</linearGradient>'+
          /* 高光线柔化滤镜 */
          '<filter id="liqSoft" x="-5%" y="-50%" width="110%" height="200%">'+
            '<feGaussianBlur stdDeviation="1.4"/>'+
          '</filter>'+
        '</defs>'+
        /* 顶部柔光带（不参与平移，固定在容器顶部） */
        '<rect x="0" y="0" width="400" height="48" fill="url(#liqTopGlow)" opacity="0.55"/>'+
        '<g id="liqLevel">'+
          /* 三层波浪：远（深慢大）→ 中 → 近（浅快小），营造深度视差 */
          '<g class="liq-wave back"><path id="liqWaveBack"/></g>'+
          '<g class="liq-wave mid"><path id="liqWaveMid"/></g>'+
          '<g class="liq-wave front"><path id="liqWaveFront"/></g>'+
          /* 水面高光线：跟随前波，模拟液面反光 */
          '<path id="liqShineLine" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="1.4" vector-effect="non-scaling-stroke" filter="url(#liqSoft)"/>'+
        '</g>';
      box.liquidSvg=svg;
    }
    if(!host.contains(box.liquidSvg))host.appendChild(box.liquidSvg);
    box.liquid={surfaceY:394,lastSurface:-1};
  }
  function removeLiquid(box){
    box.el.classList.remove("liquid-mode");
    box.liquid=null;
    if(box.liquidSvg){box.liquidSvg.remove();box.liquidSvg=null}
  }
  function paintLiquid(box,e){
    if(!box.liquid)return;
    const remain=1-Math.min(1,Math.max(0,e));
    const surfaceY=394-remain*384;
    if(Math.abs(surfaceY-box.liquid.lastSurface)<0.2)return;
    box.liquid.lastSurface=surfaceY;
    const f=$("liqWaveFront"),m=$("liqWaveMid"),b=$("liqWaveBack"),s=$("liqShineLine");
    if(f&&m&&b){
      /* 每层独立波形：振幅 / 相位 / 倍频分量不同，叠加后接近真实水面 */
      b.setAttribute("d",liqWavePath(surfaceY,5.8,0,   [0.55,0.30],[0,55]));   /* 远：大波慢 */
      m.setAttribute("d",liqWavePath(surfaceY,4.2,30,  [0.70,0.40],[18,80]));  /* 中 */
      f.setAttribute("d",liqWavePath(surfaceY,2.6,60,  [0.90,0.55],[35,110])); /* 近：小波快 */
      if(s) s.setAttribute("d",liqShinePath(surfaceY,2.6,60,[0.90,0.55],[35,110]));
    }
  }
  /* 复合正弦波：主波 + 多个倍频分量，告别单调正弦
     amps/phases 为倍频分量参数（频率倍数 = i+2） */
  function liqWavePath(surfaceY,amp,phase,amps,phases){
    const baseHz=Math.PI/100; /* 基频周期 200，与 CSS 平移 -200px 对齐 */
    let d=`M -300 ${(surfaceY).toFixed(2)}`;
    for(let x=-300;x<=700;x+=8){
      let y=surfaceY+Math.sin((x+phase)*baseHz)*amp;
      if(amps&&phases){
        for(let i=0;i<amps.length;i++){
          y+=Math.sin((x+phases[i])*baseHz*(i+2))*amp*amps[i];
        }
      }
      d+=` L ${x.toFixed(1)} ${y.toFixed(2)}`;
    }
    d+=` L 700 400 L -300 400 Z`;
    return d;
  }
  /* 水面高光路径：沿液面绘制一条略上浮的细线（不闭合） */
  function liqShinePath(surfaceY,amp,phase,amps,phases){
    const baseHz=Math.PI/100;
    let d=`M -300 ${(surfaceY-1.6).toFixed(2)}`;
    for(let x=-300;x<=700;x+=8){
      let y=surfaceY-1.6+Math.sin((x+phase)*baseHz)*amp;
      if(amps&&phases){
        for(let i=0;i<amps.length;i++){
          y+=Math.sin((x+phases[i])*baseHz*(i+2))*amp*amps[i];
        }
      }
      d+=` L ${x.toFixed(1)} ${y.toFixed(2)}`;
    }
    return d;
  }

  function buildAll(){
    for(const k in boxes){
      ensureCells(boxes[k]);
      updateBoxStyle(boxes[k]);
      regenColors(boxes[k]);
    }
    applyTodayStyle();
    if(A.tick)A.tick();
  }

  /* rebuild：更新 CSS + 确保方格数 + 刷新颜色（refreshAll=true 时）
     - 主题/配色变化：rebuild(true) → 重新生成颜色 + 清空背景 + tick 重绘
     - 布局/尺寸变化：rebuild() → 只更新 CSS，tick 重绘新的可见方格
     - refreshAll=true 时重建流体实例（主题切换后刷新 WebGL 颜色） */
  function rebuild(refreshAll){
    for(const k in boxes){
      const box=boxes[k];
      ensureCells(box);
      updateBoxStyle(box);
      if(refreshAll||box.colors.length!==box.cells.length){
        regenColors(box);
      }
    }
    /* 主题/配色变化需重建流体（颜色 + 重置），布局变化只需 resize */
    if(refreshAll){applyTodayStyle()}
    else if(boxes.today.fluidInst){boxes.today.fluidInst.resize()}
    if(A.tick)A.tick();
  }

  function paint(todayE,totalE){
    const st=state.todayStyle;
    boxes.today._lastE=todayE;
    if(st==="liquid")paintLiquid(boxes.today,todayE);
    else if(st==="fluid"||st==="particles"){
      if(boxes.today.fluidInst)boxes.today.fluidInst.setProgress(todayE);
    }
    else paintBox(boxes.today,todayE);
    paintBox(boxes.total,totalE);
  }
  /* 仅刷新颜色（配色/主题色编辑用）：重新生成方格颜色 + 重绘 + 同步流体颜色，
     不重建流体实例，避免拖动取色器时频繁销毁/重建 WebGL 造成的卡顿与闪烁。 */
  function refreshColors(){
    for(const k in boxes){
      regenColors(boxes[k]);
    }
    applyAccents();
    if(A.tick)A.tick();
  }

  let rTimer=null;
  addEventListener("resize",()=>{
    clearTimeout(rTimer);
    rTimer=setTimeout(()=>{rebuild()},200);
  });

  A.grid={boxes,palette,applyAccents,buildAll,updateBoxStyle,paint,paintBox,rebuild,applyTodayStyle,refreshColors};
})(window.App);