# JobFit AI

A personal Chrome extension that compares job vacancies with your CV. It parses PDF and DOCX files in Chrome, keeps a minimal profile for the browser session, and scores job matches locally. With your consent, a localhost Node API can ask Google Gemini to interpret requirements and suggest evidence-based CV improvements.

- **Extension** · WXT, Manifest V3, React, TypeScript, and Tailwind CSS.
- **Local API** · Node.js, Zod, Google GenAI SDK, and Windows DPAPI for credentials.
- **Shared engines** · Deterministic scoring and conservative eligibility assessment.

Follow the [Windows setup guide](docs/local-setup.md) for installation, pairing, scoring rules, privacy, and verification.

## Windows daily use

After setup, double-click [`Start-JobFit-AI.bat`](Start-JobFit-AI.bat) and wait for the Local API to be ready. Double-click [`Pair-JobFit-AI.bat`](Pair-JobFit-AI.bat) when AI Settings reports **Unpaired**; pairing is not needed every time the API starts. Keep the API console open while using JobFit AI. See the [Windows setup guide](docs/local-setup.md#daily-pairing-workflow) for extension ID configuration and the pairing steps.
