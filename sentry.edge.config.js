// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever middleware or an Edge route handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs'

const SENTRY_DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN

Sentry.init({
  dsn:
    SENTRY_DSN || 'https://111e1a2e4cc24b2789a3cc7a23e1c74f@o1.ingest.sentry.io/4504811881824256',
  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: 1.0,
})
