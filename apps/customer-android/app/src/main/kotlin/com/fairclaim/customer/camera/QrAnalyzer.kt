package com.fairclaim.customer.camera

import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.ChecksumException
import com.google.zxing.DecodeHintType
import com.google.zxing.FormatException
import com.google.zxing.NotFoundException
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader

/**
 * Reads the restaurant's pairing QR from the live preview with ZXing core: a classic, non-generative
 * barcode decoder (no model, no download, no Play services), so it is not a model call.
 * Uses only the luminance (Y) plane of CameraX's YUV_420_888 frames.
 */
class QrAnalyzer(private val onText: (String) -> Unit) : ImageAnalysis.Analyzer {
    private val reader = QRCodeReader()
    private val hints = mapOf(
        DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
        DecodeHintType.TRY_HARDER to true,
    )

    override fun analyze(image: ImageProxy) {
        try {
            val plane = image.planes[0]
            val buffer = plane.buffer
            val rowStride = plane.rowStride
            val w = image.width
            val h = image.height
            // The last row can be shorter than rowStride; pad so the source can address rowStride × h.
            val data = ByteArray(maxOf(buffer.remaining(), rowStride * h))
            buffer.get(data, 0, buffer.remaining())
            val source = PlanarYUVLuminanceSource(data, rowStride, h, 0, 0, w, h, false)
            val result = reader.decode(BinaryBitmap(HybridBinarizer(source)), hints)
            onText(result.text)
        } catch (_: NotFoundException) {
            // no QR in this frame
        } catch (_: ChecksumException) {
        } catch (_: FormatException) {
        } finally {
            reader.reset()
            image.close()
        }
    }
}
