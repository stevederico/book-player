/**
 * Ambient declarations for analyze.js (LLM transcript analysis + chapter timing).
 *
 * The implementation stays JavaScript; this file types its public surface.
 */
import type { WordTiming } from './kokoro.d.ts';
import type { Chapter } from './chapters.d.ts';

/** Chapter outline produced by analyzeTranscript before timing is attached. */
export interface ChapterOutline {
  /** Chapter title. */
  title: string;
  /** Source quote used to locate the chapter in the audio. */
  quote: string;
  /** Optional caption. */
  caption: string;
}

/**
 * Analyze a transcript into author, summary, and untimed chapter outlines.
 */
export function analyzeTranscript(args: {
  transcript: string;
  durationSec?: number;
  sourceUrl?: string | null;
}): Promise<{ author: string | null; summary: string; chapterOutlines: ChapterOutline[] }>;

/**
 * Attach a `time` to each chapter outline by matching its quote against the
 * word-timing stream. Drops chapters whose quote cannot be located.
 */
export function attachChapterTimes(args: {
  chapterOutlines: ChapterOutline[];
  words: WordTiming[];
}): Chapter[];
