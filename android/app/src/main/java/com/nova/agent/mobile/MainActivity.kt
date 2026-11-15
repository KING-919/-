package com.nova.agent.mobile

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import java.net.Inet4Address
import java.net.NetworkInterface

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var statusView: TextView
    private lateinit var accBtn: Button
    private lateinit var urlPanel: LinearLayout
    private lateinit var urlInput: EditText
    private var currentServerUrl = "http://127.0.0.1:3000"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val prefs = getSharedPreferences("nova_prefs", Context.MODE_PRIVATE)
        currentServerUrl = prefs.getString("server_url", "http://127.0.0.1:3000") ?: "http://127.0.0.1:3000"

        webView = findViewById(R.id.webview)
        statusView = findViewById(R.id.tv_bridge_status)
        accBtn = findViewById(R.id.btn_accessibility)
        urlPanel = findViewById(R.id.url_bar_panel)
        urlInput = findViewById(R.id.et_server_url)
        val toggleUrlBtn: Button = findViewById(R.id.btn_toggle_url)
        val connectBtn: Button = findViewById(R.id.btn_connect_url)

        urlInput.setText(currentServerUrl)

        accBtn.setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }

        toggleUrlBtn.setOnClickListener {
            urlPanel.visibility = if (urlPanel.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        }

        connectBtn.setOnClickListener {
            var next = urlInput.text.toString().trim()
            if (next.isNotEmpty()) {
                if (!next.startsWith("http://") && !next.startsWith("https://")) {
                    next = "http://$next"
                }
                currentServerUrl = next
                prefs.edit().putString("server_url", next).apply()
                urlPanel.visibility = View.GONE
                webView.loadUrl(currentServerUrl)
            }
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            useWideViewPort = true
            loadWithOverviewMode = true
        }

        webView.addJavascriptInterface(object {
            @JavascriptInterface
            fun getStatusText(): String {
                val ip = localIpAddress() ?: "127.0.0.1"
                return "Bridge: http://$ip:8765  (Local: http://127.0.0.1:8765)"
            }
        }, "NovaBridgeInfo")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost") || url.startsWith(currentServerUrl)) {
                    return false
                }
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                return true
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame == true) {
                    view?.loadUrl("file:///android_asset/offline.html")
                }
            }
        }

        startBridgeService()
        webView.loadUrl(currentServerUrl)
    }

    override fun onResume() {
        super.onResume()
        refreshBridgeStatus()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (this::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    private fun startBridgeService() {
        val intent = Intent(this, NovaBridgeService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ContextCompat.startForegroundService(this, intent)
        } else {
            startService(intent)
        }
    }

    private fun refreshBridgeStatus() {
        val enabled = NovaAccessibilityService.isConnected()
        val ip = localIpAddress() ?: "127.0.0.1"
        statusView.text = if (enabled) {
            "NOVA · $ip:8765 ✓"
        } else {
            "NOVA · $ip:8765 (اضغط تفعيل التحكم)"
        }
        accBtn.text = if (enabled) getString(R.string.accessibility_on) else getString(R.string.enable_accessibility)
        accBtn.setTextColor(
            ContextCompat.getColor(this, if (enabled) R.color.ember_green else R.color.ember_accent)
        )
    }

    private fun localIpAddress(): String? {
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces() ?: return null
            for (intf in interfaces) {
                val addrs = intf.inetAddresses
                for (addr in addrs) {
                    if (!addr.isLoopbackAddress && addr is Inet4Address) {
                        return addr.hostAddress
                    }
                }
            }
        } catch (_: Exception) {
        }
        return null
    }
}
