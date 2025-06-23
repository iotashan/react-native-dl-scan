import Foundation
import Vision
@testable import RnDlScan

/**
 * Mock OCR Data Generator for Confidence Testing Scenarios
 * Generates realistic OCR data with varying confidence levels and error patterns
 */
class MockOCRDataGenerator {
    
    // MARK: - Confidence Level Scenarios
    
    /**
     * Generate high-confidence perfect OCR scenario
     * Clear text with >0.8 Vision confidence
     */
    static func generateHighConfidencePerfectOCR() -> [[String: Any]] {
        return [
            createObservation("CALIFORNIA", confidence: 0.98, position: .header),
            createObservation("DRIVER LICENSE", confidence: 0.96, position: .subheader),
            createObservation("DL D1234567", confidence: 0.95, position: .licenseNumber),
            createObservation("LN ANDERSON", confidence: 0.93, position: .lastName),
            createObservation("FN MICHAEL", confidence: 0.94, position: .firstName),
            createObservation("DOB 03/15/1985", confidence: 0.92, position: .dateOfBirth),
            createObservation("EXP 03/15/2028", confidence: 0.91, position: .expirationDate),
            createObservation("ISS 03/15/2024", confidence: 0.90, position: .issueDate),
            createObservation("SEX M", confidence: 0.95, position: .sex),
            createObservation("HGT 6-01", confidence: 0.89, position: .height),
            createObservation("WGT 185", confidence: 0.88, position: .weight),
            createObservation("EYES BRN", confidence: 0.87, position: .eyeColor),
            createObservation("HAIR BLK", confidence: 0.86, position: .hairColor),
            createObservation("CLASS C", confidence: 0.93, position: .licenseClass),
            createObservation("1234 OAK STREET", confidence: 0.85, position: .addressLine1),
            createObservation("LOS ANGELES CA 90001", confidence: 0.84, position: .addressLine2)
        ]
    }
    
    /**
     * Generate medium-confidence scenario with common OCR errors
     * Readable text with typical OCR mistakes
     */
    static func generateMediumConfidenceWithErrors() -> [[String: Any]] {
        return [
            createObservation("CALIFORN1A", confidence: 0.75, position: .header), // 1 instead of I
            createObservation("DR1VER L1CENSE", confidence: 0.72, position: .subheader), // 1 instead of I
            createObservation("DL DI23456O", confidence: 0.68, position: .licenseNumber), // I→1, O→0
            createObservation("LN ANDERS0N", confidence: 0.65, position: .lastName), // 0 instead of O
            createObservation("FN M1CHAEL", confidence: 0.66, position: .firstName), // 1 instead of I
            createObservation("DOB O3/I5/I985", confidence: 0.62, position: .dateOfBirth), // O→0, I→1
            createObservation("EXP 03/15/202B", confidence: 0.64, position: .expirationDate), // B→8
            createObservation("SEX N", confidence: 0.70, position: .sex), // N→M
            createObservation("HGT 6-0I", confidence: 0.63, position: .height), // I→1
            createObservation("WGT IB5", confidence: 0.61, position: .weight), // I→1, B→8
            createObservation("EYES 8RN", confidence: 0.60, position: .eyeColor), // 8→B
            createObservation("HA1R 8LK", confidence: 0.59, position: .hairColor), // 1→I, 8→B
            createObservation("I234 0AK 5TREET", confidence: 0.58, position: .addressLine1) // Multiple errors
        ]
    }
    
    /**
     * Generate low-confidence poor quality scenario
     * Blurry/damaged text requiring heavy correction
     */
    static func generateLowConfidencePoorQuality() -> [[String: Any]] {
        return [
            createObservation("C4L1F0RN14", confidence: 0.45, position: .header), // Multiple substitutions
            createObservation("DR|V3R L|C3NS3", confidence: 0.42, position: .subheader), // Heavy corruption
            createObservation("0L 0|2345G7", confidence: 0.38, position: .licenseNumber), // Severe errors
            createObservation("LN 4ND3R50N", confidence: 0.35, position: .lastName),
            createObservation("FN M|CH43L", confidence: 0.36, position: .firstName),
            createObservation("D08 0]/|5/|9B5", confidence: 0.32, position: .dateOfBirth), // Barely readable
            createObservation("3XP 0]/|5/202B", confidence: 0.34, position: .expirationDate),
            createObservation("53X |\\/|", confidence: 0.40, position: .sex), // Special char confusion
            createObservation("HGT G-0|", confidence: 0.33, position: .height),
            createObservation("WGT |85", confidence: 0.31, position: .weight),
            createObservation("3Y35 8RN", confidence: 0.30, position: .eyeColor),
            createObservation("|234 04K 5TR33T", confidence: 0.28, position: .addressLine1)
        ]
    }
    
