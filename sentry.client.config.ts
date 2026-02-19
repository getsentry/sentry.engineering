import * as Sentry from "@sentry/astro";

if (import.meta.env.PROD && import.meta.env.PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.PUBLIC_SENTRY_DSN,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 1.0,
  });
}
