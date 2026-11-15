# Contributing to NOVA Agent

Thanks for helping improve NOVA. Small fixes, clear bug reports, documentation, and focused feature proposals are welcome.

## Before opening a pull request

1. Search existing issues and pull requests so related work stays together.
2. For a large change, open an issue first and describe the user problem and proposed behavior.
3. Fork the repository and create a branch from `main` (for example, `fix/session-search`).
4. Keep the change focused and update the README or relevant docs when behavior changes.
5. Open a pull request with a short summary, screenshots for visible UI changes, and steps to reproduce or verify the change.

## Local development

Requirements: Node.js `>=22.12.0` and npm.

```powershell
npm ci
npm start
```

Open `http://localhost:3456`. Use `npm run desktop` to run the Electron window. There is no automated test suite yet; include the manual checks you performed in your pull request.

## Scope and safety

- Do not include API keys, local configuration, session data, workspace contents, or personal information in commits, issues, or screenshots.
- The agent can modify files and run commands. Explain permission or execution changes clearly and keep the existing approval flow intact unless the change explicitly improves it.
- Avoid unrelated formatting or generated files in a functional pull request.
- Use English or Arabic for issues and pull requests; concise repro steps are more useful than a long description.

## Commit and review

Use a descriptive commit subject, such as `Fix provider model discovery`. Before requesting review, verify the changed files and explain any known limitations. Maintainers may request changes or split a broad pull request into smaller pieces.
