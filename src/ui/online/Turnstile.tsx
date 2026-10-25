import { useEffect, useRef, useState } from "react";

// Cloudflare Turnstile in non-interactive mode: it normally checks the visitor without any input
// and shows itself only if it has to. The Worker verifies the token server-side.

/** Cloudflare's published test key; it always passes. Used when no real key is configured. */
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      appearance?: "always" | "execute" | "interaction-only";
      callback: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    },
  ): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function turnstileSiteKey(): string {
  const key = (import.meta.env?.PUBLIC_TURNSTILE_SITE_KEY as string | undefined)?.trim();
  return key || TURNSTILE_TEST_SITE_KEY;
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile did not start.")));
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Could not load the Cloudflare check."));
    };
    document.head.append(script);
  });
  return scriptPromise;
}

type Props = {
  onToken: (token: string | null) => void;
  /** Change this number to get a fresh token (tokens work once). */
  resetSignal?: number;
};

export function Turnstile({ onToken, resetSignal = 0 }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        widget.current = api.render(container.current, {
          sitekey: turnstileSiteKey(),
          appearance: "interaction-only",
          callback: (token) => callback.current(token),
          "expired-callback": () => callback.current(null),
          "error-callback": () => {
            callback.current(null);
            setError("The bot check failed. Reload the page and try again.");
          },
        });
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "The bot check could not load."));
    return () => {
      cancelled = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, []);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    callback.current(null);
    if (widget.current) window.turnstile?.reset(widget.current);
  }, [resetSignal]);

  return (
    <div className="turnstile">
      <div ref={container} />
      {error ? (
        <p className="error-note" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
