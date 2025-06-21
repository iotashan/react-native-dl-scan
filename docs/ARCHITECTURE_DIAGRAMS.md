# Visual Architecture Diagrams for React Native License Scanner

## Overview

This document provides visual representations of the license scanner architecture using Mermaid diagrams and ASCII art for clear understanding of system components and data flow.

## 1. High-Level System Architecture

```mermaid
graph TB
    subgraph "React Native Layer"
        UI[Scanner UI Component]
        Hook[useLicenseScanner Hook]
        Context[Error Context Provider]
        Bridge[Native Bridge]
    end
    
    subgraph "iOS Native Layer"
        FP[Frame Processor Plugin]
        VP[Vision Processor]
        CM[Camera Manager]
        DLP[DLParser-Swift Library]
    end
    
    subgraph "Hardware Layer"
        Camera[Device Camera]
        NE[Neural Engine M3]
    end
    
    UI --> Hook
    Hook --> Bridge
    Bridge --> FP
    FP --> VP
    FP --> DLP
    VP --> NE
    CM --> Camera
    
    style UI fill:#4ECDC4
    style Hook fill:#4ECDC4
    style Context fill:#4ECDC4
    style Bridge fill:#FFE66D
    style FP fill:#FF6B6B
    style VP fill:#FF6B6B
    style CM fill:#FF6B6B
    style DLP fill:#FF6B6B
    style Camera fill:#95E1D3
    style NE fill:#95E1D3
```

## 2. Data Flow Architecture

```mermaid
sequenceDiagram
    participant User
    participant UI as React Native UI
    participant FP as Frame Processor
    participant Vision as Vision Framework
    participant DLP as DLParser-Swift
    participant State as App State
    
    User->>UI: Position License
    UI->>FP: Camera Frame
    
    par Parallel Processing
        FP->>Vision: Document Detection
        Vision-->>FP: Bounds & Quality
    and
        FP->>Vision: Text Recognition
        Vision-->>FP: OCR Results
    and
        FP->>Vision: Barcode Detection
        Vision-->>FP: PDF417 Data
    end
    
    FP->>DLP: Parse PDF417 Data
    DLP-->>FP: Validated License Data
    FP-->>UI: Processing Result
    UI->>State: Update License Data
    UI-->>User: Display Results
```

## 3. Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    React Native Application                  │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │  Scanner Screen │  │ Result Screen│  │ Error Display │ │
│  └────────┬────────┘  └──────┬───────┘  └───────┬───────┘ │
│           │                   │                   │         │
│  ┌────────▼─────────────────────────────────────▼───────┐  │
│  │              License Scanner Component                │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐ │  │
│  │  │   Camera    │  │   Overlay   │  │   Guidance   │ │  │
│  │  │   View      │  │   Frame     │  │   Messages   │ │  │
│  │  └─────────────┘  └─────────────┘  └──────────────┘ │  │
│  └───────────────────────────┬──────────────────────────┘  │
├──────────────────────────────┼──────────────────────────────┤
│                              │                              │
│  ┌───────────────────────────▼──────────────────────────┐  │
│  │            React Native Vision Camera                 │  │
│  │                  Frame Processor                      │  │
│  └───────────────────────────┬──────────────────────────┘  │
├──────────────────────────────┼──────────────────────────────┤
│                     Native Bridge (JSI)                     │
├──────────────────────────────┼──────────────────────────────┤
│                              │                              │
│  ┌───────────────────────────▼──────────────────────────┐  │
│  │                iOS Native Module                      │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────────┐ │  │
│  │  │   Vision   │  │   AAMVA    │  │    Camera      │ │  │
│  │  │ Processor  │  │   Parser   │  │    Manager     │ │  │
│  │  └────────────┘  └────────────┘  └────────────────┘ │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 4. Frame Processing Pipeline

```mermaid
graph LR
    subgraph "Frame Input"
        CF[Camera Frame<br/>1920x1080 @ 30fps]
    end
    
    subgraph "Pre-Processing"
        PC[Pixel Conversion<br/>YUV → RGB]
        DQ[Quality Check<br/>Blur/Brightness]
    end
    
    subgraph "Document Detection"
        DD[VNDetectDocumentSegmentationRequest]
        PE[Perspective<br/>Correction]
    end
    
    subgraph "Data Extraction"
        PDF[PDF417<br/>Barcode]
        OCR[Text<br/>Recognition]
        FACE[Face<br/>Detection]
    end
    
    subgraph "Validation"
        AAM[AAMVA<br/>Parsing]
        VAL[Data<br/>Validation]
    end
    
    subgraph "Output"
        RES[License<br/>Data]
    end
    
    CF --> PC
    PC --> DQ
    DQ --> DD
    DD --> PE
    PE --> PDF
    PE --> OCR
    PE --> FACE
    PDF --> AAM
    OCR --> AAM
    AAM --> VAL
    VAL --> RES
    
    style CF fill:#95E1D3
    style RES fill:#4ECDC4
```

