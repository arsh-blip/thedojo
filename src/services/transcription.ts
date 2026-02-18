import * as fs from "fs/promises";
import * as path from "path";
import type { TranscriptSegment } from "../types.js";

export interface TranscriptionResult {
  transcript: string;
  segments: TranscriptSegment[];
}

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

interface WhisperVerboseResponse {
  text: string;
  segments: WhisperSegment[];
}

export class TranscriptionService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Transcribe audio using OpenAI's Whisper API.
   * Supports files up to 25 MB. Returns timestamped segments.
   */
  async transcribe(audioPath: string): Promise<TranscriptionResult> {
    const audioBuffer = await fs.readFile(audioPath);
    const fileName = path.basename(audioPath);

    // Build multipart form data manually since we're using native fetch
    const boundary = `----whisper-${Date.now()}`;
    const parts: Buffer[] = [];

    // file field
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: audio/wav\r\n\r\n`
      )
    );
    parts.push(audioBuffer);
    parts.push(Buffer.from("\r\n"));

    // model field
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`
      )
    );

    // response_format field
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`
      )
    );

    // timestamp_granularities field
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\nsegment\r\n`
      )
    );

    // closing boundary
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Whisper API error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as WhisperVerboseResponse;

    const segments: TranscriptSegment[] = (data.segments || []).map((seg) => ({
      text: seg.text.trim(),
      startTime: seg.start,
      endTime: seg.end,
    }));

    return {
      transcript: data.text || "",
      segments,
    };
  }
}