    /**
     * Generate mixed-confidence scenario
     * Some fields clear, others requiring correction
     */
    static func generateMixedConfidenceFields() -> [[String: Any]] {
        return [
            // High confidence fields
            createObservation("TEXAS", confidence: 0.95, position: .header),
            createObservation("DRIVER LICENSE", confidence: 0.93, position: .subheader),
            createObservation("DL 12345678", confidence: 0.91, position: .licenseNumber),
            
            // Medium confidence fields with some errors
            createObservation("LN J0HNS0N", confidence: 0.68, position: .lastName), // 0→O
            createObservation("FN SAR4H", confidence: 0.65, position: .firstName), // 4→A
            
            // Low confidence fields
            createObservation("D08 |2/25/|990", confidence: 0.42, position: .dateOfBirth),
            createObservation("3XP |2/25/2026", confidence: 0.45, position: .expirationDate),
            
            // High confidence again
            createObservation("SEX F", confidence: 0.92, position: .sex),
            createObservation("HGT 5-06", confidence: 0.88, position: .height),
            
            // Variable confidence
            createObservation("EYES 8LU", confidence: 0.58, position: .eyeColor), // 8→B
            createObservation("HAIR BLN", confidence: 0.85, position: .hairColor)
        ]
    }
    
    // MARK: - State-Specific Error Pattern Scenarios
    
    /**
     * Generate California-specific OCR error patterns
     */
    static func generateCaliforniaSpecificErrors() -> [[String: Any]] {
        return [
            createObservation("CALIFORNIA", confidence: 0.92, position: .header),
            createObservation("DRIVER LICENSE", confidence: 0.90, position: .subheader),
            // California format: Letter + 7 digits, common error: O→0 in letter position
            createObservation("DL 0I23456O", confidence: 0.65, position: .licenseNumber), // O→D, I→1, O→0
            createObservation("LN MARTINEZ", confidence: 0.85, position: .lastName),
            createObservation("FN CARLOS", confidence: 0.86, position: .firstName),
            createObservation("DOB 07/04/1992", confidence: 0.82, position: .dateOfBirth),
            createObservation("CLASS C", confidence: 0.88, position: .licenseClass),
            createObservation("RSTR CORRECTIVE LENSES", confidence: 0.75, position: .restrictions)
        ]
    }
    
    /**
     * Generate Texas-specific OCR error patterns
     */
    static func generateTexasSpecificErrors() -> [[String: Any]] {
        return [
            createObservation("TEXAS", confidence: 0.94, position: .header),
            createObservation("DRIVER LICENSE", confidence: 0.91, position: .subheader),
            // Texas format: 8 digits, common errors in middle digits
            createObservation("DL I234S678", confidence: 0.62, position: .licenseNumber), // I→1, S→5
            createObservation("WILLIAMS, JENNIFER", confidence: 0.87, position: .fullName),
            createObservation("DOB 11/30/1988", confidence: 0.83, position: .dateOfBirth),
            createObservation("CLASS C", confidence: 0.89, position: .licenseClass),
            createObservation("END M", confidence: 0.85, position: .endorsements) // Motorcycle
        ]
    }
    
    /**
     * Generate Florida-specific OCR error patterns
     */
    static func generateFloridaSpecificErrors() -> [[String: Any]] {
        return [
            createObservation("FLORIDA", confidence: 0.93, position: .header),
            createObservation("DRIVER LICENSE", confidence: 0.90, position: .subheader),
            // Florida format: Letter + 12 digits, long number prone to middle errors
            createObservation("G12345G789OI2", confidence: 0.58, position: .licenseNumber), // G→6, O→0, I→1
            createObservation("RODRIGUEZ, MARIA", confidence: 0.88, position: .fullName),
            createObservation("DOB 05/12/1995", confidence: 0.84, position: .dateOfBirth),
            createObservation("CLASS E", confidence: 0.90, position: .licenseClass) // Florida uses E for regular
        ]
    }
    
    // MARK: - Cross-Field Validation Scenarios
    
