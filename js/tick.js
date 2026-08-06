/* ===== 主刷新：时钟、天数、今日/总进度 ===== */
window.App = window.App || {};
(function(A){
  "use strict";
  const {$,DAY,parseInput,clamp01,hms}=A.util, {state}=A;

  function tick(){
    const now=new Date(),n=now.getTime();
    const s0=parseInput(state.start).getTime();
    const t0=parseInput(state.target).getTime();
    const diff=t0-n, span=t0-s0;
    const past=diff<=0;

    /* 中央总天数 */
    const daysEl=$("days"),dirEl=$("dir");
    if(diff>0){
      const d=Math.ceil(diff/DAY);
      daysEl.textContent=d;dirEl.textContent="后";
      document.title=`${d} 天${state.name?" · "+state.name:""}`;
    }else{
      const pd=Math.floor(-diff/DAY);
      daysEl.textContent=pd;dirEl.textContent=pd===0?"今天":"前";
      document.title=state.name||"倒数日";
    }
    const dlen=String(daysEl.textContent).length;
    daysEl.classList.toggle("long",dlen>=3);
    daysEl.classList.toggle("xlong",dlen>=5);

    /* 文案 */
    const nameEl=$("heroName");
    if(state.name){nameEl.textContent=state.name;nameEl.style.display=""}
    else nameEl.style.display="none";

    document.documentElement.classList.toggle("done",past);

    /* 进度比例 */
    const totalE = span>0 ? clamp01((n-s0)/span) : (n>=t0?1:0);
    const sod=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    const todayE = clamp01((n-sod.getTime())/DAY);

    A.grid.paint(todayE,totalE);
    A.grid.applyAccents();
    /* 存储进度比例供布局动画实时 paint 使用 */
    A._lastE={today:todayE,total:totalE};

    /* 角落百分比标签 */
    $("todayPct").textContent=(todayE*100).toFixed(1)+"%";
    $("totalPct").textContent=(totalE*100).toFixed(1)+"%";

    /* 中心日期时间胶囊（合并显示） */
    const p=String(now.getMonth()+1).padStart(2,"0");
    const dd=String(now.getDate()).padStart(2,"0");
    $("dateTime").textContent=`${hms(n-sod.getTime())} · ${now.getFullYear()}.${p}.${dd}`;
  }

  A.tick=tick;
})(window.App);