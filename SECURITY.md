# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities by opening a GitHub issue with the label "security".

For sensitive issues, you can reach out privately before public disclosure.

You can expect:
- Acknowledgment within 48 hours
- Status update within 7 days
- Coordinated disclosure after fix is available

## Security Considerations

This tool requires API credentials. Never commit credentials to version control:

- Store credentials in environment variables
- Use `.env` files (gitignored) for local development
- Rotate keys if accidentally exposed
