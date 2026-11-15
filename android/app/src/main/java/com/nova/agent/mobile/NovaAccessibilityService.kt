package com.nova.agent.mobile

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Path
import android.graphics.Rect
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.util.DisplayMetrics
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class NovaAccessibilityService : AccessibilityService() {

    companion object {
        @Volatile
        var instance: NovaAccessibilityService? = null
            private set

        fun isConnected(): Boolean = instance != null
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // State is queried on demand via rootInActiveWindow.
    }

    override fun onInterrupt() {
        // No-op
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    fun getScreenSize(): Pair<Int, Int> {
        val wm = getSystemService(WINDOW_SERVICE) as WindowManager
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = wm.currentWindowMetrics.bounds
            Pair(bounds.width(), bounds.height())
        } else {
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getRealMetrics(metrics)
            Pair(metrics.widthPixels, metrics.heightPixels)
        }
    }

    fun getDeviceInfo(): JSONObject {
        val (w, h) = getScreenSize()
        val bm = getSystemService(BATTERY_SERVICE) as BatteryManager
        val battery = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        return JSONObject().apply {
            put("ok", true)
            put("transport", "bridge")
            put("accessibilityEnabled", true)
            put("device", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
            put("model", Build.MODEL)
            put("androidVersion", Build.VERSION.RELEASE ?: "")
            put("sdk", Build.VERSION.SDK_INT)
            put("battery", if (battery >= 0) battery else JSONObject.NULL)
            put("screen", JSONObject().apply {
                put("width", w)
                put("height", h)
            })
        }
    }

    fun dumpScreen(includeAll: Boolean = false): JSONObject {
        val root = rootInActiveWindow ?: return JSONObject().apply {
            put("ok", false)
            put("error", "لا توجد نافذة نشطة حاليًا لقراءة محتواها.")
        }

        val (w, h) = getScreenSize()
        val nodes = JSONArray()
        val activePackage = root.packageName?.toString() ?: ""

        fun walk(node: AccessibilityNodeInfo?, depth: Int) {
            if (node == null || depth > 40 || nodes.length() >= 120) return
            val rect = Rect()
            node.getBoundsInScreen(rect)
            val width = rect.width()
            val height = rect.height()
            val text = node.text?.toString()?.trim() ?: ""
            val desc = node.contentDescription?.toString()?.trim() ?: ""
            val fullId = node.viewIdResourceName?.toString()?.trim() ?: ""
            val shortId = fullId.substringAfterLast('/', fullId)
            val cls = node.className?.toString()?.substringAfterLast('.') ?: ""
            val editable = node.isEditable || cls.contains("EditText", ignoreCase = true)
            val clickable = node.isClickable
            val scrollable = node.isScrollable

            if (width > 0 && height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < w && rect.top < h) {
                val relevant = includeAll || clickable || editable || scrollable || text.isNotEmpty() || desc.isNotEmpty()
                if (relevant && (text.isNotEmpty() || desc.isNotEmpty() || clickable || editable)) {
                    val item = JSONObject().apply {
                        put("index", nodes.length())
                        put("text", text)
                        put("desc", desc)
                        put("id", shortId)
                        put("className", cls)
                        put("clickable", clickable)
                        put("editable", editable)
                        put("scrollable", scrollable)
                        put("focused", node.isFocused)
                        put("enabled", node.isEnabled)
                        put("x", rect.centerX())
                        put("y", rect.centerY())
                        put("bounds", JSONArray(listOf(rect.left, rect.top, rect.right, rect.bottom)))
                    }
                    nodes.put(item)
                }
            }

            for (i in 0 until node.childCount) {
                if (nodes.length() >= 120) break
                val child = node.getChild(i)
                walk(child, depth + 1)
            }
        }

        walk(root, 0)

        return JSONObject().apply {
            put("ok", true)
            put("transport", "bridge")
            put("packageName", activePackage)
            put("screen", JSONObject().apply {
                put("width", w)
                put("height", h)
            })
            put("count", nodes.length())
            put("nodes", nodes)
        }
    }

    private fun findNode(
        root: AccessibilityNodeInfo?,
        queryText: String,
        queryId: String,
        preferEditable: Boolean = false
    ): AccessibilityNodeInfo? {
        if (root == null) return null
        val tNeedle = queryText.trim().lowercase()
        val idNeedle = queryId.trim().lowercase()

        var fallbackEditable: AccessibilityNodeInfo? = null
        var focusedNode: AccessibilityNodeInfo? = null

        fun search(node: AccessibilityNodeInfo?, depth: Int): AccessibilityNodeInfo? {
            if (node == null || depth > 40) return null
            if (node.isFocused && node.isEditable) focusedNode = node
            if (fallbackEditable == null && node.isEditable) fallbackEditable = node

            val text = node.text?.toString()?.lowercase() ?: ""
            val desc = node.contentDescription?.toString()?.lowercase() ?: ""
            val resId = node.viewIdResourceName?.toString()?.lowercase() ?: ""

            val idMatch = idNeedle.isNotEmpty() && resId.contains(idNeedle)
            val textMatch = tNeedle.isNotEmpty() && (text.contains(tNeedle) || desc.contains(tNeedle))
            if (idMatch || textMatch) {
                return node
            }

            for (i in 0 until node.childCount) {
                val found = search(node.getChild(i), depth + 1)
                if (found != null) return found
            }
            return null
        }

        val explicit = search(root, 0)
        if (explicit != null) return explicit
        if (preferEditable && tNeedle.isEmpty() && idNeedle.isEmpty()) {
            return focusedNode ?: fallbackEditable
        }
        return null
    }

    fun performTap(x: Float?, y: Float?, queryText: String = "", queryId: String = ""): JSONObject {
        var tapX = x
        var tapY = y
        var matchedLabel: String? = null

        if (tapX == null || tapY == null) {
            val root = rootInActiveWindow ?: return JSONObject().apply {
                put("ok", false)
                put("error", "لا توجد نافذة نشطة.")
            }
            val node = findNode(root, queryText, queryId, false) ?: return JSONObject().apply {
                put("ok", false)
                put("error", "لم يُعثر على عنصر يطابق: ${queryText.ifEmpty { queryId }}")
            }
            val rect = Rect()
            node.getBoundsInScreen(rect)
            tapX = rect.centerX().toFloat()
            tapY = rect.centerY().toFloat()
            matchedLabel = node.text?.toString()?.ifEmpty { null }
                ?: node.contentDescription?.toString()?.ifEmpty { null }
                ?: node.viewIdResourceName
        }

        val path = Path().apply { moveTo(tapX, tapY) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0L, 65L))
            .build()

        val ok = dispatchBlockingGesture(gesture)
        return JSONObject().apply {
            put("ok", ok)
            put("transport", "bridge")
            put("tapped", JSONObject().apply {
                put("x", tapX.toInt())
                put("y", tapY.toInt())
                if (matchedLabel != null) put("matched", matchedLabel)
            })
        }
    }

    fun performSwipe(x1: Float, y1: Float, x2: Float, y2: Float, durationMs: Long): JSONObject {
        val safeDuration = durationMs.coerceIn(80L, 3000L)
        val path = Path().apply {
            moveTo(x1, y1)
            lineTo(x2, y2)
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0L, safeDuration))
            .build()
        val ok = dispatchBlockingGesture(gesture)
        return JSONObject().apply {
            put("ok", ok)
            put("transport", "bridge")
            put("swipe", JSONObject().apply {
                put("x1", x1.toInt())
                put("y1", y1.toInt())
                put("x2", x2.toInt())
                put("y2", y2.toInt())
                put("durationMs", safeDuration)
            })
        }
    }

    fun performType(text: String, targetText: String = "", targetId: String = "", pressEnter: Boolean = false): JSONObject {
        val root = rootInActiveWindow ?: return JSONObject().apply {
            put("ok", false)
            put("error", "لا توجد نافذة نشطة.")
        }
        val node = findNode(root, targetText, targetId, true) ?: return JSONObject().apply {
            put("ok", false)
            put("error", "لم يُعثر على حقل إدخال نص على الشاشة.")
        }

        val rect = Rect()
        node.getBoundsInScreen(rect)
        if (!node.isFocused) {
            node.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
            node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        }

        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        val typed = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)

        var entered = false
        if (pressEnter && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            entered = node.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
        }

        return JSONObject().apply {
            put("ok", typed)
            put("transport", "bridge")
            put("typedLength", text.length)
            put("pressEnter", entered)
            put("target", JSONObject().apply {
                put("x", rect.centerX())
                put("y", rect.centerY())
            })
        }
    }

    fun performSystemKey(key: String): JSONObject {
        val action = when (key.lowercase()) {
            "home" -> GLOBAL_ACTION_HOME
            "back" -> GLOBAL_ACTION_BACK
            "recents" -> GLOBAL_ACTION_RECENTS
            "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
            "quick_settings" -> GLOBAL_ACTION_QUICK_SETTINGS
            "lock", "power" -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) GLOBAL_ACTION_LOCK_SCREEN
                else return JSONObject().put("ok", false).put("error", "Lock action requires Android 9+")
            }
            "enter" -> {
                val root = rootInActiveWindow
                val focused = root?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
                val done = if (focused != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    focused.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
                } else false
                return JSONObject().put("ok", done).put("transport", "bridge").put("key", "enter")
            }
            else -> return JSONObject().put("ok", false).put("error", "Unsupported key: $key")
        }

        val ok = performGlobalAction(action)
        return JSONObject().apply {
            put("ok", ok)
            put("transport", "bridge")
            put("key", key)
        }
    }

    fun listLaunchableApps(): JSONObject {
        val pm = packageManager
        val intent = Intent(Intent.ACTION_MAIN, null).apply {
            addCategory(Intent.CATEGORY_LAUNCHER)
        }
        @Suppress("DEPRECATION")
        val resolved = pm.queryIntentActivities(intent, PackageManager.MATCH_ALL)
        val arr = JSONArray()
        val seen = HashSet<String>()
        for (info in resolved.sortedBy { it.loadLabel(pm).toString().lowercase() }) {
            val pkg = info.activityInfo?.packageName ?: continue
            if (!seen.add(pkg)) continue
            arr.put(JSONObject().apply {
                put("name", info.loadLabel(pm).toString())
                put("packageName", pkg)
            })
            if (arr.length() >= 150) break
        }
        return JSONObject().apply {
            put("ok", true)
            put("transport", "bridge")
            put("count", arr.length())
            put("apps", arr)
        }
    }

    fun openApp(appQuery: String): JSONObject {
        val query = appQuery.trim()
        if (query.isEmpty()) {
            return JSONObject().put("ok", false).put("error", "اسم التطبيق مطلوب.")
        }
        val pm = packageManager

        // Try direct package launch first
        var launchIntent = pm.getLaunchIntentForPackage(query)
        var targetPkg = query

        if (launchIntent == null) {
            val mainIntent = Intent(Intent.ACTION_MAIN, null).apply {
                addCategory(Intent.CATEGORY_LAUNCHER)
            }
            @Suppress("DEPRECATION")
            val apps = pm.queryIntentActivities(mainIntent, PackageManager.MATCH_ALL)
            val lower = query.lowercase()
            val match = apps.firstOrNull {
                it.loadLabel(pm).toString().lowercase().contains(lower) ||
                    (it.activityInfo?.packageName?.lowercase()?.contains(lower) == true)
            }
            if (match != null) {
                targetPkg = match.activityInfo.packageName
                launchIntent = pm.getLaunchIntentForPackage(targetPkg)
            }
        }

        if (launchIntent == null) {
            return JSONObject().put("ok", false).put("error", "لم يُعثر على تطبيق يطابق: $query")
        }

        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        startActivity(launchIntent)
        return JSONObject().apply {
            put("ok", true)
            put("transport", "bridge")
            put("opened", targetPkg)
        }
    }

    private fun dispatchBlockingGesture(gesture: GestureDescription): Boolean {
        val latch = CountDownLatch(1)
        var result = false
        val dispatched = dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                result = true
                latch.countDown()
            }

            override fun onCancelled(gestureDescription: GestureDescription?) {
                result = false
                latch.countDown()
            }
        }, null)
        if (!dispatched) return false
        latch.await(3, TimeUnit.SECONDS)
        return result
    }
}
