/* ===== 设置面板（实时预览 + 自动保存） =====
   所有控件改动立即写入 state、应用到页面并持久化。 */
window.App = window.App || {};
(function(A){
  "use strict";
  const {$,parseInput}=A.util, {state,persist}=A;
  const panel=$("panel"),backdrop=$("backdrop");

  /* ---------- 打开/关闭 ---------- */
  /* _styleSnapshot：打开面板时记录的今日样式+烤鸡状态，关闭时对比是否变化，
     变化则在关闭后应用（避免面板内 GPU 重负载导致无法操作）。 */
  let _styleSnapshot="";
  function openPanel(){
    syncInputs();
    _styleSnapshot=state.todayStyle+"|"+state.toastMode;
    panel.classList.add("open");backdrop.classList.add("show");
  }
  function closePanel(){
    panel.classList.remove("open");backdrop.classList.remove("show");
    /* 今日样式或烤鸡状态在面板内被修改过：关闭面板 1 秒后再应用，
       让面板关闭动画完成、UI 平滑过渡，避免视觉突变。 */
    if(state.todayStyle+"|"+state.toastMode!==_styleSnapshot){
      setTimeout(()=>{A.grid.applyTodayStyle();},1000);
    }
  }

  /* 把当前 state 同步到控件 */
  function syncInputs(){
    $("inName").value=state.name;
    $("inStart").value=state.start;
    $("inTarget").value=state.target;
    $("inBurn").checked=state.antiBurn;
    $("inCellToday").value=state.cellToday||9;
    $("inCellTotal").value=state.cellTotal||9;
    $("inBurn").value=state.burnInterval;
    $("inBgBlur").value=state.bgBlur;
    $("inBgDim").value=state.bgDim;
    updateCellVal();
    updateBurnIntVal();
    updateBgVals();
    syncBurnIntField();
    syncThemeSeg();
    syncLayoutSeg();
    syncSchemeGrid();
    syncSchemeEdit();
    syncBgPreview();
    syncTodayStyleSeg();
    syncFluidColorField();
    syncToastField();
  }
  /* 位移频率仅在开启防烧屏时显示 */
  function syncBurnIntField(){
    $("burnIntField").style.display=state.antiBurn?"":"none";
  }
  function syncThemeSeg(){
    document.querySelectorAll("#segTheme button").forEach(b=>b.classList.toggle("active",b.dataset.theme===state.theme));
  }
  function syncLayoutSeg(){
    document.querySelectorAll("#segLayout button").forEach(b=>b.classList.toggle("active",b.dataset.layout===state.layout));
  }
  /* 今日进度样式分段（方格/波浪/流体/粒子） */
  function syncTodayStyleSeg(){
    document.querySelectorAll("#segTodayStyle button").forEach(b=>b.classList.toggle("active",b.dataset.style===state.todayStyle));
  }
  /* 流体颜色字段：仅在流体/粒子模式显示；自定义开关控制颜色选择器显隐 */
  function syncFluidColorField(){
    const isFluid = state.todayStyle==="fluid"||state.todayStyle==="particles";
    $("fluidColorField").style.display = isFluid ? "" : "none";
    $("inFluidCustom").checked = state.fluidCustom;
    $("fluidColors").style.display = state.fluidCustom ? "" : "none";
    $("inFluidC1").value = state.fluidC1;
    $("inFluidC2").value = state.fluidC2;
  }
  /* 烤鸡模式开关：仅在粒子模式下显示 */
  function syncToastField(){
    $("toastField").style.display = state.todayStyle==="particles" ? "" : "none";
    $("inToast").checked = state.toastMode;
  }

  /* ---------- 配色方案选择 ---------- */
  function buildSchemeGrid(){
    const host=$("schemeGrid");
    host.innerHTML="";
    Object.keys(A.SCHEMES).forEach(key=>{
      const s=A.SCHEMES[key];
      const opt=document.createElement("div");
      opt.className="scheme-opt";
      opt.dataset.scheme=key;
      const [c1,c2]=s[state.theme]||s.dark;
      const sw=document.createElement("div");
      sw.className="scheme-swatch";
      sw.style.background=`linear-gradient(135deg, rgb(${c1.join(",")}), rgb(${c2.join(",")}))`;
      const lab=document.createElement("span");
      lab.textContent=s.label;
      opt.appendChild(sw);opt.appendChild(lab);
      opt.onclick=()=>{
        state.scheme=key;
        A.apply.scheme();
        syncSchemeGrid();
        syncSchemeEdit();
        persist(state);
      };
      host.appendChild(opt);
    });
    syncSchemeGrid();
  }
  function syncSchemeGrid(){
    document.querySelectorAll(".scheme-opt").forEach(o=>o.classList.toggle("active",o.dataset.scheme===state.scheme));
  }
  /* 配色方案主题色编辑：编辑当前方案在当前主题下的 [c1,c2]，
     存入 state.customSchemes 并覆盖内存 SCHEMES，实时应用并持久化。 */
  const rgb2hex=a=>"#"+[a[0],a[1],a[2]].map(n=>Math.max(0,Math.min(255,Math.round(n))).toString(16).padStart(2,"0")).join("");
  const hex2rgb=h=>{const n=parseInt(h.slice(1),16);return [(n>>16)&255,(n>>8)&255,n&255]};
  function syncSchemeEdit(){
    const s=A.SCHEMES[state.scheme];if(!s)return;
    const [c1,c2]=s[state.theme]||s.dark;
    $("inSchemeC1").value=rgb2hex(c1);
    $("inSchemeC2").value=rgb2hex(c2);
  }
  function saveSchemeColors(){
    const c1=hex2rgb($("inSchemeC1").value), c2=hex2rgb($("inSchemeC2").value);
    A.SCHEMES[state.scheme][state.theme]=[c1.slice(),c2.slice()];
    if(!state.customSchemes)state.customSchemes={};
    if(!state.customSchemes[state.scheme])state.customSchemes[state.scheme]={};
    state.customSchemes[state.scheme][state.theme]=[c1.slice(),c2.slice()];
    /* 轻量刷新：更新 CSS 变量 + 流体颜色 + 方格颜色，不重建流体实例 */
    A.grid.refreshColors();
    /* 同步当前方案色块预览 */
    const opt=document.querySelector(`.scheme-opt[data-scheme="${state.scheme}"]`);
    if(opt){
      opt.querySelector(".scheme-swatch").style.background=`linear-gradient(135deg, rgb(${c1.join(",")}), rgb(${c2.join(",")}))`;
    }
    persist(state);
  }
  function resetSchemeColors(){
    A.resetScheme(state.scheme);
    if(state.customSchemes&&state.customSchemes[state.scheme]){
      delete state.customSchemes[state.scheme][state.theme];
      if(!Object.keys(state.customSchemes[state.scheme]).length)delete state.customSchemes[state.scheme];
    }
    A.grid.refreshColors();
    buildSchemeGrid();
    syncSchemeEdit();
    persist(state);
  }

  /* ---------- 数值标签 ---------- */
  function updateCellVal(){
    $("cellTodayVal").textContent=state.cellToday+"px";
    $("cellTotalVal").textContent=state.cellTotal+"px";
  }
  function updateBurnIntVal(){$("burnIntVal").textContent=state.burnInterval===0?"关闭":state.burnInterval+"s"}
  function updateBgVals(){$("bgBlurVal").textContent=state.bgBlur;$("bgDimVal").textContent=state.bgDim+"%"}

  /* ---------- 背景预览 ---------- */
  function syncBgPreview(){
    const p=$("bgPreview");
    if(state.bg){p.style.backgroundImage=`url(${state.bg})`}
    else p.style.backgroundImage="";
  }

  /* ---------- 图片选择 → 裁切弹窗 ---------- */
  function readFile(file){
    if(!file)return;
    const reader=new FileReader();
    reader.onload=e=>openCropper(e.target.result);
    reader.readAsDataURL(file);
  }

  /* ---------- 图片裁切弹窗 ----------
     默认比例 = 当前视口比例（背景层用 background-size:cover 铺满，
     故视口比例即为最贴合网页背景的裁切比例）。 */
  let cropState=null, cropAspect="page", drag=null;
  function currentRatio(){
    if(cropAspect==="free")return null;
    if(cropAspect==="page")return window.innerWidth/window.innerHeight;
    return parseFloat(cropAspect);
  }
  function updateRatioLockedClass(){
    $("cropModal").classList.toggle("ratio-locked",currentRatio()!==null);
  }
  function openCropper(dataUrl){
    cropAspect="page";
    document.querySelectorAll("#cropAspect button").forEach(b=>b.classList.toggle("active",b.dataset.ratio==="page"));
    updateRatioLockedClass();
    $("cropBackdrop").classList.add("show");
    $("cropModal").classList.add("show");
    const img=$("cropImg");
    img.onload=()=>requestAnimationFrame(()=>{
      const r=img.getBoundingClientRect();
      if(r.width&&r.height)initCrop(r.width,r.height);
    });
    img.src="";          /* 强制重新触发 onload（同图重选场景） */
    img.src=dataUrl;
  }
  function closeCropper(){
    $("cropBackdrop").classList.remove("show");
    $("cropModal").classList.remove("show");
    $("cropImg").src="";
    cropState=null;drag=null;
  }
  function initCrop(dispW,dispH){
    const ratio=currentRatio();
    let cw,ch;
    if(ratio){
      if(dispW/dispH>ratio){ch=dispH;cw=ch*ratio;}
      else{cw=dispW;ch=cw/ratio;}
    }else{cw=dispW;ch=dispH;}
    cw*=0.92;ch*=0.92;
    cropState={dispW,dispH,x:(dispW-cw)/2,y:(dispH-ch)/2,w:cw,h:ch};
    renderCrop();
  }
  function renderCrop(){
    if(!cropState)return;
    const r=$("cropRect");
    r.style.left=cropState.x+"px";
    r.style.top=cropState.y+"px";
    r.style.width=cropState.w+"px";
    r.style.height=cropState.h+"px";
  }
  function clampCrop(){
    const {dispW,dispH}=cropState,min=20;
    cropState.w=Math.max(min,Math.min(cropState.w,dispW));
    cropState.h=Math.max(min,Math.min(cropState.h,dispH));
    cropState.x=Math.max(0,Math.min(cropState.x,dispW-cropState.w));
    cropState.y=Math.max(0,Math.min(cropState.y,dispH-cropState.h));
  }
  function setAspect(key){
    cropAspect=key;
    document.querySelectorAll("#cropAspect button").forEach(b=>b.classList.toggle("active",b.dataset.ratio===key));
    updateRatioLockedClass();
    if(!cropState)return;
    const ratio=currentRatio();
    const cx=cropState.x+cropState.w/2, cy=cropState.y+cropState.h/2;
    let w=cropState.w, h=cropState.h;
    if(ratio){
      if(w/h>ratio)w=h*ratio; else h=w/ratio;
      if(w>cropState.dispW){w=cropState.dispW;h=w/ratio;}
      if(h>cropState.dispH){h=cropState.dispH;w=h*ratio;}
    }
    cropState.w=w;cropState.h=h;
    cropState.x=cx-w/2;cropState.y=cy-h/2;
    clampCrop();renderCrop();
  }
  function onPointerDown(e){
    if(!cropState)return;
    e.preventDefault();
    const hEl=e.target.closest(".hnd");
    drag={mode:hEl?"resize":"move",handle:hEl?hEl.dataset.h:null,px:e.clientX,py:e.clientY,start:{x:cropState.x,y:cropState.y,w:cropState.w,h:cropState.h}};
    try{$("cropRect").setPointerCapture(e.pointerId);}catch(_){}
  }
  function onPointerMove(e){
    if(!drag)return;
    const dx=e.clientX-drag.px, dy=e.clientY-drag.py;
    if(drag.mode==="move"){
      cropState.x=drag.start.x+dx;cropState.y=drag.start.y+dy;
      clampCrop();renderCrop();
    }else{
      resizeCrop(drag.handle,dx,dy,drag.start);
      renderCrop();
    }
  }
  function onPointerUp(e){
    if(!drag)return;
    drag=null;
    try{$("cropRect").releasePointerCapture(e.pointerId);}catch(_){}
  }
  /* 角手柄缩放：锁定比例时以对角为锚点，按指针主方向拟合比例 */
  function resizeCrop(handle,dx,dy,start){
    const ratio=currentRatio();
    const {dispW,dispH}=cropState,min=20;
    if(ratio){
      const anchorX=handle.includes("w")?start.x+start.w:start.x;
      const anchorY=handle.includes("n")?start.y+start.h:start.y;
      const cornerX=handle.includes("w")?anchorX-dx:anchorX+dx;
      const cornerY=handle.includes("n")?anchorY-dy:anchorY+dy;
      const rawW=Math.abs(cornerX-anchorX);
      const rawH=Math.abs(cornerY-anchorY);
      let w,h;
      if(rawW/ratio>=rawH){w=rawW;h=w/ratio;}else{h=rawH;w=h*ratio;}
      const maxW=handle.includes("w")?anchorX:(dispW-anchorX);
      const maxH=handle.includes("n")?anchorY:(dispH-anchorY);
      if(w>maxW){w=maxW;h=w/ratio;}
      if(h>maxH){h=maxH;w=h*ratio;}
      if(w<min){w=min;h=w/ratio;}
      cropState.w=w;cropState.h=h;
      cropState.x=handle.includes("w")?anchorX-w:anchorX;
      cropState.y=handle.includes("n")?anchorY-h:anchorY;
    }else{
      let x=start.x,y=start.y,w=start.w,h=start.h;
      if(handle.includes("w")){x=start.x+dx;w=start.w-dx;}
      if(handle.includes("e")){w=start.w+dx;}
      if(handle.includes("n")){y=start.y+dy;h=start.h-dy;}
      if(handle.includes("s")){h=start.h+dy;}
      cropState.x=x;cropState.y=y;cropState.w=w;cropState.h=h;
      clampCrop();
    }
  }
  /* 应用裁切：按显示坐标映射回原图像素，绘制到 canvas 并降采样 */
  function confirmCrop(){
    if(!cropState)return;
    const img=$("cropImg"), natW=img.naturalWidth, natH=img.naturalHeight;
    const sX=natW/cropState.dispW, sY=natH/cropState.dispH;
    const sx=cropState.x*sX, sy=cropState.y*sY, sw=cropState.w*sX, sh=cropState.h*sY;
    const max=1600;
    let dw=sw, dh=sh;
    if(dw>max||dh>max){const r=Math.min(max/dw,max/dh);dw=Math.round(dw*r);dh=Math.round(dh*r);}
    else{dw=Math.round(dw);dh=Math.round(dh);}
    const cv=document.createElement("canvas");
    cv.width=dw;cv.height=dh;
    cv.getContext("2d").drawImage(img,sx,sy,sw,sh,0,0,dw,dh);
    try{state.bg=cv.toDataURL("image/jpeg",0.82);}
    catch(err){state.bg=img.src;}
    A.apply.background();
    syncBgPreview();
    persist(state);
    closeCropper();
  }
  /* 裁切期间窗口尺寸变化：按显示比例同步裁切框 */
  function onCropResize(){
    if(!cropState)return;
    const img=$("cropImg");
    if(!img.src)return;
    const r=img.getBoundingClientRect();
    if(!r.width||!r.height)return;
    if(r.width===cropState.dispW&&r.height===cropState.dispH)return;
    const sx=r.width/cropState.dispW, sy=r.height/cropState.dispH;
    cropState.x*=sx;cropState.y*=sy;cropState.w*=sx;cropState.h*=sy;
    cropState.dispW=r.width;cropState.dispH=r.height;
    clampCrop();renderCrop();
  }
  function bindCropper(){
    const rect=$("cropRect");
    rect.addEventListener("pointerdown",onPointerDown);
    rect.addEventListener("pointermove",onPointerMove);
    rect.addEventListener("pointerup",onPointerUp);
    rect.addEventListener("pointercancel",onPointerUp);
    $("cropImg").addEventListener("dragstart",e=>e.preventDefault());
    document.querySelectorAll("#cropAspect button").forEach(b=>b.onclick=()=>setAspect(b.dataset.ratio));
    $("cropClose").onclick=closeCropper;
    $("cropCancel").onclick=closeCropper;
    $("cropBackdrop").onclick=closeCropper;
    $("cropConfirm").onclick=confirmCrop;
    addEventListener("resize",onCropResize);
    /* Esc 仅关闭裁切弹窗（捕获阶段拦截，避免连带关闭设置面板） */
    document.addEventListener("keydown",e=>{
      if(e.key==="Escape"&&$("cropModal").classList.contains("show")){
        closeCropper();
        e.stopImmediatePropagation();
      }
    },true);
  }

  /* ---------- 实时预览 + 自动保存 ---------- */
  function bindLive(){
    $("inName").addEventListener("input",()=>{state.name=$("inName").value;A.tick();persist(state)});

    $("inStart").addEventListener("change",()=>{
      const v=$("inStart").value;
      if(!v)return;
      if(parseInput(v)>parseInput(state.target)){$("inStart").value=state.start;return}
      state.start=v;
      A.apply.dates();
      persist(state);
    });
    $("inTarget").addEventListener("change",()=>{
      const v=$("inTarget").value;
      if(!v)return;
      if(parseInput(v)<parseInput(state.start)){$("inTarget").value=state.target;return}
      state.target=v;
      A.apply.dates();
      persist(state);
    });

    document.querySelectorAll("#segTheme button").forEach(b=>{
      b.onclick=()=>{state.theme=b.dataset.theme;A.apply.theme();syncThemeSeg();syncSchemeGrid();syncSchemeEdit();persist(state)}
    });
    document.querySelectorAll("#segLayout button").forEach(b=>{
      b.onclick=()=>{state.layout=b.dataset.layout;A.animateLayout?A.animateLayout(state.layout):A.apply.layout();syncLayoutSeg()}
    });

    /* 方格大小：滑块拖动时只更新数值标签，松手后更新 CSS（不重建 DOM） */
    let cellTimer=null;
    const debouncedUpdate=()=>{clearTimeout(cellTimer);cellTimer=setTimeout(()=>{A.grid.rebuild();persist(state)},120)};
    $("inCellToday").addEventListener("input",()=>{
      state.cellToday=+$("inCellToday").value;
      updateCellVal();
      debouncedUpdate();
    });
    $("inCellTotal").addEventListener("input",()=>{
      state.cellTotal=+$("inCellTotal").value;
      updateCellVal();
      debouncedUpdate();
    });
    $("inBurnInt").addEventListener("input",()=>{
      state.burnInterval=+$("inBurnInt").value;
      updateBurnIntVal();
      A.apply.antiBurn();
      persist(state);
    });
    $("inBurn").addEventListener("change",()=>{
      state.antiBurn=$("inBurn").checked;
      syncBurnIntField();
      A.apply.antiBurn();
      persist(state);
    });
    document.querySelectorAll("#segTodayStyle button").forEach(b=>{
      b.onclick=()=>{
        const prevStyle=state.todayStyle, prevToast=state.toastMode;
        state.todayStyle=b.dataset.style;
        /* 离开粒子模式时自动关闭烤鸡 */
        if(state.todayStyle!=="particles")state.toastMode=false;
        syncTodayStyleSeg();
        syncFluidColorField();
        syncToastField();
        persist(state);
        /* 从烤鸡粒子模式切走 = 关闭烤鸡：立即生效，终止负载 */
        if(prevToast && !state.toastMode){
          A.grid.applyTodayStyle();
          _styleSnapshot=state.todayStyle+"|"+state.toastMode;
        }
      };
    });
    /* 烤鸡模式开关：
       - 关闭烤鸡（开→关）：立即生效，终止负载让用户能正常操作；
       - 开启烤鸡（关→开）：延迟到关闭面板后生效，避免面板内卡死无法退出。 */
    $("inToast").addEventListener("change",()=>{
      const prev=state.toastMode;
      state.toastMode=$("inToast").checked;
      persist(state);
      if(prev && !state.toastMode){
        /* 关闭烤鸡：立即停止负载（applyTodayStyle 会 stop toastCpu + 重建普通粒子实例） */
        A.grid.applyTodayStyle();
        _styleSnapshot=state.todayStyle+"|"+state.toastMode;
      }
    });
    /* 自定义流体颜色 */
    $("inFluidCustom").addEventListener("change",()=>{
      state.fluidCustom=$("inFluidCustom").checked;
      syncFluidColorField();
      A.grid.applyAccents();
      persist(state);
    });
    $("inFluidC1").addEventListener("input",()=>{
      state.fluidC1=$("inFluidC1").value;
      A.grid.applyAccents();
      persist(state);
    });
    $("inFluidC2").addEventListener("input",()=>{
      state.fluidC2=$("inFluidC2").value;
      A.grid.applyAccents();
      persist(state);
    });
    /* 配色方案主题色编辑 */
    $("inSchemeC1").addEventListener("input",saveSchemeColors);
    $("inSchemeC2").addEventListener("input",saveSchemeColors);
    $("btnResetScheme").onclick=resetSchemeColors;

    $("btnPickBg").onclick=()=>$("inBg").click();
    $("inBg").addEventListener("change",e=>{readFile(e.target.files[0]);e.target.value="";});
    $("btnClearBg").onclick=()=>{state.bg="";A.apply.background();syncBgPreview();persist(state)};
    $("inBgBlur").addEventListener("input",()=>{state.bgBlur=+$("inBgBlur").value;updateBgVals();A.apply.background();persist(state)});
    $("inBgDim").addEventListener("input",()=>{state.bgDim=+$("inBgDim").value;updateBgVals();A.apply.background();persist(state)});

    /* 快速选择目标日 */
    document.querySelectorAll(".chip").forEach(ch=>{
      ch.onclick=()=>{
        const today=new Date(),v=ch.dataset.days;
        const t=v==="year"
          ?new Date(today.getFullYear()+1,today.getMonth(),today.getDate())
          :new Date(today.getTime()+(+v)*86400000);
        $("inTarget").value=A.util.fmtInput(t);
        state.target=$("inTarget").value;
        A.apply.dates();
        persist(state);
      };
    });
  }

  /* ---------- 关闭 ---------- */
  function bindActions(){
    $("btnClose").onclick=closePanel;
    backdrop.onclick=closePanel;
  }

  A.panel={openPanel,closePanel,syncInputs,buildSchemeGrid,bindLive,bindActions,bindCropper,syncTodayStyleSeg};
})(window.App);