    /**
     * Generate scenario for testing cross-field consistency
     */
    static func generateCrossFieldValidationScenario() -> [[String: Any]] {
        return [
            createObservation("NEW YORK", confidence: 0.94, position: .header),
            createObservation("DRIVER LICENSE", confidence: 0.92, position: .subheader),
            
            // Names that should validate against each other
            createObservation("SMITH, ROBERT JAMES", confidence: 0.85, position: .fullName),
            createObservation("LN SMITH", confidence: 0.88, position: .lastName),
            createObservation("FN ROBERT", confidence: 0.87, position: .firstName),
            
            // Dates that should be logically consistent
            createObservation("DOB 06/15/1990", confidence: 0.82, position: .dateOfBirth),
            createObservation("ISS 06/15/2020", confidence: 0.80, position: .issueDate), // 30 years later
            createObservation("EXP 06/15/2028", confidence: 0.81, position: .expirationDate), // 8 years valid
            
            // Physical characteristics that should be consistent
            createObservation("SEX M", confidence: 0.95, position: .sex),
            createObservation("HGT 5-11", confidence: 0.78, position: .height),
            createObservation("WGT 175", confidence: 0.76, position: .weight)
        ]
    }
    
    // MARK: - Performance Stress Test Data
    
    /**
     * Generate large dataset for performance testing
     */
    static func generateLargeDatasetForStressTesting(observationCount: Int = 100) -> [[String: Any]] {
        var observations: [[String: Any]] = []
        
        // Add core license fields
        observations.append(contentsOf: generateHighConfidencePerfectOCR())
        
        // Add many additional text observations (simulating busy license with lots of text)
        for i in 0..<observationCount {
            let confidence = Float.random(in: 0.3...0.95)
            let hasError = confidence < 0.7
            
            let text = hasError ? 
                "N0ISY_T3XT_\(i)_W1TH_3RR0RS" : 
                "CLEAN_TEXT_\(i)_OBSERVATION"
            
            observations.append(createObservation(
                text,
                confidence: confidence,
                position: .custom(x: Double.random(in: 0...0.8), y: Double.random(in: 0...0.8))
            ))
        }
        
        return observations
    }
    
    // MARK: - Edge Case Scenarios
    
    /**
     * Generate scenario with ambiguous characters
     */
    static func generateAmbiguousCharacterScenario() -> [[String: Any]] {
        return [
            // Characters that could be letters or numbers
            createObservation("DL O0O0O0O", confidence: 0.55, position: .licenseNumber), // O vs 0
            createObservation("FN I1I1I1", confidence: 0.52, position: .firstName), // I vs 1
            createObservation("LN S5S5S5", confidence: 0.53, position: .lastName), // S vs 5
            createObservation("HGT 6-O0", confidence: 0.58, position: .height), // O vs 0
            createObservation("DOB 0I/I5/I990", confidence: 0.50, position: .dateOfBirth), // Multiple ambiguous
            createObservation("EYES 8RN", confidence: 0.54, position: .eyeColor), // B vs 8
            createObservation("CLASS C0L", confidence: 0.56, position: .licenseClass) // CDL with O→D
        ]
    }
    
    /**
     * Generate scenario with special characters and punctuation errors
     */
    static func generateSpecialCharacterErrors() -> [[String: Any]] {
        return [
            createObservation("ADDR: |23 MA|N ST.", confidence: 0.48, position: .addressLine1), // | vs 1/I
            createObservation("APT #2O|", confidence: 0.45, position: .addressLine2), // O vs 0, | vs 1
            createObservation("DOB: 03\\15\\1990", confidence: 0.62, position: .dateOfBirth), // \ vs /
            createObservation("HGT: 5'10\"", confidence: 0.70, position: .height), // Quote variations
            createObservation("RSTR: CORR. LENSES", confidence: 0.68, position: .restrictions) // Abbreviations
        ]
    }
    
    // MARK: - Mock Data for Specific Test Cases
    
    /**
     * Generate mock VNRecognizedTextObservation data
     */
    static func createMockVNObservations(from observations: [[String: Any]]) -> [VNRecognizedTextObservation] {
        // Note: In actual tests, you would need to mock VNRecognizedTextObservation
        // This is a placeholder showing the structure
        return []
    }
    
    // MARK: - Helper Methods
    
    private static func createObservation(_ text: String, confidence: Float, position: FieldPosition) -> [String: Any] {
        let boundingBox = position.getBoundingBox()
        return [
            "text": text,
            "confidence": confidence,
            "boundingBox": [
                "x": boundingBox.x,
                "y": boundingBox.y,
                "width": boundingBox.width,
                "height": boundingBox.height
            ]
        ]
    }
    
