import dns from "node:dns/promises";
import net from "node:net";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export const WEBSITE_FETCH_TIMEOUT_MS = 15_000;
export const WEBSITE_MAX_HTML_BYTES = 5 * 1024 * 1024;
export const WEBSITE_MIN_TEXT_CHARS = 40;
export const WEBSITE_MAX_REDIRECTS = 5;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google",
]);

/**
 * Normalize and validate a user-supplied website URL.
 * Only http(s) public hosts are allowed (basic SSRF guard).
 */
export function normalizeWebsiteUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Invalid URL");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error("Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Invalid URL. Only http and https are supported.");
  }

  const host = parsed.hostname.toLowerCase();
  if (!host || BLOCKED_HOSTS.has(host) || host.endsWith(".localhost")) {
    throw new Error("Website unreachable. This host is not allowed.");
  }

  if (isPrivateOrLocalHostname(host)) {
    throw new Error("Website unreachable. This host is not allowed.");
  }

  parsed.hash = "";
  // Stable duplicate key: drop trailing slash except for root.
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return parsed.toString();
}

function isPrivateOrLocalHostname(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();

  if (
    bare === "0.0.0.0" ||
    bare === "::" ||
    bare === "::1" ||
    bare === "0" ||
    bare === "local"
  ) {
    return true;
  }

  // IPv4 literals
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(bare);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    if (parts.some((n) => n > 255)) return true;
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  // IPv6 literals (coarse)
  if (bare.includes(":")) {
    if (
      bare === "::1" ||
      bare.startsWith("fc") ||
      bare.startsWith("fd") ||
      bare.startsWith("fe80") ||
      bare.startsWith("::ffff:127.") ||
      bare.startsWith("::ffff:10.") ||
      bare.startsWith("::ffff:192.168.") ||
      /^::ffff:169\.254\./.test(bare) ||
      /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./.test(bare)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Resolve hostname and reject if any address is private / link-local.
 * Prevents DNS-rebinding SSRF where a public name resolves to 169.254.169.254.
 * NXDOMAIN / transient DNS failures are left to fetch (do not false-positive).
 */
async function assertPublicResolvedHost(host: string): Promise<void> {
  if (isPrivateOrLocalHostname(host)) {
    throw new Error("Website unreachable. This host is not allowed.");
  }

  // IP literals are already covered by isPrivateOrLocalHostname.
  if (net.isIP(host.replace(/^\[|\]$/g, ""))) {
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    // Name does not resolve yet — fetch will fail (or a test mock will answer).
    // Only block when DNS successfully returns a private address.
    if (
      code === "ENOTFOUND" ||
      code === "ENODATA" ||
      code === "EAI_AGAIN" ||
      code === "ESERVFAIL"
    ) {
      return;
    }
    throw new Error("Website unreachable");
  }

  if (addresses.length === 0) {
    return;
  }

  for (const { address } of addresses) {
    if (isPrivateOrLocalHostname(address)) {
      throw new Error("Website unreachable. This host is not allowed.");
    }
  }
}

async function assertSafeFetchUrl(raw: string): Promise<string> {
  const url = normalizeWebsiteUrl(raw);
  const host = new URL(url).hostname;
  await assertPublicResolvedHost(host);
  return url;
}

export type FetchedWebsite = {
  url: string;
  title: string;
  text: string;
  htmlBytes: number;
  contentType: string;
};

/**
 * Fetch a public web page and extract readable article text.
 * Follows redirects manually and re-validates each hop (SSRF-safe).
 */
export async function fetchWebsiteContent(
  rawUrl: string,
  options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<FetchedWebsite> {
  const startUrl = await assertSafeFetchUrl(rawUrl);
  const timeoutMs = options?.timeoutMs ?? WEBSITE_FETCH_TIMEOUT_MS;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  options?.signal?.addEventListener("abort", onAbort);

  let response: Response;
  let finalUrl = startUrl;

  try {
    const result = await fetchWithSafeRedirects(startUrl, controller.signal);
    response = result.response;
    finalUrl = result.finalUrl;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || /aborted|timeout/i.test(error.message))
    ) {
      throw new Error("Website fetch timed out");
    }
    if (
      error instanceof Error &&
      (/not allowed|Invalid URL|unreachable/i.test(error.message) ||
        /Unsupported content type|too large|Empty website/i.test(error.message))
    ) {
      throw error;
    }
    throw new Error("Website unreachable");
  } finally {
    clearTimeout(timeout);
    options?.signal?.removeEventListener("abort", onAbort);
  }

  if (!response.ok) {
    throw new Error(`Website unreachable (HTTP ${response.status})`);
  }

  const contentType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (
    contentType &&
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml") &&
    !contentType.includes("text/plain")
  ) {
    throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > WEBSITE_MAX_HTML_BYTES) {
    throw new Error("Website content is too large");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new Error("Empty website content");
  }
  if (buffer.byteLength > WEBSITE_MAX_HTML_BYTES) {
    throw new Error("Website content is too large");
  }

  const html = buffer.toString("utf8");
  const extracted = extractReadableText(html, finalUrl);

  if (!extracted.text || extracted.text.length < WEBSITE_MIN_TEXT_CHARS) {
    throw new Error("Empty website content");
  }

  return {
    // Keep the normalized request URL as the stable duplicate key.
    url: startUrl,
    title: extracted.title,
    text: extracted.text,
    htmlBytes: buffer.byteLength,
    contentType: contentType || "text/html",
  };
}

async function fetchWithSafeRedirects(
  startUrl: string,
  signal: AbortSignal
): Promise<{ response: Response; finalUrl: string }> {
  let current = startUrl;

  for (let hop = 0; hop <= WEBSITE_MAX_REDIRECTS; hop += 1) {
    current = await assertSafeFetchUrl(current);

    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "User-Agent": "SiroAIBot/1.0 (+https://siro.ai; notebook source fetcher)",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("Website unreachable");
      }
      // Resolve relative Location headers against the current URL.
      current = new URL(location, current).toString();
      continue;
    }

    return { response, finalUrl: current };
  }

  throw new Error("Website unreachable");
}

