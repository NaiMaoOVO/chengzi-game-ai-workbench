import Foundation
import Vision
import AppKit

let arguments = CommandLine.arguments

guard arguments.count >= 2 else {
  fputs("{\"error\":\"missing image path\"}\n", stderr)
  exit(1)
}

let imagePath = arguments[1]
let imageUrl = URL(fileURLWithPath: imagePath)

guard let image = NSImage(contentsOf: imageUrl),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  fputs("{\"error\":\"failed to load image\"}\n", stderr)
  exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["zh-Hans", "en-US"]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

do {
  try handler.perform([request])
  let lines = request.results?.compactMap { observation in
    observation.topCandidates(1).first?.string
  } ?? []
  let text = lines.joined(separator: "\n")
  let payload = ["text": text]
  let data = try JSONSerialization.data(withJSONObject: payload, options: [])
  FileHandle.standardOutput.write(data)
} catch {
  fputs("{\"error\":\"ocr failed\"}\n", stderr)
  exit(1)
}
