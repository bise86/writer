package com.essaylens

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.ceil
import kotlin.math.max

/** File-provider grants are copied before resolving; all PDF pages are rendered. */
class ChallengeDocumentsModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), LifecycleEventListener {
  companion object {
    private const val PICK = 43171
    private const val SAVE = 43172
    private const val MAX_BYTES = 80L * 1024L * 1024L
    private const val MAX_PAGES = 50
    private const val MAX_EDGE = 2048
  }

  private val io = Executors.newSingleThreadExecutor()
  private val rendering = AtomicBoolean(false)
  @Volatile private var invalidated = false
  private var pending: Promise? = null
  private var pendingRequest = 0
  private var exportSource: File? = null

  private val activityListener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != pendingRequest || (requestCode != PICK && requestCode != SAVE)) return
      val promise = pending ?: return
      val source = exportSource
      clearPending()
      if (resultCode != Activity.RESULT_OK) {
        promise.resolve(if (requestCode == SAVE) false else null)
        return
      }
      val selected = data?.data
      if (selected == null || selected.scheme != "content") {
        promise.reject("E_DOCUMENT", "文件选择未返回有效的文档地址")
        return
      }
      background(promise) {
        if (requestCode == PICK) importPdf(selected, promise)
        else saveTo(selected, source, promise)
      }
    }
  }

  init {
    context.addActivityEventListener(activityListener)
    context.addLifecycleEventListener(this)
  }

  override fun getName() = "ChallengeDocuments"

  private fun clearPending() {
    pending = null
    pendingRequest = 0
    exportSource = null
  }

  private fun background(promise: Promise, task: () -> Unit): Boolean {
    return try {
      check(!invalidated) { "文件操作已中断，请重新选择" }
      io.execute(task)
      true
    } catch (error: Exception) {
      promise.reject("E_INTERRUPTED", error.message ?: "文件操作已中断", error)
      false
    }
  }

  private fun directory(prefix: String): File {
    val directory = File(context.cacheDir, "challenge-imports/${prefix}_${UUID.randomUUID()}")
    check(directory.mkdirs()) { "无法创建 PDF 临时目录" }
    return directory
  }

  private fun localFile(value: String): File {
    val uri = Uri.parse(value)
    val path = when (uri.scheme) {
      null -> value
      "file" -> {
        require(uri.authority.isNullOrEmpty()) { "只支持本机文件" }
        uri.path ?: throw IllegalArgumentException("本地文件地址无效")
      }
      else -> throw IllegalArgumentException("只支持本机 PDF 文件")
    }
    require(path.startsWith("/") && !path.contains('\u0000')) { "本地文件地址无效" }
    return File(path)
  }

  private fun copyBounded(input: InputStream, output: OutputStream) {
    val buffer = ByteArray(64 * 1024)
    var total = 0L
    while (true) {
      check(!invalidated && !Thread.currentThread().isInterrupted) { "文件操作已中断，请重新选择" }
      val count = input.read(buffer)
      if (count < 0) break
      total += count
      require(total <= MAX_BYTES) { "PDF 超过 80 MB，请分卷后重新导入" }
      output.write(buffer, 0, count)
    }
    require(total > 0) { "PDF 文件为空" }
    output.flush()
  }

  private fun validatePdf(file: File) {
    require(file.isFile && file.length() in 5..MAX_BYTES) { "PDF 文件为空、无法读取或超过 80 MB" }
    val header = ByteArray(5)
    FileInputStream(file).use { require(it.read(header) == 5) { "PDF 文件不完整" } }
    require(header.contentEquals(byteArrayOf(37, 80, 68, 70, 45))) { "所选文件不是有效的 PDF" }
  }

  private fun importPdf(uri: Uri, promise: Promise) {
    var folder: File? = null
    try {
      var name = "试卷.pdf"
      context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
          val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (nameIndex >= 0) name = cursor.getString(nameIndex)?.takeIf { it.isNotBlank() } ?: name
          val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
          if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) {
            require(cursor.getLong(sizeIndex) <= MAX_BYTES) { "PDF 超过 80 MB，请分卷后重新导入" }
          }
        }
      }
      folder = directory("source")
      val file = File(folder, "source.pdf")
      (context.contentResolver.openInputStream(uri) ?: throw IllegalStateException("无法读取所选 PDF")).use { input ->
        file.outputStream().use { output -> copyBounded(input, output) }
      }
      validatePdf(file)
      val result = Arguments.createMap()
      result.putString("uri", Uri.fromFile(file).toString())
      result.putString("name", name)
      promise.resolve(result)
    } catch (error: Exception) {
      folder?.deleteRecursively()
      promise.reject("E_PDF_IMPORT", error.message ?: "PDF 导入失败", error)
    }
  }

  private fun saveTo(uri: Uri, source: File?, promise: Promise) {
    try {
      require(source != null) { "没有可保存的 PDF" }
      validatePdf(source)
      (context.contentResolver.openOutputStream(uri, "wt") ?: throw IllegalStateException("无法写入所选位置")).use { output ->
        source.inputStream().use { input -> copyBounded(input, output) }
      }
      promise.resolve(true)
    } catch (error: Exception) {
      // A failed SAF write may have created an empty/partial destination.
      try { context.contentResolver.delete(uri, null, null) } catch (_: Exception) { }
      promise.reject("E_PDF_SAVE", error.message ?: "PDF 保存失败", error)
    }
  }

  @ReactMethod
  fun pickPdf(promise: Promise) {
    context.runOnUiQueueThread {
      if (pending != null) {
        promise.reject("E_BUSY", "已有文件选择或保存任务正在进行")
        return@runOnUiQueueThread
      }
      val activity = currentActivity
      if (activity == null || invalidated) {
        promise.reject("E_ACTIVITY", "当前页面不可用，请返回应用后重试")
        return@runOnUiQueueThread
      }
      pending = promise
      pendingRequest = PICK
      try {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
          addCategory(Intent.CATEGORY_OPENABLE)
          type = "application/pdf"
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        activity.startActivityForResult(intent, PICK)
      } catch (error: Exception) {
        clearPending()
        promise.reject("E_DOCUMENT", "无法打开 PDF 文件选择器", error)
      }
    }
  }

  @ReactMethod
  fun renderPdf(uri: String, promise: Promise) {
    if (!rendering.compareAndSet(false, true)) {
      promise.reject("E_BUSY", "已有 PDF 正在渲染，请稍后重试")
      return
    }
    val accepted = background(promise) {
      var folder: File? = null
      try {
        val source = localFile(uri)
        validatePdf(source)
        folder = directory("pages")
        val pages = Arguments.createArray()
        var pageCount = 0
        ParcelFileDescriptor.open(source, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
          PdfRenderer(descriptor).use { renderer ->
            pageCount = renderer.pageCount
            require(pageCount in 1..MAX_PAGES) { "PDF 须为 1—50 页；未截断导入，请分卷后重试" }
            for (index in 0 until pageCount) {
              check(!invalidated && !Thread.currentThread().isInterrupted) { "PDF 渲染已中断，请重试" }
              renderer.openPage(index).use { page ->
                require(page.width > 0 && page.height > 0) { "PDF 第 ${index + 1} 页尺寸无效" }
                val scale = MAX_EDGE.toFloat() / max(page.width, page.height)
                val width = max(1, ceil(page.width * scale).toInt()).coerceAtMost(MAX_EDGE)
                val height = max(1, ceil(page.height * scale).toInt()).coerceAtMost(MAX_EDGE)
                val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                try {
                  Canvas(bitmap).drawColor(Color.WHITE)
                  val matrix = Matrix().apply { setScale(scale, scale) }
                  page.render(bitmap, null, matrix, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
                  val image = File(folder, "page_${index + 1}.jpg")
                  image.outputStream().use { output ->
                    check(bitmap.compress(Bitmap.CompressFormat.JPEG, 95, output)) { "PDF 页面图片保存失败" }
                  }
                  pages.pushString(Uri.fromFile(image).toString())
                } finally {
                  bitmap.recycle()
                }
              }
            }
          }
        }
        val result = Arguments.createMap()
        result.putArray("pageUris", pages)
        result.putInt("pageCount", pageCount)
        promise.resolve(result)
      } catch (error: OutOfMemoryError) {
        folder?.deleteRecursively()
        promise.reject("E_PDF_MEMORY", "当前内存不足以渲染 PDF，请关闭其他应用或分卷后重试", error)
      } catch (error: Exception) {
        folder?.deleteRecursively()
        promise.reject("E_PDF_RENDER", "PDF 读取失败（可能已加密、损坏或超出限制）：${error.message ?: "请重新选择"}", error)
      } finally {
        rendering.set(false)
      }
    }
    if (!accepted) rendering.set(false)
  }

  @ReactMethod
  fun savePdf(uri: String, name: String, promise: Promise) {
    context.runOnUiQueueThread {
      if (pending != null) {
        promise.reject("E_BUSY", "已有文件选择或保存任务正在进行")
        return@runOnUiQueueThread
      }
      val activity = currentActivity
      if (activity == null || invalidated) {
        promise.reject("E_ACTIVITY", "当前页面不可用，请返回应用后重试")
        return@runOnUiQueueThread
      }
      try {
        val source = localFile(uri)
        validatePdf(source)
        pending = promise
        pendingRequest = SAVE
        exportSource = source
        val filename = name.replace(Regex("[\\\\/\\u0000-\\u001f]"), "_").take(120)
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
          addCategory(Intent.CATEGORY_OPENABLE)
          type = "application/pdf"
          putExtra(Intent.EXTRA_TITLE, filename)
          addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }
        activity.startActivityForResult(intent, SAVE)
      } catch (error: Exception) {
        clearPending()
        promise.reject("E_DOCUMENT", "无法打开 PDF 保存位置：${error.message}", error)
      }
    }
  }

  override fun onHostResume() = Unit
  override fun onHostPause() = Unit
  override fun onHostDestroy() {
    pending?.reject("E_INTERRUPTED", "文件选择页面已关闭，请重新选择")
    clearPending()
  }

  override fun invalidate() {
    invalidated = true
    context.removeActivityEventListener(activityListener)
    context.removeLifecycleEventListener(this)
    context.runOnUiQueueThread {
      pending?.reject("E_INTERRUPTED", "文件操作已中断")
      clearPending()
    }
    io.shutdownNow()
    super.invalidate()
  }
}
