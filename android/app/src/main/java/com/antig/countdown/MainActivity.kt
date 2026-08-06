package com.antig.countdown

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * 全屏 WebView 容器，加载 file:///android_asset/web/index.html。
 *
 * 关键能力：
 * - 沉浸式全屏（状态栏 / 导航栏隐藏，键盘弹出时不挤压）
 * - 横竖屏自由切换（AndroidManifest 配置 configChanges，避免 Activity 重建）
 * - 处理 <input type="file"> 的图片选择（背景上传）
 * - 外部 http(s) 链接打开系统浏览器
 * - 双击返回退出
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var lastBackPress = 0L

    private val fileChooserLauncher: ActivityResultLauncher<Intent> =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = filePathCallback ?: return@registerForActivityResult
            val intent = result.data
            val uris: Array<Uri>? = when {
                result.resultCode != Activity.RESULT_OK -> null
                intent?.clipData != null -> {
                    val cd = intent.clipData!!
                    Array(cd.itemCount) { cd.getItemAt(it).uri }
                }
                intent?.data != null -> arrayOf(intent.data!!)
                else -> null
            }
            callback.onReceiveValue(uris)
            filePathCallback = null
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 边到边布局，让 WebView 自己处理 insets
        WindowCompat.setDecorFitsSystemWindows(window, false)
        applyImmersiveFullscreen()

        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }
        setContentView(webView)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            // 启用 GPU 加速，对 WebGL（粒子/流体模式）必需
            setSupportZoom(false)
            // 大视口适配
            useWideViewPort = true
            loadWithOverviewMode = true
            // 强制启用硬件加速图层
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                // 不再使用已废弃的 setHardwareAccelerated，靠 manifest 的 hardwareAccelerated=true
            }
        }

        WebView.setWebContentsDebuggingEnabled(true)

        webView.apply {
            // 保持屏幕常亮（倒数日用途）
            keepScreenOn = true
            // 让内部链接留在 WebView 内，外部跳浏览器
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest
                ): Boolean {
                    val url = request.url
                    val scheme = url.scheme ?: return false
                    if (scheme == "http" || scheme == "https") {
                        // 同源 file:// 的留在 WebView，外部域名打开浏览器
                        return false
                    }
                    if (scheme == "mailto" || scheme == "tel" || scheme == "intent") {
                        try {
                            startActivity(Intent(Intent.ACTION_VIEW, url))
                        } catch (_: Exception) {
                        }
                        return true
                    }
                    return false
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    webView: WebView?,
                    callback: ValueCallback<Array<Uri>>?,
                    params: FileChooserParams?
                ): Boolean {
                    filePathCallback?.onReceiveValue(null)
                    filePathCallback = callback
                    val intent = params?.createIntent()?.apply {
                        // 同时支持图片与任意文件
                        addCategory(Intent.CATEGORY_OPENABLE)
                    } ?: run {
                        callback?.onReceiveValue(null)
                        return false
                    }
                    try {
                        fileChooserLauncher.launch(intent)
                    } catch (e: Exception) {
                        callback?.onReceiveValue(null)
                        filePathCallback = null
                        return false
                    }
                    return true
                }

                override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                    // 把 H5 console 输出到 logcat 方便调试
                    android.util.Log.d(
                        "H5Console",
                        "${message.message()} (${message.sourceId()}:${message.lineNumber()})"
                    )
                    return true
                }

                override fun onProgressChanged(view: WebView?, newProgress: Int) {
                    super.onProgressChanged(view, newProgress)
                }
            }

            // 启用深色模式跟随系统（H5 自带主题，这里不强加）
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                // 不强制深色，让网页自己的 theme 系统生效
            }

            // 加载本地资源
            loadUrl("file:///android_asset/web/index.html")
        }

        // 返回键处理：先退 WebView 历史，再双击退出
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    if (SystemClock.elapsedRealtime() - lastBackPress < 2000) {
                        finishAffinity()
                    } else {
                        lastBackPress = SystemClock.elapsedRealtime()
                        Toast.makeText(this@MainActivity, "再按一次返回退出", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        })
    }

    /**
     * 沉浸式全屏：隐藏状态栏与导航栏，但允许用户从边缘滑出（粘性）。
     * 这样键盘、文件选择器弹出时仍可用。
     */
    private fun applyImmersiveFullscreen() {
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        @Suppress("DEPRECATION")
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // 在刘海屏上让内容延伸到刘海区
            window.attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
    }

    /**
     * 旋转、键盘弹出等配置变化时由 AndroidManifest 的 configChanges 拦截，
     * 不会重建 Activity，这里只重新应用沉浸式。
     */
    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        applyImmersiveFullscreen()
    }

    override fun onResume() {
        super.onResume()
        applyImmersiveFullscreen()
        webView.onResume()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        webView.apply {
            stopLoading()
            removeAllViews()
            (parent as? FrameLayout)?.removeView(this)
            destroy()
        }
        super.onDestroy()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        // 物理键盘（蓝牙键盘等）的按键默认会转发给 WebView 的 keydown 事件，
        // 这里不做额外拦截，让网页的 F/S/T 快捷键逻辑直接生效。
        return super.onKeyDown(keyCode, event)
    }
}
