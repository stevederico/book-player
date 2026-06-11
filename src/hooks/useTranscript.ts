import { useMemo } from 'react';
import {
  parseTranscript,
  buildAnchors,
  alignTimings,
  wordIndexFromTimes,
  wordIndexAtTime,
  buildCaptionChunks,
  chunkIndexAtWord,
} from '../utils/playerUtils';
import type {
  Guide,
  TranscriptParagraph,
  TimingWord,
  Anchor,
  CaptionChunk,
} from '../utils/playerUtils';

/** Derived transcript/timing data returned by {@link useTranscript}. */
export interface UseTranscriptResult {
  /** Parsed transcript paragraphs, or null when unavailable. */
  transcriptParas: TranscriptParagraph[] | null;
  /** Raw backend timing words, or null. */
  timingWords: TimingWord[] | null;
  /** Total transcript word count. */
  totalWords: number;
  /** Word/time anchors for interpolation, or null. */
  anchors: Anchor[] | null;
  /** Per-word start times, or null. */
  wordStartTimes: number[] | null;
  /** Caption chunks, or null. */
  captionChunks: CaptionChunk[] | null;
  /** Currently active word index (-1 when none). */
  activeWord: number;
  /** Currently active caption chunk, or null. */
  activeCaption: CaptionChunk | null;
}

/**
 * Custom hook that handles all transcript parsing, timing alignment,
 * chapter anchoring, caption chunking, and active word/caption calculation.
 *
 * @param guide - The loaded guide (or null while loading).
 * @param duration - Audio duration in seconds.
 * @param current - Current playhead time in seconds.
 * @param captionsOn - Whether captions should be computed.
 * @returns Derived transcript and timing data.
 */
export function useTranscript(
  guide: Guide | null,
  duration: number,
  current: number,
  captionsOn = true
): UseTranscriptResult {
  const transcriptParas = useMemo(
    () => (typeof guide?.transcript === 'string' && guide.transcript.length)
      ? parseTranscript(guide.transcript)
      : null,
    [guide?.transcript]
  );

  const timingWords = useMemo<TimingWord[] | null>(() => {
    const t = guide?.timing;
    if (!t) return null;
    if (Array.isArray(t)) return t;
    return Array.isArray(t.words) ? t.words : null;
  }, [guide?.timing]);

  const totalWords = useMemo(
    () => (transcriptParas ? transcriptParas.reduce((n, p) => n + p.words.length, 0) : 0),
    [transcriptParas]
  );

  const anchors = useMemo(
    () => buildAnchors(transcriptParas, guide?.chapters, duration),
    [transcriptParas, guide?.chapters, duration]
  );

  const wordStartTimes = useMemo(
    () => alignTimings(transcriptParas, timingWords),
    [transcriptParas, timingWords]
  );

  const captionChunks = useMemo(
    () => buildCaptionChunks(transcriptParas),
    [transcriptParas]
  );

  const activeWord = useMemo(() => {
    if (!totalWords) return -1;
    const offset = guide?.timingOffset || 0;
    // Lead audio by ~120ms so the highlight lands as the word is heard,
    // not after. Compensates for output latency + perceptual lag.
    const HIGHLIGHT_LEAD = 0.27;
    const t = current - offset + HIGHLIGHT_LEAD;
    const w = wordStartTimes
      ? wordIndexFromTimes(wordStartTimes, t)
      : wordIndexAtTime(anchors, t);
    return Math.max(0, Math.min(totalWords - 1, w));
  }, [current, anchors, wordStartTimes, totalWords, guide?.timingOffset]);

  const activeCaption = useMemo(() => {
    if (!captionsOn || !captionChunks?.length || activeWord < 0) return null;
    const i = chunkIndexAtWord(captionChunks, activeWord);
    return captionChunks[i] || null;
  }, [captionsOn, captionChunks, activeWord]);

  return {
    transcriptParas,
    timingWords,
    totalWords,
    anchors,
    wordStartTimes,
    captionChunks,
    activeWord,
    activeCaption,
  };
}
