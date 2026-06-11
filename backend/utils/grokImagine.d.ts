/**
 * Ambient declarations for grokImagine.js (Grok Imagine image generation +
 * small async helpers).
 *
 * The implementation stays JavaScript; this file types its public surface.
 */

/**
 * Call Grok Imagine and download the resulting image bytes.
 */
export function generateImage(args: {
  prompt: string;
}): Promise<{ buffer: Buffer; contentType: string; url: string }>;

/** Choose a file extension (e.g. 'png', 'jpg', 'webp') from a content-type header. */
export function extFromContentType(contentType: string | null | undefined): string;

/**
 * Promise pool: run `tasks` (thunks) with at most `concurrency` in flight,
 * returning results in input order.
 */
export function pLimit<T>(concurrency: number, tasks: Array<() => Promise<T>>): Promise<T[]>;
