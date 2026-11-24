package com.fairclaim.customer.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CropGeometryTest {
    @Test
    fun mapsTapsThroughALetterboxedFitLayout() {
        // 4000×3000 photo in a 1000×1000 view: scale 0.25, shown 1000×750, 125 px bars top and bottom.
        val centre = viewToImage(PointF(500f, 500f), 1000f, 1000f, 4000, 3000)
        assertEquals(PointF(2000f, 1500f), centre)
        assertEquals(PointF(0f, 0f), viewToImage(PointF(0f, 125f), 1000f, 1000f, 4000, 3000))
        assertEquals(PointF(4000f, 3000f), viewToImage(PointF(1000f, 875f), 1000f, 1000f, 4000, 3000))
        assertNull("tap on the top bar", viewToImage(PointF(500f, 60f), 1000f, 1000f, 4000, 3000))
        assertNull("tap on the bottom bar", viewToImage(PointF(500f, 940f), 1000f, 1000f, 4000, 3000))
        assertNull(viewToImage(PointF(1f, 1f), 0f, 100f, 10, 10))
    }

    @Test
    fun portraitPhotoInATallView() {
        // 3000×4000 in 1080×2000: scale 0.36, shown 1080×1440, bars of 280 px.
        val p = viewToImage(PointF(540f, 280f + 720f), 1080f, 2000f, 3000, 4000)
        assertNotNull(p)
        p ?: return
        assertEquals(1500f, p.x, 0.01f)
        assertEquals(2000f, p.y, 0.01f)
    }

    @Test
    fun cropIsASquareAroundTheTap() {
        val r = cropAround(PointF(2000f, 1500f), 4000, 3000)
        assertEquals(1200, r.side) // 40 % of the short edge
        assertEquals(1400, r.left)
        assertEquals(900, r.top)
    }

    @Test
    fun cropIsShiftedNotShrunkAtTheEdges() {
        listOf(PointF(0f, 0f), PointF(4000f, 3000f), PointF(0f, 3000f), PointF(4000f, 0f), PointF(10f, 1500f)).forEach { tap ->
            val r = cropAround(tap, 4000, 3000)
            assertEquals(1200, r.side)
            assertTrue("$tap → $r", r.left >= 0 && r.top >= 0 && r.right <= 4000 && r.bottom <= 3000)
        }
        val corner = cropAround(PointF(0f, 0f), 4000, 3000)
        assertEquals(0, corner.left)
        assertEquals(0, corner.top)
    }

    @Test
    fun smallImagesUseTheMinimumOrTheWholeShortEdge() {
        assertEquals(224, cropAround(PointF(250f, 250f), 500, 500).side) // 40 % = 200 < 224
        val tiny = cropAround(PointF(50f, 50f), 160, 100)
        assertEquals(100, tiny.side)
        assertEquals(0, tiny.top)
    }

    @Test
    fun selectionBoxMapsBackOntoTheView() {
        val r = CropRect(1400, 900, 1200)
        val (topLeft, side) = imageRectToView(r, 1000f, 1000f, 4000, 3000)
        assertEquals(PointF(350f, 125f + 225f), topLeft)
        assertEquals(300f, side, 0.001f)
    }

    @Test
    fun sha256IsLowercaseHexOverTheExactBytes() {
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", sha256Hex(ByteArray(0)))
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", sha256Hex("abc".toByteArray()))
    }
}
