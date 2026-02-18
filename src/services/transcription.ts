import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import * as fs from "fs/promises";
import type { TranscriptSegment } from "../types.js";

export interface TranscriptionResult {
  transcript: string;
  segments: TranscriptSegment[];
}

export class TranscriptionService {
  private speech;

  constructor(auth: OAuth2Client) {
    this.speech = google.speech({ version: "v1", auth });
  }

  /**
   * Transcribe audio from a WAV file (16kHz, mono, PCM).
   * Uses synchronous recognition — supports up to ~60 seconds of audio,
   * which covers most ad video lengths.
   */
  async transcribe(audioPath: string): Promise<TranscriptionResult> {
    const audioContent = await fs.readFile(audioPath);
    const base64Audio = audioContent.toString("base64");

    const response = await this.speech.speech.recognize({
      requestBody: {
        config: {
          encoding: "LINEAR16",
          sampleRateHertz: 16000,
          languageCode: "en-US",
          enableWordTimeOffsets: true,
          enableAutomaticPunctuation: true,
        },
        audio: {
          content: base64Audio,
        },
      },
    });

    const results = response.data.results || [];
    const segments: TranscriptSegment[] = [];
    const transcriptParts: string[] = [];

    for (const result of results) {
      const alternative = result.alternatives?.[0];
      if (!alternative) continue;

      transcriptParts.push(alternative.transcript || "");

      const words = alternative.words || [];
      if (words.length > 0) {
        const firstWord = words[0];
        const lastWord = words[words.length - 1];
        const startTime = this.parseGoogleDuration(
          firstWord.startTime || "0s"
        );
        const endTime = this.parseGoogleDuration(lastWord.endTime || "0s");
        segments.push({
          text: alternative.transcript || "",
          startTime,
          endTime,
        });
      }
    }

    return {
      transcript: transcriptParts.join(" "),
      segments,
    };
  }

  /**
   * Parse Google's duration format (e.g. "1.500s" or "10s") to seconds.
   */
  private parseGoogleDuration(duration: string): number {
    if (typeof duration === "number") return duration;
    return parseFloat(String(duration).replace("s", "")) || 0;
  }
}
