# ⏳ 倒数日

> 一个以「时间流逝可视化」为核心的倒数日页面 —— 用方格、波浪、流体与粒子，把抽象的时间变成可看见的洪流。

纯 HTML / CSS / JavaScript 实现，零依赖、零构建，打开即用。UI 遵循 Apple Liquid Glass 设计语言，支持日间 / 暗色 / OLED 三种主题与多种进度可视化样式。

![主界面 · 方格模式](screenshots/grid-light.png)

---

## ✨ 特性一览

| 能力 | 说明 |
| --- | --- |
| **四种今日进度样式** | 方格 · 波浪（SVG）· 流体（浅水方程 WebGL）· 粒子（GPU 粒子流体） |
| **双栏进度** | 今日时间流逝 + 总进度，三种布局比例可切换 |
| **Liquid Glass UI** | 参考 Apple HIG Regular 变体：半透明、折射模糊、边缘高光 |
| **三主题** | 日间 · 暗色 · OLED（纯黑省电） |
| **五套配色 + 自定义** | 极光 / 暮光 / 余烬 / 薄荷 / 石墨，支持自定义流体颜色 |
| **自定义背景** | 上传图片 → 裁切 → 模糊 / 压暗，液面实时折射背景 |
| **防烧屏** | 缓慢随机位移，保护 OLED 屏幕 |
| **烤鸡模式** | 粒子模式专属子开关：262144 粒子 + 多线程 CPU 满载压力测试 |
| **全屏沉浸** | 闲置自动隐藏 UI，鼠标唤醒 |
| **实时保存** | 所有改动自动写入 localStorage，刷新不丢失 |
| **零依赖** | 不依赖任何框架、库或构建工具 |

---

## 🚀 快速开始

### 方式一：直接打开

下载本项目，双击 `index.html` 即可在浏览器中运行。

> ⚠️ 粒子 / 流体模式需要 WebGL 支持。如通过 `file://` 协议打开，部分浏览器的浮点纹理功能可能受限，推荐使用本地服务器。

### 方式二：本地服务器（推荐）

```bash
# 进入项目目录
cd antig-web

# Python 3
python -m http.server 8080

# 或 Node.js (需先 npm i -g serve)
serve -p 8080
```

浏览器访问 `http://localhost:8080`。

### 方式三：部署到静态托管

将整个文件夹上传至 GitHub Pages / Vercel / Netlify / Cloudflare Pages 等任意静态托管平台即可，无需额外配置。

### 方式四：Android APK

本项目自带 GitHub Actions 自动构建脚本，push 到 `main` 分支或手动触发即可在云端编译出可安装的 APK，**本地无需 Android Studio / Node 环境**。

1. 仓库 → **Actions** 选项卡 → **Build Android APK** workflow
2. 点击 **Run workflow**（可选填版本号）
3. 等待构建完成后，APK 会自动作为 **Release 资产** 发布到仓库的 Releases 页面
4. 下载 `countdown-*.apk`，手机允许「安装未知来源应用」后点击安装

APK 特性：

- 沉浸式全屏（隐藏状态栏 / 导航栏，边缘滑出可唤出）
- 横竖屏自由切换，旋转不重建 Activity
- WebView 加载本地资源，WebGL 粒子 / 流体模式正常
- 支持背景图选择（已实现 `onShowFileChooser`）
- 双击返回退出
- 当前使用 debug 签名，可正常安装使用；上架 Play Store 需自行配置 release keystore

> 项目结构与构建细节见 [android/](android/) 目录与 [.github/workflows/android.yml](.github/workflows/android.yml)。

---

## ⌨️ 快捷键

| 按键 | 功能 |
| :---: | :--- |
| `F` | 切换全屏 |
| `S` | 打开 / 关闭设置面板 |
| `T` | 循环切换主题（日间 → 暗色 → OLED） |
| `Esc` | 关闭设置面板 |
| 双击方格区 | 切换全屏 |

---

## 🎨 自定义指南

### 设置事件

打开设置面板（按 `S` 或点击右上角齿轮），输入事件名称、开始日期与目标日期，或使用快速选择（7 天 / 30 天 / 100 天 / 一年后）。所有改动实时生效并自动保存。

### 切换进度样式

在设置面板的「今日进度样式」中选择：

- **方格** —— 经典像素方格矩阵，随时间逐格点亮
- **波浪** —— SVG 水面波浪，液位随今日剩余时间下降
- **流体** —— WebGL 浅水方程模拟，真实波传播 + 鼠标涟漪
- **粒子** —— GPU 粒子流体，重力堆积 + 鼠标搅动 + 背景折射

### 自定义配色

1. 在「配色方案」中选择预设方案
2. 点击颜色选择器自定义起始色与结束色
3. 点击「重置当前方案」恢复默认

### 自定义背景

1. 点击「选择图片」上传背景图
2. 在裁切弹窗中调整裁切区域与比例
3. 应用后可调节背景模糊与压暗程度
4. 流体 / 粒子模式下，液面会实时折射背景

