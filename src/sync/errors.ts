// Telling "the game server can't be reached" apart from ordinary refusals.
// A free Supabase project that has been paused (or a phone with no signal)
// fails at the network level rather than answering, so those errors get a
// friendlier message that says what to do.

export const SERVER_ASLEEP =
  "Can't reach the game server. If nobody has played for a while it may be asleep: " +
  "the host can wake it from the Supabase dashboard (Resume project), which takes a minute or two. " +
  "Games kept on this phone still work.";

export class UnreachableError extends Error {
  constructor() {
    super(SERVER_ASLEEP);
    this.name = "UnreachableError";
  }
}

const PATTERNS = [
  /failed to fetch/i, // Chrome
  /load failed/i, // Safari
  /networkerror/i, // Firefox
  /fetch failed/i, // Node
  /network request failed/i,
  /timed? ?out/i,
  /ECONNREFUSED|ENOTFOUND|EAI_AGAIN/,
  /\b(502|503|504|540)\b/, // gateway errors; 540 = project paused
  /project (is )?paused/i,
];

/** True if an error message means the server didn't answer (not a refusal). */
export function isUnreachable(message: string | undefined | null): boolean {
  return !!message && PATTERNS.some((p) => p.test(message));
}
