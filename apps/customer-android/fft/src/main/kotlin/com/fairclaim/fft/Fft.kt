package com.fairclaim.fft

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/** In-place iterative radix-2 FFT. Sizes must be powers of two. */
object Fft {
    fun isPowerOfTwo(n: Int) = n > 0 && (n and (n - 1)) == 0

    /** Forward transform (inverse = conjugate input, transform, conjugate, divide by n). */
    fun transform(re: DoubleArray, im: DoubleArray) {
        val n = re.size
        require(n == im.size && isPowerOfTwo(n)) { "length must be a power of two, got $n" }
        // Bit-reversal permutation.
        var j = 0
        for (i in 1 until n) {
            var bit = n shr 1
            while (j and bit != 0) {
                j = j xor bit
                bit = bit shr 1
            }
            j = j xor bit
            if (i < j) {
                re[i] = re[j].also { re[j] = re[i] }
                im[i] = im[j].also { im[j] = im[i] }
            }
        }
        var len = 2
        while (len <= n) {
            val ang = -2 * PI / len
            val wr = cos(ang)
            val wi = sin(ang)
            var start = 0
            while (start < n) {
                var cr = 1.0
                var ci = 0.0
                for (k in 0 until len / 2) {
                    val a = start + k
                    val b = a + len / 2
                    val tr = re[b] * cr - im[b] * ci
                    val ti = re[b] * ci + im[b] * cr
                    re[b] = re[a] - tr
                    im[b] = im[a] - ti
                    re[a] += tr
                    im[a] += ti
                    val ncr = cr * wr - ci * wi
                    ci = cr * wi + ci * wr
                    cr = ncr
                }
                start += len
            }
            len = len shl 1
        }
    }

    /** 2-D forward FFT of an n×n row-major grid, in place. */
    fun transform2d(re: DoubleArray, im: DoubleArray, n: Int) {
        require(re.size == n * n && im.size == n * n) { "grid must be $n×$n" }
        val rr = DoubleArray(n)
        val ri = DoubleArray(n)
        for (y in 0 until n) {
            System.arraycopy(re, y * n, rr, 0, n)
            System.arraycopy(im, y * n, ri, 0, n)
            transform(rr, ri)
            System.arraycopy(rr, 0, re, y * n, n)
            System.arraycopy(ri, 0, im, y * n, n)
        }
        for (x in 0 until n) {
            for (y in 0 until n) { rr[y] = re[y * n + x]; ri[y] = im[y * n + x] }
            transform(rr, ri)
            for (y in 0 until n) { re[y * n + x] = rr[y]; im[y * n + x] = ri[y] }
        }
    }
}
