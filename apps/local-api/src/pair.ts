import { copyPairingToken } from './credentials.ts';

try {
  await copyPairingToken(process.argv.includes('--rotate'));
  console.log('Pairing token copied to the Windows clipboard.');
} catch {
  console.error('Unable to copy the pairing token using Windows credential protection.');
  process.exitCode = 1;
}