function extractReadableText(
  html: string,
  url: string
): { title: string; text: string } {
  const { document } = parseHTML(html);

  // Drop obvious non-content early so Readability / fallback stay clean.
  for (const selector of [
    "script",
    "style",
    "noscript",
    "iframe",
    "svg",
    "canvas",
    "nav",
    "footer",
    "header",
    "aside",
    "form",
    "[role='navigation']",
    "[role='banner']",
    "[role='contentinfo']",
    ".advertisement",
    ".ads",
    "#cookie-banner",
  ]) {
    document.querySelectorAll(selector).forEach((node) => node.remove());
  }

  const title =
    document.querySelector("title")?.textContent?.trim() ||
    document.querySelector("h1")?.textContent?.trim() ||
    "";

  try {
    const reader = new Readability(document, { charThreshold: 40 });
    const article = reader.parse();
    if (article?.textContent?.trim()) {
      const text = collapseWhitespace(article.textContent);
      if (text.length >= WEBSITE_MIN_TEXT_CHARS) {
        return {
          title: (article.title?.trim() || title || hostnameTitle(url)).slice(
            0,
            100
          ),
          text,
        };
      }
    }
  } catch {
    // Fall through to body text.
  }

  const root =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.body;

  const text = collapseWhitespace(root?.textContent ?? "");
  return {
    title: (title || hostnameTitle(url)).slice(0, 100),
    text,
  };
}

function collapseWhitespace(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function hostnameTitle(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || "Website";
  } catch {
    return "Website";
  }
}

export function defaultTitleFromWebsite(input: {
  pageTitle?: string | null;
  url: string;
}): string {
  const fromPage = input.pageTitle?.trim();
  if (fromPage) return fromPage.slice(0, 100);
  return hostnameTitle(input.url).slice(0, 100);
}
