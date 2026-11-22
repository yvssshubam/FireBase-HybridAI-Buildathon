package com.fairclaim.fft

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sqrt

/**
 * Photo-of-a-screen detector (PLAN §9). A camera pointed at a display picks up
 * the display's pixel grid as strong, isolated periodic peaks in the mid/high
 * frequencies; real scenes have smooth, roughly 1/f spectra.
 *
 * score = energy in the top-k isolated peaks (each with its 3×3 neighbourhood,
 * to catch leakage) / total energy in the band above [lowCutoff].
 * 0 = no periodic structure, → 1 = all band energy in a few peaks. The pass
 * threshold is `policy.moireThreshold`, calibrated on real photos (Day-1 test T6).
 *
 * Pure JVM, no Android types: the app converts a Bitmap with [toGrayGrid].
 * Instances hold no mutable state, so they are thread-safe; call [score] off
 * the main thread.
 */
class MoireDetector(
    val size: Int = 256,
    /** Band starts at this fraction of the Nyquist radius (drops DC and the scene's low frequencies). */
    private val lowCutoff: Double = 0.08,
    private val topK: Int = 8,
    /** A peak must be the strict maximum within this many bins in every direction. */
    private val peakRadius: Int = 2,
) {
    init {
        require(Fft.isPowerOfTwo(size)) { "size must be a power of two" }
        require(lowCutoff in 0.0..1.0 && topK > 0 && peakRadius > 0)
    }

    private val window = DoubleArray(size) { 0.5 - 0.5 * cos(2 * PI * it / (size - 1)) }

    /** [gray] is a size×size row-major luminance grid (any scale). */
    fun score(gray: FloatArray): Double {
        val n = size
        require(gray.size == n * n) { "expected ${n * n} pixels, got ${gray.size}" }
        val mean = gray.sumOf { it.toDouble() } / gray.size
        val re = DoubleArray(n * n) { i -> (gray[i] - mean) * window[i / n] * window[i % n] }
        val im = DoubleArray(n * n)
        Fft.transform2d(re, im, n)

        val power = DoubleArray(n * n) { re[it] * re[it] + im[it] * im[it] }
        val half = n / 2
        fun freq(i: Int) = if (i < half) i else i - n
        val inBand = BooleanArray(n * n) { i ->
            val fx = freq(i % n).toDouble()
            val fy = freq(i / n).toDouble()
            sqrt(fx * fx + fy * fy) / half >= lowCutoff
        }

        var bandEnergy = 0.0
        for (i in power.indices) if (inBand[i]) bandEnergy += power[i]
        if (bandEnergy <= 1e-12) return 0.0

        val peaks = ArrayList<Double>()
        for (y in 0 until n) for (x in 0 until n) {
            val i = y * n + x
            if (!inBand[i] || !isStrictLocalMax(power, n, x, y)) continue
            peaks += neighbourhoodEnergy(power, inBand, n, x, y)
        }
        peaks.sortDescending()
        val top = peaks.take(topK).sum()
        return (top / bandEnergy).coerceIn(0.0, 1.0)
    }

    private fun isStrictLocalMax(p: DoubleArray, n: Int, x: Int, y: Int): Boolean {
        val v = p[y * n + x]
        if (v <= 0.0) return false
        for (dy in -peakRadius..peakRadius) for (dx in -peakRadius..peakRadius) {
            if (dx == 0 && dy == 0) continue
            val xx = (x + dx + n) % n
            val yy = (y + dy + n) % n
            if (p[yy * n + xx] >= v) return false
        }
        return true
    }

    private fun neighbourhoodEnergy(p: DoubleArray, inBand: BooleanArray, n: Int, x: Int, y: Int): Double {
        var e = 0.0
        for (dy in -1..1) for (dx in -1..1) {
            val i = ((y + dy + n) % n) * n + (x + dx + n) % n
            if (inBand[i]) e += p[i]
        }
        return e
    }

    companion object {
        /**
         * ARGB pixels (Bitmap.getPixels order) → size×size luma grid in [0,1]:
         * centre square crop, then box-average downscale.
         */
        fun toGrayGrid(argb: IntArray, width: Int, height: Int, size: Int = 256): FloatArray {
            require(argb.size == width * height && width > 0 && height > 0) { "pixel count mismatch" }
            val side = minOf(width, height)
            require(side >= size) { "image smaller than $size px" }
            val x0 = (width - side) / 2
            val y0 = (height - side) / 2
            val out = FloatArray(size * size)
            for (ty in 0 until size) {
                val sy0 = y0 + ty * side / size
                val sy1 = y0 + (ty + 1) * side / size
                for (tx in 0 until size) {
                    val sx0 = x0 + tx * side / size
                    val sx1 = x0 + (tx + 1) * side / size
                    var sum = 0.0
                    for (sy in sy0 until sy1) for (sx in sx0 until sx1) {
                        val c = argb[sy * width + sx]
                        sum += 0.299 * ((c shr 16) and 0xFF) + 0.587 * ((c shr 8) and 0xFF) + 0.114 * (c and 0xFF)
                    }
                    out[ty * size + tx] = (sum / ((sy1 - sy0) * (sx1 - sx0)) / 255.0).toFloat()
                }
            }
            return out
        }
    }
}
