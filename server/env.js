/**
 * Loads .env before anything reads process.env.
 *
 * This module must be imported FIRST by any module that reads configuration at
 * load time (llm.js resolves its backend and binary path in its module body).
 * ES modules evaluate imports depth-first in source order, so importing this at
 * the top of llm.js guarantees the file is parsed before that happens — no
 * matter which entry point started the process (server, unit tests, audits).
 *
 * Real environment variables always win: dotenv does not overwrite anything
 * already set, so `ANTHROPIC_API_KEY=… npm start` still beats the file.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(here, '..', '.env');

const result = dotenv.config({ path: envPath, quiet: true });

/** Where config came from, for the boot banner. Never contains a value. */
export const envFileLoaded = !result.error;
export const envFilePath = envPath;
export const envFileKeys = result.parsed ? Object.keys(result.parsed) : [];
