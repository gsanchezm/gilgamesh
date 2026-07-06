import 'reflect-metadata';

// Defense in depth (review S9): no test entrypoint may ever reach the network,
// even on a dev machine exporting ANTHROPIC_API_KEY.
process.env.BRAIN_MODE = process.env.BRAIN_MODE || 'offline';
// Same guard for payments (S13): the mock provider, never stripe.com.
process.env.PAYMENTS_MODE = process.env.PAYMENTS_MODE || 'offline';
