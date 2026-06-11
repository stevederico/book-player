/**
 * Ambient declarations for chapters.js (LLM chapter generation).
 *
 * The implementation stays JavaScript; this file types its public surface.
 */
import type { WordTiming } from './kokoro.d.ts';

/** A generated chapter marker aligned to a timestamp in the audio. */
export interface Chapter {
  /** Start time in seconds. */
  time: number;
  /** Chapter title. */
  title: string;
  /** Source quote used to locate the timestamp. */
  quote: string;
  /** Optional caption. */
  caption?: string;
  /** Additional pipeline-specific fields (e.g. image metadata). */
  [key: string]: unknown;
}

/**
 * Generate chapter markers from a transcript and its word timings.
 */
export function generateChapters(args: {
  transcript: string;
  words: WordTiming[];
  durationSec: number;
}): Promise<Chapter[]>;
