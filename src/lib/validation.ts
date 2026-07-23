import { isIP } from "node:net";
import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  const ipVersion = isIP(host);
  if (!ipVersion) return false;
  if (ipVersion === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
}

export function normalizePublicUrl(value: string) {
  const parsed = new URL(value.trim());
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only HTTP/HTTPS URLs are allowed");
  if (parsed.username || parsed.password) throw new Error("URL credentials are not allowed");
  if (isPrivateHostname(parsed.hostname)) throw new Error("Private or local URLs are not allowed");
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return parsed.origin + (parsed.pathname === "/" ? "" : parsed.pathname);
}

export const projectSchema = z.object({
  name: z.string().trim().min(2).max(100),
  oldUrl: z.string().url(),
  newUrl: z.string().url(),
  maxPages: z.coerce.number().int().min(1).max(2000).default(500),
});
