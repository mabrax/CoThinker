# Security policy

## Supported version

Security fixes are applied to the latest `main` branch of this proof of concept.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or leaked credential. Use GitHub's private vulnerability-reporting flow when it is available for this repository. Otherwise, contact the repository owner privately through their GitHub profile with a concise reproduction and impact description.

## Secret handling

- Keep credentials in local environment files such as `.env`; they are ignored by Git.
- Never place API keys in browser code, test fixtures, screenshots, or documentation.
- Run `npm run secrets:check` before a manual release, and install the repository's pre-commit hooks with `pre-commit install`.
- Rotate a credential immediately if it reaches Git history, even if it is later removed.
