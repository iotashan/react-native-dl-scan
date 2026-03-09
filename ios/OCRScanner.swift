import Vision
import CoreVideo

/// Recognizes text in camera frames using Apple Vision.
@objc public class OCRScanner: NSObject {

    /// Recognize text in the given pixel buffer.
    /// Returns an array of recognized text strings, or nil on failure.
    @objc public func recognize(in pixelBuffer: CVPixelBuffer, orientation: CGImagePropertyOrientation = .up) -> [String]? {
        var lines: [String] = []

        let request = VNRecognizeTextRequest { request, error in
            guard error == nil,
                  let observations = request.results as? [VNRecognizedTextObservation] else {
                return
            }

            for observation in observations {
                if let candidate = observation.topCandidates(1).first,
                   candidate.confidence >= 0.3 {
                    lines.append(candidate.string)
                }
            }
        }

        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true

        let handler = VNImageRequestHandler(
            cvPixelBuffer: pixelBuffer,
            orientation: orientation,
            options: [:]
        )

        try? handler.perform([request])
        return lines.isEmpty ? nil : lines
    }
}
