"use client";

import Script from "next/script";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      language: string;
      "response-field": boolean;
      callback(token: string): void;
      "expired-callback"(): void;
      "error-callback"(): boolean;
    },
  ): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export interface TurnstileWidgetHandle {
  reset(): void;
}

interface TurnstileWidgetProps {
  onTokenChange(token: string | null): void;
  onRecoverableError(message: string | null): void;
}

export const TurnstileWidget = forwardRef<TurnstileWidgetHandle, TurnstileWidgetProps>(
  function TurnstileWidget({ onTokenChange, onRecoverableError }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const [configurationMissing, setConfigurationMissing] = useState(false);
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

    const renderWidget = useCallback(() => {
      if (!siteKey) {
        setConfigurationMissing(true);
        onRecoverableError("A verificação humana ainda não está configurada.");
        return;
      }
      const turnstile = window.turnstile;
      if (!turnstile || !containerRef.current || widgetIdRef.current !== null) return;
      try {
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          // Cloudflare''s canonical code for the pt-BR locale is lowercase.
          language: "pt-br",
          "response-field": false,
          callback: (token) => {
            onRecoverableError(null);
            onTokenChange(token);
          },
          "expired-callback": () => {
            onTokenChange(null);
            onRecoverableError("A verificação expirou. Tente novamente.");
          },
          "error-callback": () => {
            onTokenChange(null);
            onRecoverableError("Não foi possível concluir a verificação. Tente novamente.");
            return true;
          },
        });
      } catch {
        onTokenChange(null);
        onRecoverableError("Não foi possível iniciar a verificação. Recarregue a página.");
      }
    }, [onRecoverableError, onTokenChange, siteKey]);

    useImperativeHandle(ref, () => ({
      reset() {
        onTokenChange(null);
        const widgetId = widgetIdRef.current;
        if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId);
      },
    }), [onTokenChange]);

    useEffect(() => {
      renderWidget();
      return () => {
        const widgetId = widgetIdRef.current;
        if (widgetId !== null && window.turnstile) window.turnstile.remove(widgetId);
        widgetIdRef.current = null;
      };
    }, [renderWidget]);

    return (
      <div className="turnstile-block">
        <Script
          id="cloudflare-turnstile"
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onLoad={renderWidget}
        />
        <div ref={containerRef} aria-label="Verificação humana" />
        {configurationMissing ? (
          <p className="field-help error-text" role="status">
            A verificação humana não está configurada neste ambiente.
          </p>
        ) : null}
      </div>
    );
  },
);
