# Windows setup

## Install and load the extension

Run from the repository root in PowerShell. Use Node.js 22.13 or later in the Node 22 line, or a newer supported release. Use the `.cmd` shims if PowerShell blocks npm or pnpm scripts.

```powershell
node --version
npm.cmd install --global pnpm@12.18.0
pnpm.cmd install --frozen-lockfile
pnpm.cmd build:extension
(Resolve-Path '.\apps\extension\.output\chrome-mv3').Path
```

Open `chrome://extensions`, enable **Developer mode**, and select **Load unpacked**. Pick the directory printed above. Pin JobFit AI to the toolbar and copy its extension ID. With source changes, rebuild and click **Reload** on the extension card. For hot reload, run `pnpm.cmd dev:extension`, load `apps/extension/.output/chrome-mv3-dev` as a separate unpacked extension, and use its ID for the API.

## Start and pair the backend

In a PowerShell window, set the ID for the loaded extension and start the API.

```powershell
$env:JOBFIT_EXTENSION_ID = '<32-character ID from chrome://extensions>'
pnpm.cmd dev:api
```

The backend listens on `http://127.0.0.1:8787`. The default model is `gemini-3.1-flash-lite`. To override it, set `$env:JOBFIT_GEMINI_MODEL` to a supported Gemini model before starting the API. Google publishes current [model availability](https://ai.google.dev/gemini-api/docs/models) and [free-tier pricing](https://ai.google.dev/gemini-api/docs/pricing). Quotas and availability depend on your project and region.

For a compiled backend, run `pnpm.cmd build:api`, set the same variables, and run `pnpm.cmd --filter @jobfit/local-api start`.

In a second PowerShell window, run `pnpm.cmd pair`. The command copies the token to the Windows clipboard. In the popup, open **AI Settings**, paste the pairing token, and select **Pair extension**. Clear the clipboard afterward with `Set-Clipboard -Value ' '`. If Windows clipboard history is enabled, remove the token from history as well. Repeat pairing after Chrome restarts or the extension reloads.

To rotate the pairing token, stop the backend with Ctrl+C, run `pnpm.cmd pair --rotate`, restart the backend, and pair again. The backend reads its pairing credential at startup.

## Local API routes

| Route | Purpose |
| --- | --- |
| `GET /health` | Loopback readiness. |
| `POST /analyze` | Validate consent, candidate profile, and vacancy, then return the scored report. |
| `GET /settings/ai/status` | Check whether a key is saved. |
| `PUT /settings/ai/key` | Save or replace the key. |
| `POST /settings/ai/test` | Check the key and model together using a generic prompt. |
| `DELETE /settings/ai/key` | Remove the key. |

Every route except health requires the pairing bearer token. Analysis and key updates accept JSON. Errors contain a short code that the popup translates into a status or message.

## Configure Gemini and analyze

1. Create a Gemini Developer API key in [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Open **AI Settings**, enter the key, and select **Save or replace key**. Select **Test connection**. The saved key is never displayed.
3. Upload a PDF or DOCX in the popup. In **Candidate details**, review recognized skills and enter your country, work authorization countries, and relevant years if known.
4. Open the vacancy, click JobFit AI on the toolbar, then choose **Analyze Current Job**. For unsupported pages, paste the text in the manual input.
5. To use Gemini, check the consent box before analyzing. The report displays the analysis mode. You can analyze another vacancy in the same Chrome session using the existing profile.
6. To replace a revoked or invalid key, enter a new one in Settings and test again. **Remove key** deletes the saved credential. With Gemini unavailable, analysis falls back to local scoring.

## Storage and privacy

The CV file is read in the extension. Chrome keeps selected profile fields and pairing in trusted `chrome.storage.session`. Clear CV removes the current profile and report. Reports stay in the popup state. Closing the popup discards the report, and restarting Chrome or reloading the extension clears the session profile and pairing.

After consent, the backend sends Gemini the vacancy text, title, location, work mode, and employment type, plus recognized skills, years, and selected CV evidence. Review the vacancy before sharing it. The CV extractor filters common contact details, and free-form evidence may still contain identifying information. The backend keeps candidate residence and authorization countries local for deterministic eligibility. Browser session cleanup has no effect on data already transmitted to Google. Review [Gemini API terms and data handling](https://ai.google.dev/gemini-api/terms), particularly when using the free tier.

Pairing and Gemini credentials are stored as DPAPI-encrypted blobs under `%LOCALAPPDATA%\JobFitAI\credentials`. The backend retrieves the key on demand and keeps no long-lived plaintext key cache. DPAPI protects the files under the Windows user profile. Software running as that user may be able to recover the credentials. The API is designed for personal use on Windows loopback. Its browser origin check supplements bearer-token authorization.

## Scoring and limitations

- Required skills carry weight 60, preferred skills 15, and experience 25. Skills earn the fraction evidenced in the CV. Experience uses the ratio of evidenced or user-entered years to the stated minimum, capped at 100%.
- The engine renormalizes weights over dimensions with enough information. A dimension with no supported comparison displays **Unknown**. A listed skill gap means the skill lacked matching evidence in the extracted profile. Transferable skills are shown separately with candidate evidence.
- Education is reported qualitatively with the vacancy requirement and available degree evidence. Eligibility is independent of the match percentage. Explicit geographic exclusions can result in **Not Eligible**. Ambiguous location, authorization, or sponsorship remains unresolved.
- Local analysis uses a finite skill alias catalog, explicit requirement language, and conservative location rules. Review the cited evidence and confirm conditions with the employer. Image-only PDFs require OCR before upload. Extraction covers visible page content and available structured data. Use manual input for restricted or unsupported pages.

## Verify

```powershell
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd test
pnpm.cmd build:api
pnpm.cmd build:extension
pnpm.cmd exec playwright install chromium --no-shell
pnpm.cmd test:browser
```

Run the DPAPI test from a normal Windows session with your user profile loaded. The browser suite uses an isolated profile and a mock localhost API on port 8787, so stop the real backend before running it. To use an existing Chrome for Testing binary, set `$env:JOBFIT_TEST_CHROME` to its executable path before running the browser test. Use a Chromium build that supports the `Extensions.triggerAction` DevTools command. Automated tests use synthetic data and make no live Gemini requests.

For manual acceptance, pair, save a real key, test Gemini, and analyze a vacancy with consent. Analyze a second vacancy without re-uploading. Close and reopen the popup to check the profile, then exit Chrome completely and reopen it to check that the profile is cleared. Restart Windows, start the backend with the same user and extension ID, and pair again. Confirm that Settings still shows **Configured**. Replace the key, test it, then remove it or stop the backend and confirm that analysis falls back to **Local Basic Analysis**.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Backend Offline | Run the local API and check `Invoke-RestMethod http://127.0.0.1:8787/health`. Check whether another process is using port 8787. |
| Unpaired | Confirm the extension ID for the current build/profile, restart the backend if it changed, and paste a fresh copy of the token. |
| Windows credential storage unavailable | Run under the original interactive Windows user profile. A restricted process or a different Windows profile may be unable to decrypt saved credentials. |
| Invalid Key or Quota Exceeded | Replace a revoked or mistyped key. Check project limits in AI Studio and try later for quota errors. |
| Unable to read this vacancy | Click the toolbar extension from the vacancy tab. Use manual input on restricted pages or when the vacancy content has yet to load. |
| PDF or DOCX has no readable text | Try a text-based export. The extension accepts files up to 8 MB and PDFs up to 30 pages. |
