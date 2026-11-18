import { credentialsError, start } from './startup.ts';

try { await start(); } catch { credentialsError(); }
