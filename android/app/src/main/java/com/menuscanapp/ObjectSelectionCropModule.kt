package com.menuscanapp

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream

class ObjectSelectionCropModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "ObjectSelectionCropModule"

  @ReactMethod
  fun cropToFile(
    sourcePath: String,
    outputPath: String,
    x: Int,
    y: Int,
    width: Int,
    height: Int,
    promise: Promise,
  ) {
    Thread {
      try {
        val normalizedSource = normalizePath(sourcePath)
        val normalizedOutput = normalizePath(outputPath)
        val decoded = BitmapFactory.decodeFile(normalizedSource)
          ?: throw IllegalStateException("Could not decode image: $normalizedSource")
        val oriented = applyExifOrientation(normalizedSource, decoded)

        val cropX = x.coerceIn(0, (oriented.width - 1).coerceAtLeast(0))
        val cropY = y.coerceIn(0, (oriented.height - 1).coerceAtLeast(0))
        val cropWidth = width.coerceIn(1, oriented.width - cropX)
        val cropHeight = height.coerceIn(1, oriented.height - cropY)
        val cropped = Bitmap.createBitmap(oriented, cropX, cropY, cropWidth, cropHeight)

        val outputFile = File(normalizedOutput)
        outputFile.parentFile?.mkdirs()
        if (outputFile.exists()) {
          outputFile.delete()
        }

        FileOutputStream(outputFile).use { outputStream ->
          val format =
            if (normalizedOutput.lowercase().endsWith(".png")) {
              Bitmap.CompressFormat.PNG
            } else {
              Bitmap.CompressFormat.JPEG
            }
          val quality = if (format == Bitmap.CompressFormat.PNG) 100 else 95
          if (!cropped.compress(format, quality, outputStream)) {
            throw IllegalStateException("Could not write cropped image: $normalizedOutput")
          }
          outputStream.flush()
        }

        cropped.recycle()
        if (oriented !== decoded) {
          oriented.recycle()
        }
        decoded.recycle()
        promise.resolve("file://$normalizedOutput")
      } catch (error: Exception) {
        promise.reject("crop_failed", error.message, error)
      }
    }.start()
  }

  private fun normalizePath(path: String): String {
    return if (path.startsWith("file://")) {
      path.removePrefix("file://")
    } else {
      path
    }
  }

  private fun applyExifOrientation(path: String, bitmap: Bitmap): Bitmap {
    val exif = ExifInterface(path)
    val orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    val matrix = Matrix()

    when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.preScale(-1f, 1f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.preScale(1f, -1f)
      ExifInterface.ORIENTATION_TRANSPOSE -> {
        matrix.preScale(-1f, 1f)
        matrix.postRotate(270f)
      }
      ExifInterface.ORIENTATION_TRANSVERSE -> {
        matrix.preScale(-1f, 1f)
        matrix.postRotate(90f)
      }
      else -> return bitmap
    }

    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
  }
}
