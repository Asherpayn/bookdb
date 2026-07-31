interface SiteverifyResult {
  success: boolean;
  hostname?: string;
  action?: string;
  ["error-codes"]?: string[];
}

/**
 * Server-side half of Turnstile: the client-side widget only proves a
 * challenge was shown, this call is what actually proves it was solved.
 * Cloudflare's docs are explicit that skipping this leaves writes wide open.
 */
export async function verifyTurnstileToken(
  token: string,
  secretKey: string,
  remoteIp: string | null,
): Promise<SiteverifyResult> {
  if (!token || token.length > 2048) {
    return { success: false };
  }

  const body = new URLSearchParams({ secret: secretKey, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`siteverify responded ${res.status}`);
    return await res.json();
  } catch {
    return { success: false };
  }
}
