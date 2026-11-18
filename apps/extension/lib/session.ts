import type { CandidateProfile } from '@jobfit/shared-types';

export async function loadProfile() {
  const { profile } = await browser.storage.session.get('profile');
  return profile as CandidateProfile | undefined;
}

export async function saveProfile(profile: CandidateProfile) {
  await browser.storage.session.set({ profile });
}

export async function clearProfile() {
  await browser.storage.session.remove('profile');
}

export async function pairingToken() {
  const { pairing } = await browser.storage.session.get('pairing');
  return typeof pairing === 'string' ? pairing : '';
}

export async function savePairing(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Enter the 64-character pairing token.');
  await browser.storage.session.set({ pairing: token });
}
