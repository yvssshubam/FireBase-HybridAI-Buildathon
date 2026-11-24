package com.fairclaim.customer.camera

import android.graphics.Bitmap
import android.graphics.Matrix
import com.fairclaim.fft.MoireDetector
import java.io.ByteArrayOutputStream
import kotlin.math.roundToInt

// Bitmap helpers for the evidence pipeline. All of these allocate; call them off the main thread.

fun Bitmap.rotated(degrees: Int): Bitmap {
    if (degrees % 360 == 0) return this
    val m = Matrix().apply { postRotate(degrees.toFloat()) }
    return Bitmap.createBitmap(this, 0, 0, width, height, m, true)
}

/** Longest side ≤ [maxSide] (on-device input stays small; the model sees one Bitmap per call). */
fun Bitmap.scaledToMax(maxSide: Int): Bitmap {
    val longest = maxOf(width, height)
    if (longest <= maxSide) return this
    val f = maxSide.toFloat() / longest
    return Bitmap.createScaledBitmap(this, (width * f).roundToInt().coerceAtLeast(1), (height * f).roundToInt().coerceAtLeast(1), true)
}

fun Bitmap.cropped(r: CropRect): Bitmap = Bitmap.createBitmap(this, r.left, r.top, r.side, r.side)

/**
 * JPEG under [maxBytes] (storage.rules: < 300 KB): lower the quality first, then the size.
 * The returned bytes are exactly what gets hashed and uploaded.
 */
fun Bitmap.jpegUnder(maxBytes: Int = MAX_CROP_BYTES - 4 * 1024, startQuality: Int = 88): ByteArray {
    var img = this
    var quality = startQuality
    while (true) {
        val bytes = ByteArrayOutputStream().use { out ->
            img.compress(Bitmap.CompressFormat.JPEG, quality, out)
            out.toByteArray()
        }
        if (bytes.size < maxBytes) return bytes
        if (quality > 55) {
            quality -= 10
        } else {
            check(img.width > 64) { "cannot fit the crop under $maxBytes bytes" }
            img = Bitmap.createScaledBitmap(img, (img.width * 0.8f).roundToInt(), (img.height * 0.8f).roundToInt(), true)
            quality = startQuality
        }
    }
}

/**
 * FFT moiré score of the full frame (non-AI check, PLAN §9) with the shared fft module.
 * The detector crops the centre square and box-averages it to 256×256 itself.
 */
fun moireScore(frame: Bitmap, detector: MoireDetector = MoireDetector()): Double {
    val src = if (minOf(frame.width, frame.height) < detector.size) {
        val f = detector.size.toFloat() / minOf(frame.width, frame.height)
        Bitmap.createScaledBitmap(frame, (frame.width * f).roundToInt(), (frame.height * f).roundToInt(), true)
    } else {
        frame
    }
    val px = IntArray(src.width * src.height)
    src.getPixels(px, 0, src.width, 0, 0, src.width, src.height)
    return detector.score(MoireDetector.toGrayGrid(px, src.width, src.height, detector.size))
}
