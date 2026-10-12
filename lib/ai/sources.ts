import { normalizeUrl, type SearchResult } from "./client";

/** URLs in `cited` that did not come back from web search in this call. */
export function unverifiedUrls(cited: string[], searchResults: Map<string, SearchResult>): string[] {
  return cited.filter((u) => !searchResults.has(normalizeUrl(u)));
}

/** Keep only citations that web search actually returned; attach their titles. */
export function verifiedSources(cited: string[], searchResults: Map<string, SearchResult>): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const u of cited) {
    const key = normalizeUrl(u);
    const hit = searchResults.get(key);
    if (hit && !seen.has(key)) {
      seen.add(key);
      out.push(hit);
    }
  }
  return out;
}