### 调整布局

- **今日为主** —— 今日方格占大，总进度缩小
- **各占一半** —— 两侧等宽
- **总进度为主** —— 总进度占大，今日缩写

点击中间的分隔条也可循环切换布局，切换带平滑动画。

---

## 🔥 烤鸡模式

烤鸡模式是粒子模式下的专属子开关，用于 GPU / CPU 压力测试：

- **GPU 压力**：262144 粒子（256×256 纹理），6 子步模拟，逐帧背景模糊
- **CPU 压力**：启动 `navigator.hardwareConcurrency - 4` 个 Web Worker，以 Leibniz 级数循环计算圆周率，目标 80% CPU 占用

> ⚠️ **警告**：烤鸡模式会显著拉高功耗与发热，仅用于压力测试，请勿长时间开启。

---

## 🏗️ 项目结构

```
antig-web/
├── index.html              # 页面入口
├── css/
│   ├── theme.css           # 主题与配色变量
│   ├── glass.css           # Liquid Glass 液态玻璃效果
│   ├── layout.css          # 布局与方格矩阵
│   └── panel.css           # 设置面板样式
├── js/
│   ├── state.js            # 状态管理与持久化
│   ├── fluid.js            # WebGL 流体 / 粒子模拟
│   ├── grid.js             # 方格矩阵与样式切换
│   ├── tick.js             # 时间计算与刷新
│   ├── panel.js            # 设置面板逻辑
│   └── main.js             # 主入口：主题、全屏、快捷键
├── android/                # Android WebView 套壳
│   ├── app/                # app 模块
│   ├── build.gradle.kts    # 根构建脚本
│   └── settings.gradle.kts # 项目设置
├── .github/workflows/
│   └── android.yml         # GitHub Actions APK 构建流水线
└── screenshots/            # README 截图
```

---

## 🔬 技术细节

### Liquid Glass 液态玻璃

参考 Apple Liquid Glass HIG 的 Regular 变体，通过 `backdrop-filter` 模糊 + 多层 `box-shadow`（内边缘高光、内阴影、外投影）+ 伪元素斜向高光实现。三种主题共用同一套规范，仅调整透明度与颜色变量：

```css
.glass {
  background: var(--glass-bg);              /* 0.10–0.55 透明度 */
  backdrop-filter: blur(22px) saturate(1.8);
  box-shadow:
    inset 0 1px 0.5px var(--glass-rim),     /* 顶部边缘高光 */
    inset 0 -1px 1px rgba(0,0,0,0.12),      /* 底部内阴影 */
    var(--glass-shadow);                    /* 外投影 */
}
```

### WebGL 流体模拟

`fluid.js` 包含两套独立的 WebGL 实现，统一接口（`setProgress` / `setColors` / `resize` / `destroy`）：

**HeightFieldFluid（流体模式）**
- 一维浅水方程，侧视容器液体
- FBO ping-pong 模拟，鼠标交互产生涟漪
- 法线光照 + 背景折射（UV 偏移采样）

**ParticleFluid（粒子模式）**
- GPU 粒子系统，状态存储于 2D 浮点纹理（128×128 / 256×256）
- 三遍渲染管线：粒子更新 → 高斯密度场 → 阈值化液面 + 法线光照
- 128×128 网格分布粒子，弹簧力维持位置，确保紧贴容器壁
- 鼠标搅动 + 背景折射

### 烤鸡模式 CPU 压力

使用 Blob URL 内联创建 Web Worker（无需额外文件），每个 Worker 以 Leibniz 级数循环计算圆周率，通过 `setTimeout` 插入 25% 空闲实现 80% 目标 CPU 占用。Worker 数量取 `navigator.hardwareConcurrency - 4`，为 GPU 渲染留余量。

### 状态持久化

所有设置存储于 `localStorage`（key: `countdown-page-v5`），支持旧版配置迁移（单一 `cellSize` → 分离 `cellToday` / `cellTotal`，方格下限提升至 9px）。

---

## 🌐 浏览器兼容

| 浏览器 | 支持情况 |
| :---: | :--- |
| Chrome / Edge 90+ | ✅ 完整支持 |
| Firefox 90+ | ✅ 完整支持 |
| Safari 15+ | ✅ 完整支持 |
| 移动端 Safari / Chrome | ⚠️ 基本可用，`backdrop-filter` 与 WebGL 表现因设备而异 |

> 流体 / 粒子模式需要 WebGL2 或 WebGL1 + `OES_texture_float` 扩展。如环境不支持，会静默降级，不影响其他功能。

---

## 📜 开源协议

本项目采用 [MIT License](LICENSE) 开源，可自由使用、修改与分发。

---

## 🙏 致谢

- [Apple Liquid Glass](https://developer.apple.com/design/human-interface-guidelines/materials) —— 液态玻璃设计语言参考
- [Tailwind CSS](https://tailwindcss.com) 调色板 —— 配色方案灵感
- 所有为时间可视化探索贡献想法的人

---

<p align="center">让每一秒都被看见 ⏳</p>