## 5. Error Handling Flow

```mermaid
stateDiagram-v2
    [*] --> Scanning
    
    Scanning --> CameraError: Camera Issue
    Scanning --> ProcessingError: Vision Error
    Scanning --> DocumentError: Quality Issue
    Scanning --> ParsingError: AAMVA Error
    Scanning --> Success: Valid Scan
    
    CameraError --> ErrorDisplay
    ProcessingError --> ErrorDisplay
    DocumentError --> Guidance
    ParsingError --> ErrorDisplay
    
    ErrorDisplay --> Retry: User Action
    ErrorDisplay --> Settings: Permission Issue
    ErrorDisplay --> ManualEntry: Give Up
    
    Guidance --> Scanning: Adjusted
    Retry --> Scanning
    Settings --> [*]
    ManualEntry --> [*]
    Success --> [*]
    
    state ErrorDisplay {
        ShowMessage
        ShowRecovery
        LogError
    }
    
    state Guidance {
        ShowHint
        QualityBar
        Animation
    }
```

## 6. Memory Management Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Frame Processor                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │              Buffer Pool (3 buffers)             │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐     │  │
│  │  │ Buffer 1 │  │ Buffer 2 │  │ Buffer 3 │     │  │
│  │  │   Active │  │Available │  │Available │     │  │
│  │  └─────┬────┘  └──────────┘  └──────────┘     │  │
│  └────────┼────────────────────────────────────────┘  │
│           │                                            │
│  ┌────────▼────────────────────────────────────────┐  │
│  │            Processing Queue (Serial)             │  │
│  │                                                  │  │
│  │  1. Acquire Buffer    ┌──────────────┐         │  │
│  │  2. Process Frame ───►│ Autorelease  │         │  │
│  │  3. Extract Data      │    Pool      │         │  │
│  │  4. Return Buffer     └──────────────┘         │  │
│  └─────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## 7. State Management Flow

```mermaid
graph TB
    subgraph "React State"
        LS[License State<br/>null | LicenseData]
        ES[Error State<br/>null | Error]
        PS[Processing State<br/>idle | scanning | processing]
    end
    
    subgraph "Actions"
        SS[Start Scan]
        DS[Detect Document]
        PD[Process Data]
        HD[Handle Error]
        RS[Reset State]
    end
    
    subgraph "Side Effects"
        CAM[Camera Active]
        FP[Frame Processing]
        AN[Analytics]
    end
    
    SS --> PS
    PS --> CAM
    CAM --> FP
    DS --> PS
    PD --> LS
    PD --> ES
    HD --> ES
    ES --> AN
    RS --> LS
    RS --> ES
    RS --> PS
    
    style LS fill:#4ECDC4
    style ES fill:#FF6B6B
    style PS fill:#FFE66D
```

## 8. Performance Optimization Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Performance Pipeline                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Camera Input     Frame Processing      Quality Control     │
│  ┌─────────┐      ┌─────────────┐      ┌──────────────┐  │
│  │ 30 FPS  │ ───► │ Downsample  │ ───► │   Quality    │  │
│  │ 1920x   │      │   to 10 FPS │      │   Check      │  │
│  │ 1080    │      │  if needed  │      │  (Sharp?)    │  │
│  └─────────┘      └─────────────┘      └──────┬───────┘  │
│                                                 │           │
│                   ┌─────────────────────────────▼───────┐  │
│                   │     Adaptive Processing Rate        │  │
│                   │  ┌────────┐  ┌────────┐  ┌──────┐ │  │
│                   │  │ Light  │  │ Medium │  │ Heavy│ │  │
│                   │  │ 15 FPS │  │ 10 FPS │  │5 FPS │ │  │
│                   │  └────────┘  └────────┘  └──────┘ │  │
│                   └─────────────────────────────────────┘  │
│                                                             │
│  Neural Engine    Parallel Tasks        Result Cache       │
│  ┌──────────┐     ┌─────────────┐      ┌──────────────┐  │
│  │ M3 Chip  │     │ • Document  │      │ Recent Scans │  │
│  │ 18 TOPS  │ ◄───┤ • Barcode   │ ───► │   (LRU)      │  │
│  │          │     │ • OCR       │      │              │  │
│  └──────────┘     └─────────────┘      └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 9. Module Structure