    // MARK: - Field Position Enum
    
    private enum FieldPosition {
        case header
        case subheader
        case licenseNumber
        case fullName
        case firstName
        case lastName
        case dateOfBirth
        case expirationDate
        case issueDate
        case sex
        case height
        case weight
        case eyeColor
        case hairColor
        case licenseClass
        case restrictions
        case endorsements
        case addressLine1
        case addressLine2
        case custom(x: Double, y: Double)
        
        func getBoundingBox() -> (x: Double, y: Double, width: Double, height: Double) {
            switch self {
            case .header:
                return (0.1, 0.9, 0.3, 0.05)
            case .subheader:
                return (0.1, 0.85, 0.3, 0.05)
            case .licenseNumber:
                return (0.1, 0.6, 0.25, 0.05)
            case .fullName:
                return (0.1, 0.75, 0.4, 0.05)
            case .firstName:
                return (0.1, 0.7, 0.2, 0.05)
            case .lastName:
                return (0.1, 0.75, 0.2, 0.05)
            case .dateOfBirth:
                return (0.1, 0.5, 0.25, 0.05)
            case .expirationDate:
                return (0.1, 0.45, 0.25, 0.05)
            case .issueDate:
                return (0.1, 0.4, 0.25, 0.05)
            case .sex:
                return (0.5, 0.5, 0.1, 0.05)
            case .height:
                return (0.5, 0.45, 0.15, 0.05)
            case .weight:
                return (0.5, 0.4, 0.15, 0.05)
            case .eyeColor:
                return (0.5, 0.35, 0.15, 0.05)
            case .hairColor:
                return (0.5, 0.3, 0.15, 0.05)
            case .licenseClass:
                return (0.1, 0.35, 0.15, 0.05)
            case .restrictions:
                return (0.1, 0.3, 0.35, 0.05)
            case .endorsements:
                return (0.1, 0.25, 0.35, 0.05)
            case .addressLine1:
                return (0.1, 0.2, 0.4, 0.05)
            case .addressLine2:
                return (0.1, 0.15, 0.4, 0.05)
            case .custom(let x, let y):
                return (x, y, 0.2, 0.05)
            }
        }
    }
    
    // MARK: - Confidence Level Dataset Generation
    
    /**
     * Generate datasets with known accuracy rates for confidence validation
     */
    static func generateConfidenceLevelDatasets() -> [String: [[String: Any]]] {
        return [
            "confidence_0.1": generateDatasetWithConfidence(0.1),
            "confidence_0.2": generateDatasetWithConfidence(0.2),
            "confidence_0.3": generateDatasetWithConfidence(0.3),
            "confidence_0.4": generateDatasetWithConfidence(0.4),
            "confidence_0.5": generateDatasetWithConfidence(0.5),
            "confidence_0.6": generateDatasetWithConfidence(0.6),
            "confidence_0.7": generateDatasetWithConfidence(0.7),
            "confidence_0.8": generateDatasetWithConfidence(0.8),
            "confidence_0.9": generateDatasetWithConfidence(0.9)
        ]
    }
    
    private static func generateDatasetWithConfidence(_ targetConfidence: Float) -> [[String: Any]] {
        let errorRate = 1.0 - targetConfidence
        var observations: [[String: Any]] = []
        
        // Standard fields with controlled error injection
        let fields = [
            ("DL D1234567", "DL DI23456O", FieldPosition.licenseNumber),
            ("LN SMITH", "LN SM1TH", FieldPosition.lastName),
            ("FN JOHN", "FN J0HN", FieldPosition.firstName),
            ("DOB 01/15/1990", "DOB O1/I5/199O", FieldPosition.dateOfBirth),
            ("SEX M", "SEX N", FieldPosition.sex),
            ("HGT 5-10", "HGT 5-IO", FieldPosition.height)
        ]
        
        for (correct, withErrors, position) in fields {
            let useError = Float.random(in: 0...1) < errorRate
            let text = useError ? withErrors : correct
            let confidence = useError ? 
                targetConfidence - Float.random(in: 0.1...0.2) : 
                targetConfidence + Float.random(in: 0.05...0.15)
            
            observations.append(createObservation(
                text,
                confidence: min(max(confidence, 0.1), 0.99),
                position: position
            ))
        }
        
        return observations
    }
}