package com.fairclaim.fft

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import java.util.Random

/** Deterministic synthetic images. Real-photo calibration is Day-1 test T6, not this file. */
object Synthetic {
    /** A "scene": gradient + soft-edged ellipses + sensor noise. */
    fun scene(n: Int, seed: Long): FloatArray {
        val r = Random(seed)
        val img = FloatArray(n * n) { i -> 0.3f + 0.4f * (i % n) / n + 0.1f * (i / n) / n }
        repeat(12) {
            val cx = r.nextDouble() * n
            val cy = r.nextDouble() * n
            val rx = 8 + r.nextDouble() * n / 4
            val ry = 8 + r.nextDouble() * n / 4
            val v = (r.nextDouble() * 0.6 - 0.3).toFloat()
            for (y in 0 until n) for (x in 0 until n) {
                val dx = (x - cx) / rx
                val dy = (y - cy) / ry
                if (dx * dx + dy * dy <= 1) img[y * n + x] += v
            }
        }
        var out = img
        repeat(2) { out = boxBlur(out, n) }
        return FloatArray(n * n) { (out[it] + 0.02 * r.nextGaussian()).toFloat() }
    }

    /** The same scene re-photographed off a display: two beating pixel-grid gratings. */
    fun screen(base: FloatArray, n: Int, amplitude: Double): FloatArray = FloatArray(n * n) { i ->
        val x = (i % n).toDouble()
        val y = (i / n).toDouble()
        val g1 = 1 - amplitude + amplitude * cos(2 * PI * (0.31 * x + 0.07 * y))
        val g2 = 1 - amplitude + amplitude * cos(2 * PI * (-0.05 * x + 0.29 * y))
        (base[i] * g1 * g2).toFloat()
    }

    fun whiteNoise(n: Int, seed: Long): FloatArray {
        val r = Random(seed)
        return FloatArray(n * n) { r.nextFloat() }
    }

    private fun boxBlur(src: FloatArray, n: Int): FloatArray = FloatArray(n * n) { i ->
        val x = i % n
        val y = i / n
        var s = 0f
        var c = 0
        for (dy in -1..1) for (dx in -1..1) {
            val xx = x + dx
            val yy = y + dy
            if (xx in 0 until n && yy in 0 until n) { s += src[yy * n + xx]; c++ }
        }
        s / c
    }
}

class FftTest {
    @Test fun matchesNaiveDft() {
        val r = Random(7)
        val n = 16
        val re = DoubleArray(n) { r.nextDouble() - 0.5 }
        val im = DoubleArray(n) { r.nextDouble() - 0.5 }
        val expRe = DoubleArray(n)
        val expIm = DoubleArray(n)
        for (k in 0 until n) for (t in 0 until n) {
            val a = -2 * PI * k * t / n
            expRe[k] += re[t] * cos(a) - im[t] * sin(a)
            expIm[k] += re[t] * sin(a) + im[t] * cos(a)
        }
        Fft.transform(re, im)
        assertArrayEquals(expRe, re, 1e-9)
        assertArrayEquals(expIm, im, 1e-9)
    }

    @Test fun rejectsNonPowerOfTwo() {
        assertThrows(IllegalArgumentException::class.java) { Fft.transform(DoubleArray(12), DoubleArray(12)) }
    }
}

class MoireDetectorTest {
    private val n = 256
    private val detector = MoireDetector(n)

    @Test fun screenPhotoScoresFarAboveTheSameScene() {
        for (seed in 1L..5L) {
            val scene = Synthetic.scene(n, seed)
            val real = detector.score(scene)
            val screen = detector.score(Synthetic.screen(scene, n, amplitude = 0.25))
            assertTrue("seed $seed: real=$real screen=$screen", screen > 3 * real && screen - real > 0.3)
        }
    }

    @Test fun realScenesStayBelowTheDefaultPolicyThreshold() {
        // policy.v1 moireThreshold = 0.35 (placeholder until T6 calibration on real photos).
        for (seed in 1L..10L) {
            val s = detector.score(Synthetic.scene(n, seed))
            assertTrue("seed $seed scored $s", s < 0.35)
        }
    }

    @Test fun faintGridStillRaisesTheScore() {
        val scene = Synthetic.scene(n, 42)
        assertTrue(detector.score(Synthetic.screen(scene, n, amplitude = 0.08)) > 2 * detector.score(scene))
    }

    @Test fun whiteNoiseHasNoPeaks() {
        assertTrue(detector.score(Synthetic.whiteNoise(n, 3)) < 0.05)
    }

    @Test fun flatImageScoresZero() {
        assertEquals(0.0, detector.score(FloatArray(n * n) { 0.5f }), 0.0)
    }

    @Test fun deterministic() {
        val img = Synthetic.screen(Synthetic.scene(n, 9), n, 0.2)
        assertEquals(detector.score(img), detector.score(img), 0.0)
    }

    @Test fun scoreIsWithinUnitInterval() {
        val s = detector.score(Synthetic.screen(Synthetic.scene(n, 11), n, 0.5))
        assertTrue(s in 0.0..1.0)
    }

    @Test fun rejectsWrongSize() {
        assertThrows(IllegalArgumentException::class.java) { detector.score(FloatArray(100)) }
    }

    @Test fun grayGridCropsCentreAndAverages() {
        // 4×2 image: centre 2×2 square is columns 1..2. Downscale to 1×1 = average luma of those 4 pixels.
        val white = 0xFFFFFFFF.toInt()
        val black = 0xFF000000.toInt()
        val px = intArrayOf(
            black, white, black, black,
            black, white, black, black,
        )
        val g = MoireDetector.toGrayGrid(px, 4, 2, 1)
        assertEquals(0.5f, g[0], 1e-4f)
    }

    @Test fun grayGridUsesRec601Luma() {
        val red = 0xFFFF0000.toInt()
        assertEquals(0.299f, MoireDetector.toGrayGrid(intArrayOf(red), 1, 1, 1)[0], 1e-4f)
    }
}