```
react-native-dl-scan/
├── ios/
│   ├── LicenseScanner/
│   │   ├── Core/                    [Business Logic]
│   │   │   ├── VisionProcessor.swift
│   │   │   ├── DLParserIntegration.swift
│   │   │   ├── DocumentDetector.swift
│   │   │   └── QualityAnalyzer.swift
│   │   │
│   │   ├── FrameProcessor/          [Vision Camera Integration]
│   │   │   ├── LicenseScannerPlugin.swift
│   │   │   ├── FrameProcessorPlugin.h
│   │   │   └── BufferPool.swift
│   │   │
│   │   ├── Bridge/                  [React Native Bridge]
│   │   │   ├── RNLicenseScanner.m
│   │   │   ├── RNLicenseScanner.swift
│   │   │   └── ErrorTranslator.swift
│   │   │
│   │   └── Utils/                   [Helpers]
│   │       ├── ImageUtils.swift
│   │       ├── DateFormatter.swift
│   │       └── Logger.swift
│   │
│   └── LicenseScanner.podspec
│
├── src/
│   ├── components/                  [UI Components]
│   │   ├── LicenseScanner.tsx
│   │   ├── ScanningOverlay.tsx
│   │   ├── ErrorDisplay.tsx
│   │   └── ScanningGuidance.tsx
│   │
│   ├── hooks/                       [React Hooks]
│   │   ├── useLicenseScanner.ts
│   │   ├── useFrameProcessor.ts
│   │   └── useErrorRecovery.ts
│   │
│   ├── contexts/                    [State Management]
│   │   ├── ErrorContext.tsx
│   │   └── ScannerContext.tsx
│   │
│   ├── types/                       [TypeScript Types]
│   │   ├── license.ts
│   │   ├── errors.ts
│   │   └── dlparser.ts
│   │
│   └── utils/                       [Utilities]
│       ├── errorHandler.ts
│       ├── analytics.ts
│       └── storage.ts
│
├── __tests__/
├── example/
└── docs/
```

## 10. Deployment Architecture

```mermaid
graph TB
    subgraph "Development"
        DEV[Development Build]
        TEST[Unit Tests]
        E2E[E2E Tests]
    end
    
    subgraph "CI/CD Pipeline"
        GH[GitHub Actions]
        BUILD[Build & Test]
        LINT[Lint & Type Check]
    end
    
    subgraph "Distribution"
        TF[TestFlight]
        AS[App Store]
    end
    
    subgraph "Monitoring"
        CRASH[Crash Reports]
        ANAL[Analytics]
        PERF[Performance]
    end
    
    DEV --> TEST
    TEST --> E2E
    E2E --> GH
    GH --> BUILD
    GH --> LINT
    BUILD --> TF
    TF --> AS
    AS --> CRASH
    AS --> ANAL
    AS --> PERF
    
    style DEV fill:#4ECDC4
    style GH fill:#FFE66D
    style AS fill:#95E1D3
    style CRASH fill:#FF6B6B
```

## Interactive Architecture Viewer

For an interactive view of these diagrams, you can use the following tools:

1. **Mermaid Live Editor**: https://mermaid.live/
   - Copy any mermaid diagram code and paste it for interactive viewing
   
2. **Draw.io Integration**: 
   - Import these diagrams into draw.io for customization
   
3. **VS Code Extensions**:
   - Mermaid Preview
   - PlantUML

## Architecture Decision Records (ADRs)

### ADR-001: Use React Native Vision Camera
- **Status**: Accepted
- **Context**: Need high-performance camera access
- **Decision**: Use Vision Camera for JSI-based frame processing
- **Consequences**: Better performance, more complex setup

### ADR-002: Parallel Processing Strategy
- **Status**: Accepted
- **Context**: Multiple extraction methods needed
- **Decision**: Process OCR, barcode, and face detection in parallel
- **Consequences**: Faster processing, higher memory usage

### ADR-003: Error Recovery Approach
- **Status**: Accepted
- **Context**: Various failure modes possible
- **Decision**: Implement automatic retry with user guidance
- **Consequences**: Better UX, more complex error handling

## Conclusion

These visual representations provide a comprehensive understanding of the React Native license scanner architecture. The diagrams illustrate data flow, component relationships, and system design decisions that enable efficient, reliable license scanning on iOS devices.