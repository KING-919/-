package com.nova.agent.mobile

import android.content.Context
import android.os.BatteryManager
import android.os.Build
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors

class BridgeHttpServer(
    private val context: Context,
    private val port: Int = 8765,
    private val tokenProvider: () -> String,
    private val allowLanProvider: () -> Boolean
) {
    @Volatile
    private var running = false
    private var serverSocket: ServerSocket? = null
    private val pool = Executors.newCachedThreadPool()

    fun start() {
        if (running) return
        running = true
        pool.execute {
            try {
                val bindAddr = if (allowLanProvider()) InetAddress.getByName("0.0.0.0") else InetAddress.getByName("127.0.0.1")
                serverSocket = ServerSocket(port, 32, bindAddr)
                while (running) {
                    val client = serverSocket?.accept() ?: break
                    pool.execute { handleClient(client) }
                }
            } catch (_: Exception) {
                running = false
            }
        }
    }

    fun stop() {
        running = false
        try {
            serverSocket?.close()
        } catch (_: Exception) {
        }
        serverSocket = null
    }

    private fun handleClient(socket: Socket) {
        socket.use { s ->
            s.soTimeout = 10000
            val input = BufferedInputStream(s.getInputStream())
            val rawHeaderBytes = ByteArrayOutputStream()
            var cur: Int
            var matchState = 0
            while (true) {
                cur = input.read()
                if (cur == -1) break
                rawHeaderBytes.write(cur)
                if (matchState == 0 && cur == '\r'.code) matchState = 1
                else if (matchState == 1 && cur == '\n'.code) matchState = 2
                else if (matchState == 2 && cur == '\r'.code) matchState = 3
                else if (matchState == 3 && cur == '\n'.code) break
                else matchState = if (cur == '\r'.code) 1 else 0
                if (rawHeaderBytes.size() > 32768) break
            }

            val headerText = rawHeaderBytes.toString(StandardCharsets.UTF_8.name())
            val lines = headerText.split("\r\n")
            if (lines.isEmpty()) return
            val requestParts = lines[0].split(" ")
            if (requestParts.size < 2) return
            val method = requestParts[0].uppercase()
            val fullPath = requestParts[1]
            val path = fullPath.substringBefore('?')
            val query = fullPath.substringAfter('?', "")

            val headers = HashMap<String, String>()
            var contentLength = 0
            for (i in 1 until lines.size) {
                val line = lines[i]
                val colon = line.indexOf(':')
                if (colon > 0) {
                    val k = line.substring(0, colon).trim().lowercase()
                    val v = line.substring(colon + 1).trim()
                    headers[k] = v
                    if (k == "content-length") contentLength = v.toIntOrNull() ?: 0
                }
            }

            var bodyStr = ""
            if (contentLength > 0 && contentLength < 1024 * 1024) {
                val buf = ByteArray(contentLength)
                var readTotal = 0
                while (readTotal < contentLength) {
                    val n = input.read(buf, readTotal, contentLength - readTotal)
                    if (n <= 0) break
                    readTotal += n
                }
                bodyStr = String(buf, 0, readTotal, StandardCharsets.UTF_8)
            }

            val expectedToken = tokenProvider().trim()
            if (expectedToken.isNotEmpty() && path != "/status") {
                val auth = headers["authorization"]?.removePrefix("Bearer ")?.trim() ?: ""
                val xToken = headers["x-nova-token"] ?: ""
                if (auth != expectedToken && xToken != expectedToken) {
                    writeJson(s, 401, JSONObject().put("ok", false).put("error", "Unauthorized bridge token"))
                    return
                }
            }

            val (statusCode, payload) = dispatch(method, path, query, bodyStr)
            writeJson(s, statusCode, payload)
        }
    }

    private fun dispatch(method: String, path: String, query: String, bodyStr: String): Pair<Int, JSONObject> {
        if (path == "/status") {
            val svc = NovaAccessibilityService.instance
            val bm = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
            val battery = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
            return 200 to JSONObject().apply {
                put("ok", true)
                put("accessibilityEnabled", svc != null)
                put("device", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
                put("androidVersion", Build.VERSION.RELEASE ?: "")
                put("battery", if (battery >= 0) battery else JSONObject.NULL)
            }
        }

        val svc = NovaAccessibilityService.instance
            ?: return 503 to JSONObject().apply {
                put("ok", false)
                put("error", "خدمة إمكانية الوصول NOVA غير مفعّلة على الجوال. افتح التطبيق واضغط «تفعيل التحكم».")
            }

        val body = try {
            if (bodyStr.isBlank()) JSONObject() else JSONObject(bodyStr)
        } catch (_: Exception) {
            JSONObject()
        }

        return when {
            method == "GET" && path == "/device" -> 200 to svc.getDeviceInfo()
            method == "GET" && path == "/screen" -> {
                val all = query.contains("all=1")
                200 to svc.dumpScreen(all)
            }
            method == "POST" && path == "/tap" -> {
                val x = if (body.has("x") && !body.isNull("x")) body.optDouble("x").toFloat() else null
                val y = if (body.has("y") && !body.isNull("y")) body.optDouble("y").toFloat() else null
                val text = body.optString("text", "")
                val id = body.optString("id", "")
                val res = svc.performTap(x, y, text, id)
                (if (res.optBoolean("ok")) 200 else 400) to res
            }
            method == "POST" && path == "/swipe" -> {
                val x1 = body.optDouble("x1", 500.0).toFloat()
                val y1 = body.optDouble("y1", 1500.0).toFloat()
                val x2 = body.optDouble("x2", 500.0).toFloat()
                val y2 = body.optDouble("y2", 500.0).toFloat()
                val dur = body.optLong("durationMs", 350L)
                val res = svc.performSwipe(x1, y1, x2, y2, dur)
                (if (res.optBoolean("ok")) 200 else 400) to res
            }
            method == "POST" && path == "/type" -> {
                val text = body.optString("text", "")
                val targetText = body.optString("targetText", "")
                val targetId = body.optString("targetId", "")
                val pressEnter = body.optBoolean("pressEnter", false)
                val res = svc.performType(text, targetText, targetId, pressEnter)
                (if (res.optBoolean("ok")) 200 else 400) to res
            }
            method == "POST" && path == "/key" -> {
                val key = body.optString("key", "")
                val res = svc.performSystemKey(key)
                (if (res.optBoolean("ok")) 200 else 400) to res
            }
            method == "GET" && path == "/apps" -> 200 to svc.listLaunchableApps()
            method == "POST" && path == "/open" -> {
                val app = body.optString("app", "")
                val res = svc.openApp(app)
                (if (res.optBoolean("ok")) 200 else 404) to res
            }
            else -> 404 to JSONObject().put("ok", false).put("error", "Not found: $path")
        }
    }

    private fun writeJson(socket: Socket, code: Int, json: JSONObject) {
        val bodyBytes = json.toString().toByteArray(StandardCharsets.UTF_8)
        val statusText = when (code) {
            200 -> "OK"
            400 -> "Bad Request"
            401 -> "Unauthorized"
            404 -> "Not Found"
            503 -> "Service Unavailable"
            else -> "Error"
        }
        val headers = "HTTP/1.1 $code $statusText\r\n" +
            "Content-Type: application/json; charset=utf-8\r\n" +
            "Content-Length: ${bodyBytes.size}\r\n" +
            "Connection: close\r\n\r\n"
        val out = socket.getOutputStream()
        out.write(headers.toByteArray(StandardCharsets.US_ASCII))
        out.write(bodyBytes)
        out.flush()
    }
}
