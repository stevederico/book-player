import { useMemo } from 'react';
import {
  parseTranscript,
  buildAnchors,
  alignTimings,
  wordIndexFromTimes,
  wordIndexAtTime,
  buildCaptionChunks,
  chunkIndexAtWord,
} from '../lib/playerUtils.js';

/**
 * Custom hook that handles all transcript parsing, timing alignment,
 * chapter anchoring, caption chunking, and active word/caption calculation.
 */
export function useTranscript(guide, duration, current, captionsOn = true) {
  const transcriptParas = useMemo(
    () => (typeof guide?.transcript === 'string' && guide.transcript.length)
      ? parseTranscript(guide.transcript)
      : null,
    [guide?.transcript]
  );

  const timingWords = useMemo(() => {
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
    const w = wordStartTimes
      ? wordIndexFromTimes(wordStartTimes, current - offset)
      : wordIndexAtTime(anchors, current);
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
