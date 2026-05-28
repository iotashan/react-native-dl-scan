// Task #68 — types shared between the executable target's main.swift
// and the library target's ProductionStrip.swift. Promoted to a
// dedicated file (with `public` visibility) so both can import them.
//
// Both `YoloDetection` and `iou` are pure-Swift / Foundation-only —
// no Vision, no AVFoundation, no CoreML. Safe to live in the library.

import Foundation
import CoreGraphics

/// One YOLO detection in 640×640 model-input pixel space.
/// Class index is the YOLO field-detector class id (see
/// `cpp/yolo/field_classes.cpp::kFieldClassNames`); `name` is the
/// string form (e.g. `"list_8f"`, `"face"`).
public struct YoloDetection {
    public let classId: Int
    public let name: String
    public let confidence: Float
    public let bbox: CGRect

    public init(classId: Int, name: String, confidence: Float, bbox: CGRect) {
        self.classId = classId
        self.name = name
        self.confidence = confidence
        self.bbox = bbox
    }
}

/// Standard intersection-over-union for two axis-aligned bounding boxes
/// in the same coordinate space. Returns 0 for zero-area / non-
/// overlapping inputs.
public func iou(_ a: CGRect, _ b: CGRect) -> CGFloat {
    let xL = max(a.minX, b.minX)
    let yT = max(a.minY, b.minY)
    let xR = min(a.maxX, b.maxX)
    let yB = min(a.maxY, b.maxY)
    let interW = max(0, xR - xL)
    let interH = max(0, yB - yT)
    let inter = interW * interH
    if inter <= 0 { return 0 }
    let aArea = a.width * a.height
    let bArea = b.width * b.height
    let union = aArea + bArea - inter
    return union > 0 ? inter / union : 0
}
