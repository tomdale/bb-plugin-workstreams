/**
 * The machine side of pull request reads. The server already validated these
 * URLs, but this process runs `gh` with them, so it checks again: a URL is read
 * only when it is a pull request URL on the hostname named beside it.
 */
import {
  parsePullRequestUrl,
  type PullRequestLookup,
} from "../../domain/pullRequests.ts";
import { readPullRequests, runGh, type GhRunner } from "./github.ts";

export async function readPullRequestsOnHost(
  request: { hostname: string; urls: readonly string[] },
  signal?: AbortSignal,
  run: GhRunner = runGh,
): Promise<PullRequestLookup[]> {
  const refused = new Map<string, PullRequestLookup>();
  const valid: string[] = [];
  for (const url of request.urls) {
    const parsed = parsePullRequestUrl(url);
    if (
      parsed.ok &&
      parsed.target.url === url &&
      parsed.target.hostname === request.hostname
    )
      valid.push(url);
    else
      refused.set(url, {
        outcome: "failed",
        url,
        failure: "unavailable",
        message: "Not a pull request URL on this hostname.",
        retryAfterMs: null,
      });
  }
  const read = valid.length
    ? await readPullRequests(
        run,
        { hostname: request.hostname, urls: valid },
        signal,
      )
    : [];
  const byUrl = new Map(read.map((lookup) => [lookup.url, lookup]));
  return request.urls.map((url) => refused.get(url) ?? byUrl.get(url)!);
}
