import type { TranscriptItem } from "@getdial/sdk";

function tokenize(value: string): string[] {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("he")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function containsWakeName(content: string, wakeName: string): boolean {
  const contentTokens = tokenize(content);
  const wakeTokens = tokenize(wakeName);

  if (wakeTokens.length === 0 || contentTokens.length < wakeTokens.length) {
    return false;
  }

  return contentTokens.some((_, startIndex) =>
    wakeTokens.every(
      (wakeToken, offset) => contentTokens[startIndex + offset] === wakeToken,
    ),
  );
}

export function getLatestUserTurn(transcript: TranscriptItem[]): {
  content: string;
  index: number;
} | null {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = transcript[index];
    if (item.role === "user") return { content: item.content, index };
  }

  return null;
}
