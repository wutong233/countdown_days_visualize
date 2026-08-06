/* ===== GPU 流体模拟（WebGL1 + OES_texture_float）
   两种独立实现，互不影响：
   - HeightFieldFluid：1D 浅水方程，侧视容器液体（液位下降 + 真实波传播 + 鼠标涟漪）
   - ParticleFluid：GPU 粒子系统 + 密度场排斥，粒子流体（重力堆积 + 鼠标搅动）

   统一接口：
   - mount(container)：挂载到 DOM
   - setProgress(e)：e∈[0,1]，0=满，1=空
   - setColors(rgb1, rgb2)：底部→表面渐变
   - resize() / destroy()

   着色器规范：WebGL1 + varying，保证最大兼容性。 */
window.App = window.App || {};
(function(A){
  "use strict";

  /* ---------- GLSL 公共 ---------- */
  const VS_QUAD=[
    "attribute vec2 aPos;",
    "varying vec2 vUv;",
    "void main(){",
    "  vUv = aPos * 0.5 + 0.5;",
    "  gl_Position = vec4(aPos, 0.0, 1.0);",
    "}"
  ].join("\n");

  /* ============================================================
     工具：着色器 / 程序 / FBO
     ============================================================ */
  function compile(gl,type,src){
    const s=gl.createShader(type);
    gl.shaderSource(s,src);gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){
      console.error(gl.getShaderInfoLog(s));console.error(src);
    }
    return s;
  }
  function program(gl,vsSrc,fsSrc){
    const p=gl.createProgram();
    gl.attachShader(p,compile(gl,gl.VERTEX_SHADER,vsSrc));
    gl.attachShader(p,compile(gl,gl.FRAGMENT_SHADER,fsSrc));
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS))console.error(gl.getProgramInfoLog(p));
    return p;
  }
  /* 浮点纹理内部格式：WebGL2 用 RGBA32F（sized），WebGL1 用 RGBA（unsized）。
     WebGL2 的 EXT_color_buffer_float 支持 RGBA32F 渲染目标，
     而 WebGL1 的 WEBGL_color_buffer_float 在部分 NVIDIA D3D11 驱动上
     FBO 永远不完整（36054），故优先使用 WebGL2。 */
  function floatIFmt(gl){
    return gl.RGBA32F ? gl.RGBA32F : gl.RGBA;
  }
  /* 创建浮点纹理 + FBO（ping-pong 用）。
     filter 默认 NEAREST（最兼容）；LINEAR 需 OES_texture_float_linear 扩展
    （WebGL1），WebGL2 已内建 LINEAR 浮点过滤。
     驱动坑：WebGL1/WebGL2 下首次 texImage2D 的 FLOAT/RGBA32F 纹理在部分
     NVIDIA D3D11 驱动上不可着色（FRAMEBUFFER_INCOMPLETE_ATTACHMENT 36054），
     重新 texImage2D 一次即恢复可着色。创建后检查 FBO 完整性，不完整则重试。 */
  function makeFloatTarget(gl,w,h,filter){
    const f = filter||gl.NEAREST;
    const ifmt=floatIFmt(gl);
    const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,ifmt,w,h,0,gl.RGBA,gl.FLOAT,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,f);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,f);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    const fbo=gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    /* 驱动坑修复：首次 texImage2D 后 FBO 可能不完整，
       需先解绑 FBO → 重新 texImage2D → 重新绑定 FBO，驱动才会刷新附件状态 */
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      gl.bindTexture(gl.TEXTURE_2D,tex);
      gl.texImage2D(gl.TEXTURE_2D,0,ifmt,w,h,0,gl.RGBA,gl.FLOAT,null);
      gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {tex,fbo,w,h,filter:f};
  }
  /* 驱动坑：部分 GPU 首个 FLOAT 纹理不可着色
     （FRAMEBUFFER_INCOMPLETE_ATTACHMENT），需用全新纹理对象 + 全新 FBO 替换。
     旧 FBO 可能因首个不可着色纹理而状态损坏，仅替换纹理无效。
     尝试创建新纹理+FBO，仅当 FBO 完整时才提交替换，否则清理并返回 false。
     可能在 GL 上下文初始化后的前几帧内失败，需每帧重试直到成功。 */
  function tryFixFloatRenderable(gl,t){
    const ntex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,ntex);
    gl.texImage2D(gl.TEXTURE_2D,0,floatIFmt(gl),t.w,t.h,0,gl.RGBA,gl.FLOAT,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,t.filter);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,t.filter);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    const nfbo=gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER,nfbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,ntex,0);
    /* 驱动坑修复：首次 texImage2D 后 FBO 可能不完整，
       需先解绑 FBO → 重新 texImage2D → 重新绑定 FBO */
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      gl.bindTexture(gl.TEXTURE_2D,ntex);
      gl.texImage2D(gl.TEXTURE_2D,0,floatIFmt(gl),t.w,t.h,0,gl.RGBA,gl.FLOAT,null);
      gl.bindFramebuffer(gl.FRAMEBUFFER,nfbo);
    }
    const ok=gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    if(ok){
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
      t.tex=ntex;
      t.fbo=nfbo;
    }else{
      gl.deleteFramebuffer(nfbo);
      gl.deleteTexture(ntex);
    }
    return ok;
  }
  /* 检测 FBO 是否完整（FLOAT 纹理可着色） */
  function isFBOComplete(gl,t){
    gl.bindFramebuffer(gl.FRAMEBUFFER,t.fbo);
    const s=gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return s===gl.FRAMEBUFFER_COMPLETE;
  }
  /* 检测浮点纹理 LINEAR 过滤支持（WebGL2 已内建，WebGL1 需扩展） */
  function hasFloatLinear(gl){
    if(gl.RGBA32F) return true; /* WebGL2 */
    return !!gl.getExtension("OES_texture_float_linear");
  }

  /* quad VAO（两个三角形覆盖 NDC） */
  function makeQuad(gl){
    const buf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,buf);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]),gl.STATIC_DRAW);
    return buf;
  }

  /* ============================================================
     HeightFieldFluid：1D 浅水方程容器液体
     - 状态纹理 256×1：R=高度 h，G=水平速度 u
     - 浅水方程：∂h/∂t = -∂(hu)/∂x，∂u/∂t = -u·∂u/∂x - g·∂h/∂x
     - 边界：反射墙（u 反向衰减）
     - 鼠标：在 x 处注入波峰
     - 渲染：侧视图，液面 = level + h·amp，液面下深度渐变 + 法线光照
     ============================================================ */
  const HF_UPDATE_FS=[
    "precision highp float;",
    "uniform sampler2D uState;",
    "uniform float uTexel;",
    "uniform float uDt;",
    "uniform float uG;",
    "uniform float uDamp;",
    "varying vec2 vUv;",
    "void main(){",
    "  vec2 c = texture2D(uState, vUv).rg;",
    "  float h = c.r, u = c.g;",
    "  float hL = texture2D(uState, vUv - vec2(uTexel,0.0)).r;",
    "  float hR = texture2D(uState, vUv + vec2(uTexel,0.0)).r;",
    "  float uL = texture2D(uState, vUv - vec2(uTexel,0.0)).g;",
    "  float uR = texture2D(uState, vUv + vec2(uTexel,0.0)).g;",
    "  /* 浅水方程：连续性 + 动量（含非线性平流） */",
    "  float dh = -0.5 * (uR - uL) * uDt / uTexel;",
    "  float du = -uG * 0.5 * (hR - hL) * uDt / uTexel;",
    "  du -= u * 0.5 * (uR - uL) * uDt / uTexel;",
    "  h += dh; u += du;",
    "  /* 反射边界：容器两侧是墙 */",
    "  if(vUv.x < uTexel || vUv.x > 1.0 - uTexel){ u = -u * 0.4; h *= 0.96; }",
    "  h *= uDamp; u *= uDamp;",
    "  /* 持续环境波激励：多频行波叠加，让液面始终保持柔和波动（模拟微风扰动） */",
    "  h += sin(vUv.x * 12.566 + uTime * 1.1) * 0.0016;",
    "  h += sin(vUv.x * 23.248 - uTime * 0.75) * 0.0010;",
    "  h += sin(vUv.x * 8.168 + uTime * 1.7) * 0.0007;",
    "  gl_FragColor = vec4(h, u, 0.0, 1.0);",
    "}"
  ].join("\n");

  const HF_RENDER_FS=[
    "precision highp float;",
    "uniform sampler2D uState;",
    "uniform float uTexel;",
    "uniform float uLevel;",
    "uniform vec3 uColor1;",
    "uniform vec3 uColor2;",
    "uniform float uWaveAmp;",
    "uniform float uTime;",
    "varying vec2 vUv;",
    "void main(){",
    "  float h = texture2D(uState, vec2(vUv.x, 0.5)).r;",
    "  /* 环境表面波：多频行波叠加，让液面始终有可见的柔和波浪 */",
    "  float ambWave = sin(vUv.x * 12.566 + uTime * 1.3) * 0.010",
    "               + sin(vUv.x * 23.248 - uTime * 0.9) * 0.005",
    "               + sin(vUv.x * 8.168 + uTime * 1.9) * 0.003;",
    "  float surface = uLevel + h * uWaveAmp + ambWave;",
    "  if(vUv.y < surface){",
    "    float depth = (surface - vUv.y);",
    "    vec3 col = mix(uColor2, uColor1, clamp(depth * 2.2, 0.0, 1.0));",
    "    /* 法线：模拟 h 梯度 + 环境波解析梯度 */",
    "    float hL = texture2D(uState, vec2(vUv.x - uTexel, 0.5)).r;",
    "    float hR = texture2D(uState, vec2(vUv.x + uTexel, 0.5)).r;",
    "    float grad = (hR - hL) * uWaveAmp;",
    "    float ambGrad = cos(vUv.x * 12.566 + uTime * 1.3) * 12.566 * 0.010",
    "                 + cos(vUv.x * 23.248 - uTime * 0.9) * (-23.248) * 0.005",
    "                 + cos(vUv.x * 8.168 + uTime * 1.9) * 8.168 * 0.003;",
    "    vec3 n = normalize(vec3(-(grad * 8.0 + ambGrad * 1.2), 1.0, 0.0));",
    "    vec3 light = normalize(vec3(0.35, 0.8, 0.5));",
    "    float diff = max(dot(n, light), 0.0);",
    "    col *= 0.5 + 0.5 * diff;",
    "    /* 液面高光带 */",
    "    float rim = smoothstep(surface - 0.018, surface, vUv.y);",
    "    col += rim * vec3(0.7, 0.8, 0.9);",
    "    /* 容器底部柔暗 */",
    "    float bot = smoothstep(0.0, 0.08, vUv.y);",
    "    col *= 0.7 + 0.3 * bot;",
    "    /* 半透明液体：表面更透、深处略浓，让玻璃容器的 backdrop-filter 折射背景透出 */",
    "    float alpha = mix(0.42, 0.74, clamp(depth * 2.5, 0.0, 1.0));",
    "    gl_FragColor = vec4(col * alpha, alpha);",
    "  } else {",
    "    /* 液面以上透明，露出玻璃背景 */",
    "    gl_FragColor = vec4(0.0);",
    "  }",
    "}"
  ].join("\n");

  /* 在 HF_UPDATE_FS / HF_RENDER_FS 中引用 uTime，需要补声明。
     为避免多版本维护，统一在 update 里加 uTime uniform。 */
  const HF_UPDATE_FS_T = HF_UPDATE_FS.replace(
    "uniform float uDamp;",
    "uniform float uDamp;\nuniform float uTime;"
  );

  class HeightFieldFluid{
    constructor(container){
      this.container=container;
      this.canvas=document.createElement("canvas");
      this.canvas.className="fluid-canvas";
      container.appendChild(this.canvas);
      const opts={alpha:true,premultipliedAlpha:true,antialias:false,preserveDrawingBuffer:true};
      /* 优先 WebGL2：EXT_color_buffer_float 对 RGBA32F 渲染目标支持完善，
         而 WebGL1 的 WEBGL_color_buffer_float 在部分 NVIDIA D3D11 驱动上
         FLOAT FBO 永远不完整（36054），导致模拟写入被静默丢弃。 */
      let gl=this.canvas.getContext("webgl2",opts);
      if(gl){
        this._isGL2=true;
        if(!gl.getExtension("EXT_color_buffer_float")){console.warn("EXT_color_buffer_float 不可用，回退 WebGL1");gl=null;}
      }
      if(!gl){
        gl=this.canvas.getContext("webgl",opts);
        this._isGL2=false;
        if(gl){
          const ext=gl.getExtension("OES_texture_float");
          if(!ext){this._fail=true;console.warn("OES_texture_float 不可用");return}
          gl.getExtension("WEBGL_color_buffer_float");
        }
      }
      if(!gl){this._fail=true;return}
      this.gl=gl;
      this._init();
      this.running=false;
      this.progress=0;
      this.colors=[[56,189,248],[129,140,248]];
      this.SIM_W=256;
    }
    _init(){
      const gl=this.gl;
      this.progUpdate=program(gl,VS_QUAD,HF_UPDATE_FS_T);
      this.progRender=program(gl,VS_QUAD,HF_RENDER_FS);
      this.quad=makeQuad(gl);
      /* ping-pong 状态纹理：渲染需 LINEAR 平滑液面，无扩展则退 NEAREST（锯齿可接受） */
      const hf=hasFloatLinear(gl)?gl.LINEAR:gl.NEAREST;
      this.stateA=makeFloatTarget(gl,this.SIM_W,1,hf);
      this.stateB=makeFloatTarget(gl,this.SIM_W,1,hf);
      /* 清零 */
      this._clearTarget(this.stateA);
      this._clearTarget(this.stateB);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      /* 部分驱动下 FLOAT/RGBA32F 纹理 FBO 可能不完整（36054），
         makeFloatTarget 已尝试重传修复，此处仍检测作为安全兜底。 */
      this._needsFix=!isFBOComplete(gl,this.stateA)||!isFBOComplete(gl,this.stateB);
      /* 安全默认值：_render 需在 _sim 之前也能访问 stateCur */
      this.stateCur=this.stateA; this.stateNext=this.stateB;
      /* uniform 位置缓存 */
      this.uUpdate={state:gl.getUniformLocation(this.progUpdate,"uState"),texel:gl.getUniformLocation(this.progUpdate,"uTexel"),dt:gl.getUniformLocation(this.progUpdate,"uDt"),g:gl.getUniformLocation(this.progUpdate,"uG"),damp:gl.getUniformLocation(this.progUpdate,"uDamp"),time:gl.getUniformLocation(this.progUpdate,"uTime")};
      this.uRender={state:gl.getUniformLocation(this.progRender,"uState"),texel:gl.getUniformLocation(this.progRender,"uTexel"),level:gl.getUniformLocation(this.progRender,"uLevel"),c1:gl.getUniformLocation(this.progRender,"uColor1"),c2:gl.getUniformLocation(this.progRender,"uColor2"),amp:gl.getUniformLocation(this.progRender,"uWaveAmp"),time:gl.getUniformLocation(this.progRender,"uTime")};
      this.aPos={update:gl.getAttribLocation(this.progUpdate,"aPos"),render:gl.getAttribLocation(this.progRender,"aPos")};
    }
    _clearTarget(t){
      const gl=this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER,t.fbo);
      gl.viewport(0,0,t.w,t.h);
      gl.clearColor(0,0,0,0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    setProgress(e){this.progress=Math.min(1,Math.max(0,e))}
    setColors(c1,c2){this.colors=[c1,c2]}
    resize(){
      if(this._fail)return;
      const r=this.container.getBoundingClientRect();
      const dpr=Math.min(window.devicePixelRatio||1,2);
      this.canvas.width=Math.max(2,Math.round(r.width*dpr));
      this.canvas.height=Math.max(2,Math.round(r.height*dpr));
      this.canvas.style.width=r.width+"px";
      this.canvas.style.height=r.height+"px";
    }
    start(){
      if(this._fail||this.running)return;
      this.running=true;
      this.lastT=performance.now();
      this._tick=this._frame.bind(this);
      this.raf=requestAnimationFrame(this._tick);
    }
    stop(){
      this.running=false;
      if(this.raf)cancelAnimationFrame(this.raf);
    }
    destroy(){
      this.stop();
      if(this.canvas&&this.canvas.parentNode)this.canvas.parentNode.removeChild(this.canvas);
      this.gl=null;
    }
    _frame(now){
      if(!this.running)return;
      const dt=Math.min(0.033,(now-this.lastT)/1000);
      this.lastT=now;
      this._time=now/1000;
      this._sim(dt,this._time);
      this._render();
      /* 驱动坑修复：GL 上下文需若干帧 draw call "热身"后，FLOAT/RGBA32F 纹理 FBO
         才可着色（36054）。不阻塞渲染，每 180 帧（约 3 秒）重新 texImage2D 一次
         （在 _render 之后）。关键：重传间隔期间不触碰纹理，让 GL 充分热身。 */
      if(this._needsFix){
        this._fixCounter=(this._fixCounter||0)+1;
        if(this._fixCounter>=180){
          this._fixCounter=0;
          const gl=this.gl;
          gl.bindFramebuffer(gl.FRAMEBUFFER,null);
          const ifmt=floatIFmt(gl);
          [this.stateA,this.stateB].forEach(function(t){
            gl.bindTexture(gl.TEXTURE_2D,t.tex);
            gl.texImage2D(gl.TEXTURE_2D,0,ifmt,t.w,t.h,0,gl.RGBA,gl.FLOAT,null);
          });
          if(isFBOComplete(gl,this.stateA)&&isFBOComplete(gl,this.stateB)){
            this._needsFix=false;
          }
        }
      }
      this.raf=requestAnimationFrame(this._tick);
    }
    _sim(dt,time){
      const gl=this.gl;
      const texel=1/this.SIM_W;
      let src=this.stateCur||this.stateA, dst=this.stateNext||this.stateB;
      /* 多次 update pass（子步长，更稳定） */
      const sub=3;
      const sdt=dt/sub;
      for(let i=0;i<sub;i++){
        gl.useProgram(this.progUpdate);
        gl.bindFramebuffer(gl.FRAMEBUFFER,dst.fbo);
        gl.viewport(0,0,dst.w,dst.h);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D,src.tex);
        gl.uniform1i(this.uUpdate.state,0);
        gl.uniform1f(this.uUpdate.texel,texel);
        gl.uniform1f(this.uUpdate.dt,sdt);
        gl.uniform1f(this.uUpdate.g,9.8);
        gl.uniform1f(this.uUpdate.damp,0.996);
        gl.uniform1f(this.uUpdate.time,time+i*sdt);
        this._drawQuad(this.aPos.update);
        const t=src;src=dst;dst=t;
      }
      /* 最终 src 为最新状态 */
      this.stateCur=src;
      this.stateNext=dst;
    }
    _render(){
      const gl=this.gl;
      gl.useProgram(this.progRender);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      gl.viewport(0,0,this.canvas.width,this.canvas.height);
      gl.clearColor(0,0,0,0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      /* 预乘 alpha 输出，正确混合因子 */
      gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D,this.stateCur.tex);
      gl.uniform1i(this.uRender.state,0);
      gl.uniform1f(this.uRender.texel,1/this.SIM_W);
      /* 液位：progress 0→满(0.94)，1→空(0.02) */
      const level=0.94-this.progress*0.92;
      gl.uniform1f(this.uRender.level,level);
      gl.uniform3f(this.uRender.c1,this.colors[0][0]/255,this.colors[0][1]/255,this.colors[0][2]/255);
      gl.uniform3f(this.uRender.c2,this.colors[1][0]/255,this.colors[1][1]/255,this.colors[1][2]/255);
      gl.uniform1f(this.uRender.amp,0.15);
      gl.uniform1f(this.uRender.time,this._time||0);
      this._drawQuad(this.aPos.render);
    }
    _drawQuad(aPos){
      const gl=this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
      gl.drawArrays(gl.TRIANGLES,0,6);
    }
  }

  /* ============================================================
     ParticleFluid：GPU 粒子流体（Metaball 液体渲染）
     - 粒子纹理 N×1：RGBA = (x, y, vx, vy)，归一化坐标 0..1
     - 每帧：① 更新粒子（分层弹簧力 + 重力 + 鼠标 + 边界 + 液面）
             ② 渲染粒子为高斯亮度场（加法混合累加）到 field FBO
             ③ 对亮度场做 metaball 阈值化 + 法线光照 + 高光 + 菲涅尔
     - progress 控制液面高度：progress=0 满(0.98)，1 空(0.05)
     ============================================================ */

  const PT_UPDATE_FS=[
    "precision highp float;",
    "uniform sampler2D uState;",
    "uniform float uDt;",
    "uniform float uTime;",
    "uniform float uSurface;", // 液面高度：粒子不得超越
    "varying vec2 vUv;",
    "float noise(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }",
    "void main(){",
    "  vec4 c = texture2D(uState, vUv);",
    "  vec2 pos = c.rg;",
    "  vec2 vel = c.ba;",
    "  /* 重力（小，让粒子有缓慢下沉趋势） */",
    "  vel.y -= 0.2 * uDt;",
    "  /* 2D 纹理 + 2D 网格分布：状态纹理为方形（128×128 或 256×256），",
    "     纹理网格 = 粒子分布网格，vUv 直接映射到目标位置，粒子自然贴壁。",
    "     旧版用 1D 纹理（N×1），烤鸡模式 N=65536 超出 MAX_TEXTURE_SIZE（多数 GPU 上限 16384），",
    "     纹理创建静默失败 → FBO 不完整 → 无粒子渲染。改用方形 2D 纹理规避此限制。 */",
    "  float targetX = vUv.x;            /* 0..1 贴左右壁 */",
    "  float targetY = 0.006 + (uSurface - 0.006) * (1.0 - vUv.y); /* 底行贴底，顶行贴液面 */",
    "  vel.x += (targetX - pos.x) * 12.0 * uDt;",
    "  vel.y += (targetY - pos.y) * 15.0 * uDt;",
    "  /* 微噪声（小幅度，增加自然感，不产生沸腾） */",
    "  vel += vec2(noise(pos*4.0+uTime*0.3)-0.5, noise(pos*5.0+uTime*0.25+1.7)-0.5) * 0.008;",
    "  /* 阻尼（强，让粒子快速稳定） */",
    "  vel *= 0.94;",
    "  /* 速度钳制，防止液面很低时弹簧力爆炸 */",
    "  vel = clamp(vel, vec2(-4.0), vec2(4.0));",
    "  /* 位置积分 */",
    "  pos += vel * uDt;",
    "  /* 容器壁：允许粒子贴壁（至 0.004），仅硬性防溢出 */",
    "  if(pos.x < 0.004){ pos.x = 0.004; vel.x = abs(vel.x)*0.4; }",
    "  if(pos.x > 0.996){ pos.x = 0.996; vel.x = -abs(vel.x)*0.4; }",
    "  if(pos.y < 0.004){ pos.y = 0.004; vel.y = abs(vel.y)*0.4; }",
    "  /* 液面天花板：粒子不能超过液面高度，随 progress 下降 */",
    "  if(pos.y > uSurface){ pos.y = uSurface; vel.y = -abs(vel.y)*0.4; }",
    "  gl_FragColor = vec4(pos, vel);",
    "}"
  ].join("\n");

  /* ---- Pass 2: 渲染粒子为高斯亮度场（点精灵 + 加法混合） ---- */
  const PT_FIELD_VS=[
    "attribute float aIndex; /* 粒子索引 0..N-1 */",
    "uniform sampler2D uState;",
    "uniform float uN;",
    "uniform float uTexW; /* 状态纹理边长（方形纹理：128 或 256） */",
    "uniform float uPointSize;",
    "void main(){",
    "  /* 2D 方形纹理：粒子 i 存于 texel (i%uTexW, i/uTexW)，+0.5 取纹素中心 */",
    "  float col = mod(aIndex, uTexW);",
    "  float row = floor(aIndex / uTexW);",
    "  vec4 c = texture2D(uState, vec2((col + 0.5) / uTexW, (row + 0.5) / uTexW));",
    "  vec2 pos = c.rg;",
    "  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);",
    "  gl_PointSize = uPointSize;",
    "}"
  ].join("\n");

  const PT_FIELD_FS=[
    "precision highp float;",
    "void main(){",
    "  vec2 d = gl_PointCoord - 0.5;",
    "  float r2 = dot(d, d);",
    "  if(r2 > 0.25) discard;",
    "  /* 高斯亮度场：中心 1.0，边缘衰减到 0；加法混合累加重叠粒子 */",
    "  float g = exp(-r2 * 7.0);",
    "  gl_FragColor = vec4(g, 0.0, 0.0, 1.0);",
    "}"
  ].join("\n");

  /* ---- Pass 3: Metaball 液体表面（阈值化 + 法线光照 + 高光 + 菲涅尔） ---- */
  const PT_LIQUID_FS=[
    "precision highp float;",
    "uniform sampler2D uField;",
    "uniform vec2 uTexel;",
    "uniform vec3 uColor1;", /* 底部色（深） */
    "uniform vec3 uColor2;", /* 表面色（亮） */
    "uniform float uSurface;",
    "uniform float uTime;",
    "uniform sampler2D uBg;", /* 背景图（已 cover 合成 + 可选模糊，视口尺寸纹理） */
    "uniform float uBgActive;", /* 是否有背景图 0/1 */
    "uniform float uBgDim;", /* 背景压暗量 0..1 */
    "uniform vec2 uBgView;", /* 视口尺寸 px（vw, vh） */
    "uniform vec4 uBgBox;", /* 液体盒在视口中的矩形 px（x, y, w, h），y 向下，左上原点 */
    "varying vec2 vUv;",
    "/* 简易 2D 噪声（用于液面波纹） */",
    "float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
    "float noise2(vec2 p){",
    "  vec2 i = floor(p), f = fract(p);",
    "  vec2 u = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),",
    "             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);",
    "}",
    "void main(){",
    "  float v = texture2D(uField, vUv).r;",
    "  /* Metaball 阈值化（粒子已自然填满容器壁，无需壁面遮挡） */",
    "  float threshold = 0.35;",
    "  float edge = 0.12;",
    "  float mask = smoothstep(threshold - edge, threshold + edge, v);",
    "  if(mask < 0.002) discard;",
    "  /* 法线 = -field 梯度（8 邻域 Sobel，烤鸡模式拉高纹理采样负载） */",
    "  float vL = texture2D(uField, vUv - vec2(uTexel.x, 0.0)).r;",
    "  float vR = texture2D(uField, vUv + vec2(uTexel.x, 0.0)).r;",
    "  float vD = texture2D(uField, vUv - vec2(0.0, uTexel.y)).r;",
    "  float vU = texture2D(uField, vUv + vec2(0.0, uTexel.y)).r;",
    "  float vLU = texture2D(uField, vUv - vec2(uTexel.x, uTexel.y)).r;",
    "  float vRU = texture2D(uField, vUv + vec2(uTexel.x, uTexel.y)).r;",
    "  float vLD = texture2D(uField, vUv - vec2(uTexel.x, uTexel.y)).r;",
    "  float vRD = texture2D(uField, vUv + vec2(uTexel.x, uTexel.y)).r;",
    "  float vLUp = texture2D(uField, vUv + vec2(-uTexel.x, uTexel.y)).r;",
    "  float vRDn = texture2D(uField, vUv + vec2(uTexel.x, -uTexel.y)).r;",
    "  float vLDn = texture2D(uField, vUv + vec2(-uTexel.x, -uTexel.y)).r;",
    "  float vRUp = texture2D(uField, vUv + vec2(uTexel.x, uTexel.y)).r;",
    "  /* Sobel：8 邻域加权，法线更平滑但每像素 9 次纹理采样 */",
    "  vec2 grad = vec2(",
    "    (vRU + 2.0*vR + vRD) - (vLU + 2.0*vL + vLD),",
    "    (vLU + 2.0*vU + vRU) - (vLD + 2.0*vD + vRD)",
    "  );",
    "  /* 额外采样加权（烤鸡负载）：进一步累加邻域采样结果到法线扰动 */",
    "  grad += vec2(vRUp - vLDn, vLUp - vRDn) * 0.5;",
    "  /* 液面波纹：在法线上叠加时间相关的噪声扰动，越靠近液面波动越明显 */",
    "  float surfaceDist = abs(vUv.y - uSurface);",
    "  float rippleWeight = exp(-surfaceDist * 8.0);",
    "  float n1 = noise2(vUv * vec2(30.0, 15.0) + vec2(uTime * 0.5, uTime * 0.25));",
    "  float n2 = noise2(vUv * vec2(18.0, 10.0) + vec2(-uTime * 0.35, uTime * 0.4));",
    "  vec2 ripple = vec2((n1 - 0.5) * 2.0, (n2 - 0.5) * 2.0) * 0.25 * rippleWeight;",
    "  vec3 normal = normalize(vec3(-grad * 4.0 + ripple, 1.0));",
    "  /* 深度：距液面越远越深 */",
    "  float depth = clamp((uSurface - vUv.y) / max(uSurface - 0.02, 0.01), 0.0, 1.0);",
    "  vec3 col = mix(uColor2, uColor1, depth);",
    "  /* 背景折射采样：仅采样并压暗，混合放到光照之后，",
    "     避免液体漫反射光照把透出的背景一并压暗。 */",
    "  vec3 bgCol = vec3(0.0);",
    "  float bgMix = 0.0;",
    "  if(uBgActive > 0.5){",
    "    float sx = uBgBox.x + vUv.x * uBgBox.z;",
    "    float sy = uBgBox.y + (1.0 - vUv.y) * uBgBox.w; /* y 向下 */",
    "    float refractPx = 14.0 + depth * 38.0;",
    "    sx += normal.x * refractPx;",
    "    sy -= normal.y * refractPx;",
    "    float vu = sx / uBgView.x;",
    "    float vv = 1.0 - sy / uBgView.y; /* 视口纹理 y 向上 */",
    "    /* 透过水体的背景轻微模糊：在折射采样点周围取 4 邻域加权，",
    "       模拟水下的散焦感。偏移随深度增大（深处更模糊）。 */",
    "    vec2 bgUV = vec2(vu, vv);",
    "    vec2 bgOfs = vec2(1.0/uBgView.x, 1.0/uBgView.y) * (1.5 + depth * 2.5);",
    "    bgCol = texture2D(uBg, bgUV).rgb * 0.5;",
    "    bgCol += texture2D(uBg, bgUV + vec2(bgOfs.x, 0.0)).rgb * 0.125;",
    "    bgCol += texture2D(uBg, bgUV - vec2(bgOfs.x, 0.0)).rgb * 0.125;",
    "    bgCol += texture2D(uBg, bgUV + vec2(0.0, bgOfs.y)).rgb * 0.125;",
    "    bgCol += texture2D(uBg, bgUV - vec2(0.0, bgOfs.y)).rgb * 0.125;",
    "    /* 粒子流体对背景的压暗略低于整个网页背景（更亮一点）：",
    "       网页背景压暗 uBgDim，此处用 0.85*uBgDim，结果略亮于网页背景。 */",
    "    bgCol *= (1.0 - uBgDim * 0.85);",
    "    bgMix = 0.78 - depth * 0.28;",
    "  }",
    "  /* 漫反射光照（斜上方光源），仅作用于液体颜色 */",
    "  vec3 lightDir = normalize(vec3(0.35, 0.7, 0.6));",
    "  float diff = max(dot(normal, lightDir), 0.0);",
    "  col *= 0.72 + 0.28 * diff;",
    "  /* 混合背景：背景保持自身亮度（不受液体光照压暗），略亮于网页背景 */",
    "  col = mix(col, bgCol, bgMix);",
    "  /* Blinn-Phong 高光：跟随法线，波纹处会闪烁，模拟水面反光 */",
    "  vec3 viewDir = vec3(0.0, 0.0, 1.0);",
    "  vec3 halfDir = normalize(lightDir + viewDir);",
    "  float spec = pow(max(dot(normal, halfDir), 0.0), 80.0);",
    "  col += vec3(1.0, 0.98, 0.95) * spec * 0.9;",
    "  /* 菲涅尔边缘 */",
    "  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 4.0);",
    "  col += vec3(0.7, 0.85, 1.0) * fresnel * 0.35;",
    "  /* 预乘 alpha 输出 */",
    "  gl_FragColor = vec4(col * mask, mask);",
    "}"
  ].join("\n");

  /* ---- Pass 4: 背景合成（把原始图片按 cover 渲染到视口尺寸纹理） ---- */
  const PT_BGCOMPOSE_FS=[
    "precision highp float;",
    "uniform sampler2D uTex;", /* 原始图片（FLIP_Y 上传） */
    "uniform vec2 uView;", /* 视口尺寸 px */
    "uniform vec2 uImg;", /* 图片原始尺寸 px */
    "varying vec2 vUv;", /* 视口 UV，y 向上 0..1 */
    "void main(){",
    "  float sx = vUv.x * uView.x;",
    "  float sy = uView.y - vUv.y * uView.y; /* y 向下 */",
    "  float s = max(uView.x / uImg.x, uView.y / uImg.y);",
    "  float dispW = uImg.x * s;",
    "  float dispH = uImg.y * s;",
    "  float offX = (uView.x - dispW) * 0.5;",
    "  float offY = (uView.y - dispH) * 0.5;",
    "  float ix = (sx - offX) / s;",
    "  float iy = (sy - offY) / s;",
    "  float texU = ix / uImg.x;",
    "  float texV = 1.0 - iy / uImg.y; /* FLIP_Y 上传：texV=1 在图片顶部 */",
    "  gl_FragColor = vec4(texture2D(uTex, vec2(texU, texV)).rgb, 1.0);",
    "}"
  ].join("\n");

  /* ---- Pass 5: 可分离高斯模糊（9 抽头，单遍水平或垂直） ---- */
  const PT_BLUR_FS=[
    "precision highp float;",
    "uniform sampler2D uTex;",
    "uniform vec2 uStep;", /* 目标纹素尺寸 (1/W, 1/H) */
    "uniform vec2 uDir;",  /* (1,0)=水平 (0,1)=垂直 */
    "uniform float uRadius;", /* 半径（纹素数） */
    "varying vec2 vUv;",
    "void main(){",
    "  vec2 du = uDir * uStep * (uRadius / 4.0);",
    "  vec3 c = texture2D(uTex, vUv).rgb * 0.1717;",
    "  c += (texture2D(uTex, vUv + du).rgb + texture2D(uTex, vUv - du).rgb) * 0.1584;",
    "  c += (texture2D(uTex, vUv + du*2.0).rgb + texture2D(uTex, vUv - du*2.0).rgb) * 0.1246;",
    "  c += (texture2D(uTex, vUv + du*3.0).rgb + texture2D(uTex, vUv - du*3.0).rgb) * 0.0836;",
    "  c += (texture2D(uTex, vUv + du*4.0).rgb + texture2D(uTex, vUv - du*4.0).rgb) * 0.0477;",
    "  gl_FragColor = vec4(c, 1.0);",
    "}"
  ].join("\n");

  class ParticleFluid{
    constructor(container,toast){
      this.container=container;
      /* 烤鸡模式：拉满粒子数 + 每帧多次模拟子步 + 更大点精灵 + 强制背景高斯模糊，
         把 GPU 顶点/纹理采样负载和 CPU（驱动提交+JS）负载都拉高。 */
      this._toast=!!toast;
      this.canvas=document.createElement("canvas");
      this.canvas.className="fluid-canvas";
      container.appendChild(this.canvas);
      const opts={alpha:true,premultipliedAlpha:true,antialias:true,preserveDrawingBuffer:true};
      /* 优先 WebGL2：同 HeightFieldFluid，规避 WebGL1 FLOAT FBO 驱动坑 */
      let gl=this.canvas.getContext("webgl2",opts);
      if(gl){
        this._isGL2=true;
        if(!gl.getExtension("EXT_color_buffer_float")){console.warn("EXT_color_buffer_float 不可用，回退 WebGL1");gl=null;}
      }
      if(!gl){
        gl=this.canvas.getContext("webgl",opts);
        this._isGL2=false;
        if(gl){
          const ext=gl.getExtension("OES_texture_float");
          if(!ext){this._fail=true;console.warn("OES_texture_float 不可用");return}
          gl.getExtension("WEBGL_color_buffer_float");
        }
      }
      if(!gl){this._fail=true;return}
      this.gl=gl;
      /* 粒子数：烤鸡 65536（256×256 网格），普通 16384（128×128）。
         状态纹理用 2D 方形布局（_texSide×_texSide），规避 1D 纹理（N×1）
         在烤鸡模式超出 MAX_TEXTURE_SIZE（多数 GPU 上限 16384）的问题。
         16384=128²、65536=256² 均为完美平方，方形纹理无空余 texel。 */
      this.N=this._toast?65536:16384;
      this._texSide=this._toast?256:128;
      this._init();
      this.running=false;
      this.progress=0;
      this.colors=[[56,189,248],[129,140,248]];
      this._fieldW=0;this._fieldH=0; /* field FBO 尺寸，resize 时按需重建 */
      this._bgActive=false; /* 是否有背景图 */
      this._bgBlur=0; /* 背景模糊量 px */
      this._bgDim=0; /* 背景压暗量 0..1 */
      this._bgSrc=null; /* 当前已加载的背景 src（去重） */
      this._bgImgW=1;this._bgImgH=1; /* 背景图原始尺寸 */
      this._bgDirty=false; /* 背景合成/模糊需重算 */
      this._bgViewW=0;this._bgViewH=0; /* 背景合成 FBO 尺寸（视口 CSS px） */
      /* 烤鸡：强制背景模糊（拉高模糊 pass 负载），即使设置里 blur=0 */
      if(this._toast)this._toastBlur=18;
    }
    _init(){
      const gl=this.gl;
      /* 两种模式共用同一更新着色器：网格维度由 vUv 隐式给出，无需常量分支 */
      this.progUpdate=program(gl,VS_QUAD,PT_UPDATE_FS);
      this.progField=program(gl,PT_FIELD_VS,PT_FIELD_FS);
      this.progLiquid=program(gl,VS_QUAD,PT_LIQUID_FS);
      this.progBgCompose=program(gl,VS_QUAD,PT_BGCOMPOSE_FS);
      this.progBlur=program(gl,VS_QUAD,PT_BLUR_FS);
      this.quad=makeQuad(gl);
      /* 粒子状态 ping-pong：2D 方形纹理（_texSide×_texSide），NEAREST（不可插值） */
      const side=this._texSide;
      this.stateA=makeFloatTarget(gl,side,side,gl.NEAREST);
      this.stateB=makeFloatTarget(gl,side,side,gl.NEAREST);
      /* 初始化粒子位置：随机散布在容器内 */
      this._seedParticles();
      /* 粒子索引 buffer（用于 field 渲染） */
      const idx=new Float32Array(this.N);
      for(let i=0;i<this.N;i++)idx[i]=i;
      this.idxBuf=gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER,this.idxBuf);
      gl.bufferData(gl.ARRAY_BUFFER,idx,gl.STATIC_DRAW);
      /* uniform 缓存 */
      this.uUpdate={state:gl.getUniformLocation(this.progUpdate,"uState"),dt:gl.getUniformLocation(this.progUpdate,"uDt"),time:gl.getUniformLocation(this.progUpdate,"uTime"),surface:gl.getUniformLocation(this.progUpdate,"uSurface")};
      this.uField={state:gl.getUniformLocation(this.progField,"uState"),n:gl.getUniformLocation(this.progField,"uN"),texW:gl.getUniformLocation(this.progField,"uTexW"),ps:gl.getUniformLocation(this.progField,"uPointSize")};
      this.aField={index:gl.getAttribLocation(this.progField,"aIndex")};
      this.uLiquid={field:gl.getUniformLocation(this.progLiquid,"uField"),texel:gl.getUniformLocation(this.progLiquid,"uTexel"),c1:gl.getUniformLocation(this.progLiquid,"uColor1"),c2:gl.getUniformLocation(this.progLiquid,"uColor2"),surface:gl.getUniformLocation(this.progLiquid,"uSurface"),time:gl.getUniformLocation(this.progLiquid,"uTime"),bg:gl.getUniformLocation(this.progLiquid,"uBg"),bgActive:gl.getUniformLocation(this.progLiquid,"uBgActive"),bgDim:gl.getUniformLocation(this.progLiquid,"uBgDim"),bgView:gl.getUniformLocation(this.progLiquid,"uBgView"),bgBox:gl.getUniformLocation(this.progLiquid,"uBgBox")};
      this.aLiquid={pos:gl.getAttribLocation(this.progLiquid,"aPos")};
      this.uCompose={tex:gl.getUniformLocation(this.progBgCompose,"uTex"),view:gl.getUniformLocation(this.progBgCompose,"uView"),img:gl.getUniformLocation(this.progBgCompose,"uImg")};
      this.uBlur={tex:gl.getUniformLocation(this.progBlur,"uTex"),step:gl.getUniformLocation(this.progBlur,"uStep"),dir:gl.getUniformLocation(this.progBlur,"uDir"),radius:gl.getUniformLocation(this.progBlur,"uRadius")};
      /* 背景原始纹理（1x1 占位，setBackground 时更新） */
      this.bgTex=gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D,this.bgTex);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,0]));
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    }
    /* 创建视口尺寸的 UNSIGNED_BYTE FBO（背景合成 / 模糊用） */
    _makeByteTarget(w,h){
      const gl=this.gl;
      const tex=gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D,tex);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      const fbo=gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      return {tex,fbo,w,h};
    }
    _freeTarget(t){
      if(!t)return;
      const gl=this.gl;
      gl.deleteTexture(t.tex);gl.deleteFramebuffer(t.fbo);
    }
    /* 确保背景合成/模糊 FBO 存在且匹配视口尺寸 */
    _ensureBgFBOs(){
      const vw=Math.max(2,Math.floor(window.innerWidth||1));
      const vh=Math.max(2,Math.floor(window.innerHeight||1));
      if(this._bgViewW===vw&&this._bgViewH===vh&&this.bgView)return;
      this._freeTarget(this.bgView);this._freeTarget(this.bgBlurA);this._freeTarget(this.bgBlurB);
      this.bgView=this._makeByteTarget(vw,vh);
      this.bgBlurA=this._makeByteTarget(vw,vh);
      this.bgBlurB=this._makeByteTarget(vw,vh);
      this._bgViewW=vw;this._bgViewH=vh;
      this._bgDirty=true;
    }
    /* 把 quad 画到当前绑定的目标 */
    _drawQuadTo(aPos){
      const gl=this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
      gl.drawArrays(gl.TRIANGLES,0,6);
    }
    /* 重新合成背景（cover）并按需模糊，结果存入 bgBlurB/bgView */
    _regenBg(){
      const gl=this.gl;
      const vw=this._bgViewW,vh=this._bgViewH;
      gl.disable(gl.BLEND);
      /* 合成：bgTex(原始) → bgView（cover 到视口） */
      gl.useProgram(this.progBgCompose);
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.bgView.fbo);
      gl.viewport(0,0,vw,vh);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D,this.bgTex);
      gl.uniform1i(this.uCompose.tex,0);
      gl.uniform2f(this.uCompose.view,vw,vh);
      gl.uniform2f(this.uCompose.img,this._bgImgW,this._bgImgH);
      this._drawQuadTo(gl.getAttribLocation(this.progBgCompose,"aPos"));
      /* 烤鸡：强制背景模糊 + 多次模糊迭代，放大可分离高斯 pass 负载 */
      const effBlur = this._bgBlur + (this._toast ? (this._toastBlur||0) : 0);
      const blurIters = this._toast ? 3 : 1;
      if(effBlur>0){
        for(let i=0;i<blurIters;i++){
          /* 水平模糊：bgView → bgBlurA */
          gl.useProgram(this.progBlur);
          gl.bindFramebuffer(gl.FRAMEBUFFER,this.bgBlurA.fbo);
          gl.viewport(0,0,vw,vh);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D,this.bgView.tex);
          gl.uniform1i(this.uBlur.tex,0);
          gl.uniform2f(this.uBlur.step,1/vw,1/vh);
          gl.uniform2f(this.uBlur.dir,1,0);
          gl.uniform1f(this.uBlur.radius,effBlur*0.8);
          this._drawQuadTo(gl.getAttribLocation(this.progBlur,"aPos"));
          /* 垂直模糊：bgBlurA → bgBlurB */
          gl.bindFramebuffer(gl.FRAMEBUFFER,this.bgBlurB.fbo);
          gl.viewport(0,0,vw,vh);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D,this.bgBlurA.tex);
          gl.uniform2f(this.uBlur.dir,0,1);
          this._drawQuadTo(gl.getAttribLocation(this.progBlur,"aPos"));
          /* 迭代：把结果拷回 bgView 作为下一轮输入 */
          if(i<blurIters-1){
            gl.bindFramebuffer(gl.FRAMEBUFFER,this.bgView.fbo);
            gl.viewport(0,0,vw,vh);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D,this.bgBlurB.tex);
            gl.uniform2f(this.uBlur.dir,1,0);
            this._drawQuadTo(gl.getAttribLocation(this.progBlur,"aPos"));
          }
        }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      this._bgDirty=false;
    }
    /* 设置/清除背景图：src 为 data URL 或 null；blur 单位 px，dim 0..1。
       src 不变但 blur 变化时仅标记重算模糊（不重新加载图片）。 */
    setBackground(src,blur,dim){
      const blurChanged = (blur||0) !== this._bgBlur;
      this._bgBlur=blur||0;
      this._bgDim=dim||0;
      const gl=this.gl;
      if(!src){
        this._bgActive=false;
        this._bgSrc=null;
        return;
      }
      if(src===this._bgSrc){
        /* 图片未变：模糊变化或烤鸡首次激活时需重算合成+模糊 */
        if((blurChanged || (this._toast && !this._bgDirty)) && this._bgActive) this._bgDirty=true;
        return;
      }
      this._bgSrc=src;
      const img=new Image();
      img.onload=()=>{
        gl.bindTexture(gl.TEXTURE_2D,this.bgTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
        this._bgImgW=img.naturalWidth||1;
        this._bgImgH=img.naturalHeight||1;
        this._bgActive=true;
        this._bgDirty=true; /* 新图：重算合成+模糊 */
      };
      img.src=src;
    }
    _seedParticles(){
      const gl=this.gl;
      const ifmt=floatIFmt(gl);
      const side=this._texSide;
      const data=new Float32Array(this.N*4);
      for(let i=0;i<this.N;i++){
        data[i*4+0]=0.1+Math.random()*0.8;     /* x */
        data[i*4+1]=0.05+Math.random()*0.9;    /* y：初始填满整个容器 */
        data[i*4+2]=(Math.random()-0.5)*0.1;   /* vx */
        data[i*4+3]=(Math.random()-0.5)*0.1;   /* vy */
      }
      const tmp=gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D,tmp);
      gl.texImage2D(gl.TEXTURE_2D,0,ifmt,side,side,0,gl.RGBA,gl.FLOAT,data);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      /* 拷贝到 stateA / stateB：2D 方形纹理（side×side = N） */
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.stateA.fbo);
      gl.viewport(0,0,side,side);
      gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindTexture(gl.TEXTURE_2D,this.stateA.tex);
      gl.texImage2D(gl.TEXTURE_2D,0,ifmt,side,side,0,gl.RGBA,gl.FLOAT,data);
      gl.bindTexture(gl.TEXTURE_2D,this.stateB.tex);
      gl.texImage2D(gl.TEXTURE_2D,0,ifmt,side,side,0,gl.RGBA,gl.FLOAT,data);
      gl.deleteTexture(tmp);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    }
    setProgress(e){this.progress=Math.min(1,Math.max(0,e))}
    setColors(c1,c2){this.colors=[c1,c2]}
    resize(){
      if(this._fail)return;
      const r=this.container.getBoundingClientRect();
      const dpr=Math.min(window.devicePixelRatio||1,2);
      this.canvas.width=Math.max(2,Math.round(r.width*dpr));
      this.canvas.height=Math.max(2,Math.round(r.height*dpr));
      this.canvas.style.width=r.width+"px";
      this.canvas.style.height=r.height+"px";
      /* field FBO 与 canvas 同分辨率（metaball 法线需像素级梯度，半分辨率会模糊） */
      this._ensureField(this.canvas.width,this.canvas.height);
      /* 背景合成 FBO 跟随视口尺寸（窗口缩放时重建） */
      this._ensureBgFBOs();
    }
    /* 按需重建 field FBO：尺寸变化或首次创建。
       用 UNSIGNED_BYTE 纹理（亮度场不需要浮点精度，且避免 FLOAT 渲染目标驱动坑）。 */
    _ensureField(w,h){
      if(this._fieldW===w&&this._fieldH===h&&this.field)return;
      const gl=this.gl;
      if(this.field){
        gl.deleteTexture(this.field.tex);
        gl.deleteFramebuffer(this.field.fbo);
      }
      const tex=gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D,tex);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      const fbo=gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      this.field={tex,fbo,w,h};
      this._fieldW=w;this._fieldH=h;
    }
    start(){
      if(this._fail||this.running)return;
      this.running=true;
      this.lastT=performance.now();
      this._tick=this._frame.bind(this);
      this.raf=requestAnimationFrame(this._tick);
    }
    stop(){
      this.running=false;
      if(this.raf)cancelAnimationFrame(this.raf);
    }
    destroy(){
      this.stop();
      if(this.canvas&&this.canvas.parentNode)this.canvas.parentNode.removeChild(this.canvas);
      this._freeTarget(this.bgView);this._freeTarget(this.bgBlurA);this._freeTarget(this.bgBlurB);
      this.bgView=this.bgBlurA=this.bgBlurB=null;
      this.gl=null;
    }
    _frame(now){
      if(!this.running)return;
      const dt=Math.min(0.033,(now-this.lastT)/1000);
      this.lastT=now;
      this._step(dt,now/1000);
      this._render();
      /* 烤鸡模式：脱离 vsync 连续渲染，压满 GPU。
         - 不用 gl.finish()：它会同步阻塞主线程等 GPU 完成，导致 UI 卡死。
           改为纯异步提交 GPU 命令，主线程不阻塞，能正常响应输入/动画。
         - MessageChannel 零延迟调度（vs setTimeout 4ms 钳制、rAF 16ms 钳制），
           主线程一完成 _step/_render 就立即调度下一帧，持续向 GPU 命令队列
           填充工作，GPU 因队列持续不断而保持高负载。
         普通模式仍用 rAF 保持 60Hz 平滑、低功耗。 */
      if(this._toast){
        const ch=new MessageChannel();
        ch.port1.onmessage=()=>this._tick(performance.now());
        ch.port2.postMessage(null);
      }else{
        this.raf=requestAnimationFrame(this._tick);
      }
    }
    _step(dt,time){
      const gl=this.gl;
      /* 液面高度：progress 0→满(0.98)，1→空(0.05) */
      const surface=0.98-this.progress*0.93;
      /* 烤鸡：每帧多次模拟子步，线性放大 GPU 模拟 pass 负载 */
      const sub = this._toast ? 6 : 1;
      const sdt = dt / sub;
      for(let i=0;i<sub;i++){
        gl.useProgram(this.progUpdate);
        gl.bindFramebuffer(gl.FRAMEBUFFER,this.stateB.fbo);
        gl.viewport(0,0,this._texSide,this._texSide);
        gl.disable(gl.BLEND);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D,this.stateA.tex);
        gl.uniform1i(this.uUpdate.state,0);
        gl.uniform1f(this.uUpdate.dt,sdt);
        gl.uniform1f(this.uUpdate.time,time+i*sdt);
        gl.uniform1f(this.uUpdate.surface,surface);
        gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
        const aPos=gl.getAttribLocation(this.progUpdate,"aPos");
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
        gl.drawArrays(gl.TRIANGLES,0,6);
        /* swap */
        const t=this.stateA;this.stateA=this.stateB;this.stateB=t;
      }
      this._surface=surface;
      this._time=time;
    }
    _render(){
      const gl=this.gl;
      const w=this.canvas.width,h=this.canvas.height;
      const surface=this._surface!=null?this._surface:0.98;
      /* 背景合成+模糊（在粒子 pass 之前完成，避免污染 blend 状态）。
         烤鸡模式：每帧强制重算背景模糊（即使图片未变），放大可分离高斯 pass 负载。
         非烤鸡：仅在 _bgDirty（图片变化/首次）时重算，避免无谓开销。 */
      if(this._bgActive){
        this._ensureBgFBOs();
        if(this._toast || this._bgDirty) this._regenBg();
      }
      /* ---- Pass 1: 渲染粒子为高斯亮度场到 field FBO（加法混合累加） ---- */
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.field.fbo);
      gl.viewport(0,0,w,h);
      gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE,gl.ONE); /* 加性累加亮度 */
      gl.useProgram(this.progField);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D,this.stateA.tex);
      gl.uniform1i(this.uField.state,0);
      gl.uniform1f(this.uField.n,this.N);
      gl.uniform1f(this.uField.texW,this._texSide);
      /* 点大小按 DPR 缩放：粒子要足够大以产生连续亮度场（metaball 融合）。
         烤鸡用更大点精灵，拉高光栅化片段数（65536 大点 → 巨量片元）。 */
      const dpr=Math.min(window.devicePixelRatio||1,2);
      gl.uniform1f(this.uField.ps, (this._toast?44.0:28.0)*dpr);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.idxBuf);
      gl.enableVertexAttribArray(this.aField.index);
      gl.vertexAttribPointer(this.aField.index,1,gl.FLOAT,false,0,0);
      gl.drawArrays(gl.POINTS,0,this.N);
      /* ---- Pass 2: Metaball 液体表面（阈值化 + 光照）渲染到 canvas ---- */
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      gl.viewport(0,0,w,h);
      gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA); /* 预乘 alpha */
      gl.useProgram(this.progLiquid);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D,this.field.tex);
      gl.uniform1i(this.uLiquid.field,0);
      gl.uniform2f(this.uLiquid.texel,1/w,1/h);
      gl.uniform3f(this.uLiquid.c1,this.colors[0][0]/255,this.colors[0][1]/255,this.colors[0][2]/255);
      gl.uniform3f(this.uLiquid.c2,this.colors[1][0]/255,this.colors[1][1]/255,this.colors[1][2]/255);
      gl.uniform1f(this.uLiquid.surface,surface);
      gl.uniform1f(this.uLiquid.time,this._time||0);
      /* 背景：绑定已合成的视口纹理（含 cover 与模糊）。
         烤鸡模式强制使用模糊结果（即使设置 blur=0），保证模糊 pass 负载。 */
      const effBlur = this._bgBlur + (this._toast ? (this._toastBlur||0) : 0);
      gl.activeTexture(gl.TEXTURE1);
      let bgTex=this.bgTex;
      if(this._bgActive){
        bgTex = (effBlur>0 && this.bgBlurB) ? this.bgBlurB.tex : (this.bgView?this.bgView.tex:this.bgTex);
      }
      gl.bindTexture(gl.TEXTURE_2D,bgTex);
      gl.uniform1i(this.uLiquid.bg,1);
      gl.uniform1f(this.uLiquid.bgActive,this._bgActive?1:0);
      gl.uniform1f(this.uLiquid.bgDim, this._bgDim||0);
      /* 视口尺寸 + 液体盒在视口中的矩形（每帧读取，跟随防烧屏漂移） */
      const vw=window.innerWidth||1, vh=window.innerHeight||1;
      gl.uniform2f(this.uLiquid.bgView, vw, vh);
      const rect=this.canvas.getBoundingClientRect();
      gl.uniform4f(this.uLiquid.bgBox, rect.left, rect.top, rect.width, rect.height);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
      gl.enableVertexAttribArray(this.aLiquid.pos);
      gl.vertexAttribPointer(this.aLiquid.pos,2,gl.FLOAT,false,0,0);
      gl.drawArrays(gl.TRIANGLES,0,6);
    }
  }

  A.fluid={HeightFieldFluid,ParticleFluid};
})(window.App);