import Foundation
import Vision

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

guard CommandLine.arguments.count == 2 else {
    fail("Usage: swift ocr.swift /absolute/path/to/image")
}

if #available(macOS 10.15, *) {
    let url = URL(fileURLWithPath: CommandLine.arguments[1])
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    if #available(macOS 13.0, *) {
        request.automaticallyDetectsLanguage = true
    }
    do {
        let handler = VNImageRequestHandler(url: url, options: [:])
        try handler.perform([request])
        let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
        FileHandle.standardOutput.write(Data(lines.joined(separator: "\n").utf8))
    } catch {
        fail("Apple Vision could not read this image: \(error.localizedDescription)")
    }
} else {
    fail("Apple Vision text recognition needs macOS 10.15 or newer. Install Tesseract on older systems.")
}
