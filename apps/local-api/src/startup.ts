import { randomBytes } from 'node:crypto';
import { windowsCredentials } from './credentials.ts';
import { geminiClient } from './gemini.ts';
import { localServer } from './http.ts';

export async function start() {
  const id = process.env.JOBFIT_EXTENSION_ID ?? '';
  if (!/^[a-p]{32}$/.test(id)) {
    console.error('Set JOBFIT_EXTENSION_ID to the ID displayed in chrome://extensions.');
    process.exitCode = 1;
    return;
  }
  const credentials = windowsCredentials();
  let token = await credentials.read('pairing');
  if (!token) {
    token = randomBytes(32).toString('hex');
    await credentials.save('pairing', token);
  }
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid saved pairing token.');
  const model = process.env.JOBFIT_GEMINI_MODEL || 'gemini-3.1-flash-lite';
  if (!/^gemini-[a-z0-9.-]{1,75}$/.test(model)) throw new Error('Invalid Gemini model.');
  const server = localServer({ credentials, token, origin: 'chrome-extension://' + id, ai: geminiClient(model) });
  server.on('error', () => {
    console.error('Unable to listen on 127.0.0.1:8787. Check whether the port is in use.');
    process.exitCode = 1;
  });
  server.listen(8787, '127.0.0.1', () => console.log('JobFit AI is listening on http://127.0.0.1:8787.'));
}

export function credentialsError() {
  console.error('Unable to start JobFit AI. Check Windows credential protection and the Gemini model setting.');
  process.exitCode = 1;
}
