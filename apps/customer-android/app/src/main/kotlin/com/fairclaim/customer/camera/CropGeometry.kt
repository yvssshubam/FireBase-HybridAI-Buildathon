package com.fairclaim.customer.camera

import kotlin.math.roundToInt

// Tap-to-crop (Flow C step 4). The captured photo is shown with ContentScale.Fit (whole image,
// letterboxed, centred). A tap is mapped back to image pixels and a square crop is cut around it.

data class PointF(val x: Float, val y: Float)

data class CropRect(val left: Int, val top: Int, val side: Int) {
    val right: Int get() = left + side
    val bottom: Int get() = top + side
}

/** View coordinates → image pixels for a centred Fit layout; null when the tap is on the letterbox. */
fun viewToImage(tap: PointF, viewW: Float, viewH: Float, imgW: Int, imgH: Int): PointF? {
    if (viewW <= 0f || viewH <= 0f || imgW <= 0 || imgH <= 0) return null
    val scale = minOf(viewW / imgW, viewH / imgH)
    val shownW = imgW * scale
    val shownH = imgH * scale
    val offX = (viewW - shownW) / 2f
    val offY = (viewH - shownH) / 2f
    val x = (tap.x - offX) / scale
    val y = (tap.y - offY) / scale
    if (x < 0f || y < 0f || x > imgW || y > imgH) return null
    return PointF(x.coerceIn(0f, imgW.toFloat()), y.coerceIn(0f, imgH.toFloat()))
}

/**
 * Square crop centred on the tap, shifted (not shrunk) to stay inside the image.
 * Side = [fraction] of the shorter edge, at least [minSide] px (or the whole short edge if smaller).
 */
fun cropAround(center: PointF, imgW: Int, imgH: Int, fraction: Float = 0.4f, minSide: Int = 224): CropRect {
    require(imgW > 0 && imgH > 0 && fraction > 0f && fraction <= 1f)
    val short = minOf(imgW, imgH)
    val side = (short * fraction).roundToInt().coerceAtLeast(minSide).coerceAtMost(short)
    val left = (center.x.roundToInt() - side / 2).coerceIn(0, imgW - side)
    val top = (center.y.roundToInt() - side / 2).coerceIn(0, imgH - side)
    return CropRect(left, top, side)
}

/** Crop rectangle in view coordinates (for drawing the selection box over the Fit image). */
fun imageRectToView(r: CropRect, viewW: Float, viewH: Float, imgW: Int, imgH: Int): Pair<PointF, Float> {
    val scale = minOf(viewW / imgW, viewH / imgH)
    val offX = (viewW - imgW * scale) / 2f
    val offY = (viewH - imgH * scale) / 2f
    return PointF(offX + r.left * scale, offY + r.top * scale) to r.side * scale
}
