import 'reflect-metadata';

// Defense in depth (review S9): no test entrypoint may ever reach the network,
// even on a dev machine exporting ANTHROPIC_API_KEY.
process.env.BRAIN_MODE = process.env.BRAIN_MODE || 'offline';
