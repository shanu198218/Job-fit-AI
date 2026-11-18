import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export interface Credentials {
  read(name: 'pairing' | 'gemini'): Promise<string | undefined>;
  save(name: 'pairing' | 'gemini', value: string): Promise<void>;
  remove(name: 'pairing' | 'gemini'): Promise<void>;
}

const protect = 'ConvertFrom-SecureString (ConvertTo-SecureString $value -AsPlainText -Force)';
const unprotect = `$secret = ConvertTo-SecureString $value
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secret.Dispose() }`;

function powershell(command: string, input: string) {
  return new Promise<string>((resolve, reject) => {
    const root = process.env.SystemRoot;
    if (process.platform !== 'win32' || !root || !isAbsolute(root)) {
      reject(new Error('Windows credential protection is unavailable.'));
      return;
    }
    const shell = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference = 'Stop'; $value = [Console]::In.ReadToEnd(); " + command],
    { windowsHide: true, timeout: 6000, stdio: ['pipe', 'pipe', 'ignore'] });
    const output: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
    child.stdin.on('error', reject);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(Buffer.concat(output).toString('utf8').trim())
      : reject(new Error('Windows credential operation failed.')));
    child.stdin.end(input);
  });
}

export function windowsCredentials(directory?: string): Credentials {
  const local = process.env.LOCALAPPDATA;
  if (process.platform !== 'win32' || !local || !isAbsolute(local)) throw new Error('Windows credential protection is unavailable.');
  const base = directory ?? join(local, 'JobFitAI', 'credentials');
  const file = (name: string) => join(base, name + '.dpapi');
  return {
    async read(name) {
      let encrypted: string;
      try { encrypted = await readFile(file(name), 'utf8'); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
      const value = await powershell(unprotect, encrypted);
      if (!value) throw new Error('Windows credential operation failed.');
      return value;
    },
    async save(name, value) {
      const encrypted = await powershell(protect, value);
      if (!/^[a-f0-9]+$/i.test(encrypted) || encrypted === value) throw new Error('Windows credential operation failed.');
      await mkdir(base, { recursive: true });
      const temporary = join(base, randomBytes(12).toString('hex') + '.tmp');
      try {
        await writeFile(temporary, encrypted, { flag: 'wx' });
        await rename(temporary, file(name));
      } finally {
        await rm(temporary, { force: true });
      }
    },
    async remove(name) { await rm(file(name), { force: true }); },
  };
}

export async function copyPairingToken(rotate: boolean) {
  const credentials = windowsCredentials();
  let token = rotate ? undefined : await credentials.read('pairing');
  if (!token) {
    token = randomBytes(32).toString('hex');
    await credentials.save('pairing', token);
  }
  await powershell('Set-Clipboard -Value $value', token);
}
