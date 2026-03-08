import Vision
import CoreVideo

/// Detects PDF417 barcodes in camera frames using Apple Vision.
@objc public class BarcodeScanner: NSObject {

    /// Detect a PDF417 barcode in the given pixel buffer.
    /// Returns the barcode payload string, or nil if no barcode found.
    @objc public func detect(in pixelBuffer: CVPixelBuffer) -> String? {
        var result: String?

        let request = VNDetectBarcodesRequest { request, error in
            guard error == nil,
                  let observations = request.results as? [VNBarcodeObservation] else {
                return
            }

            // Find the first PDF417 barcode with sufficient confidence
            for observation in observations {
                if observation.symbology == .pdf417,
                   observation.confidence >= 0.5,
                   let payload = observation.payloadStringValue {
                    result = payload
                    return
                }
            }
        }

        if #available(iOS 17.0, *) {
            request.symbologies = [.pdf417]
        } else {
            request.symbologies = [.pdf417]
        }

        let handler = VNImageRequestHandler(
            cvPixelBuffer: pixelBuffer,
            options: [:]
        )

        try? handler.perform([request])
        return result
    }
}
