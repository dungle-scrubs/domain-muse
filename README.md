# domain-muse

[![CI](https://github.com/dungle-scrubs/domain-muse/actions/workflows/ci.yml/badge.svg)](https://github.com/dungle-scrubs/domain-muse/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

AI-powered domain name generator and availability checker. Give it a concept, get back available domain names.

## Features

- Generate creative domain names from a concept using LLMs
- Check availability via RDAP with WHOIS fallback (free, no credentials required)
- Optional Namecheap integration for pricing information
- Filter by TLD, price, availability, word count, character length
- Sort by price, name, or length
- Rate-limited requests to avoid getting banned
- Automatic retry with backoff on transient failures
- Input validation to prevent injection attacks
- Beautiful CLI output with spinners and tables
- JSON output for agent/script consumption
- Supports Anthropic, OpenAI, and OpenRouter

## Requirements

- Node.js 20+
- `whois` command available (for .io, .co, .me, .tv, .cc, .app)
- One of: Anthropic API key, OpenAI API key, or OpenRouter API key
- (Optional) Namecheap API credentials for pricing info

## Installation

```bash
# Clone and install
git clone https://github.com/dungle-scrubs/domain-muse.git
cd domain-muse
pnpm install
pnpm build

# Or install globally
npm install -g domain-muse
```

## Configuration

Set environment variables:

```bash
# Required - One AI provider
export ANTHROPIC_API_KEY="sk-ant-..."
# OR
export OPENAI_API_KEY="sk-..."
# OR
export OPENROUTER_API_KEY="sk-or-..."

# Optional - Namecheap (for pricing only)
export NAMECHEAP_API_USER="your_username"
export NAMECHEAP_API_KEY="your_api_key"
export NAMECHEAP_CLIENT_IP="your_whitelisted_ip"
export NAMECHEAP_SANDBOX="true"  # Use sandbox API
```

## Usage

### Generate and check domains

```bash
domain-muse search "habit tracking app"
```

With options:

```bash
domain-muse search "habit tracking" \
  --tlds com,io,co \
  --max-words 2 \
  --no-hyphens \
  --no-abbreviations \
  --creativity 0.7 \
  --available-only \
  --sort name
```

### Check specific domains

```bash
domain-muse check habitflow.com trackdaily.io myapp.co
```

### Get TLD pricing (requires Namecheap credentials)

```bash
domain-muse pricing com io co
```

### JSON output

Add `--json` to any command for machine-readable output:

```bash
domain-muse search "habit tracking" --json
domain-muse check example.com --json
```

## CLI Options

### `search <concept>`

| Option | Description | Default |
|--------|-------------|---------|
| `-t, --tlds <tlds>` | Comma-separated TLDs | `com,io,co` |
| `-c, --count <n>` | Number of ideas to generate | `30` |
| `-w, --max-words <n>` | Maximum words per name | `3` |
| `--max-length <n>` | Maximum characters in domain name | - |
| `--hyphens` / `--no-hyphens` | Allow hyphens | `true` |
| `--abbreviations` / `--no-abbreviations` | Allow abbreviations | `true` |
| `--creativity <n>` | LLM temperature (0-1) | `0.9` |
| `--available-only` | Only show available domains | `false` |
| `--no-premium` | Exclude premium domains | `false` |
| `--max-price <n>` | Maximum price filter | - |
| `--sort <by>` | Sort by: price, name, length | `price` |
| `--json` | Output as JSON | `false` |
| `--no-reasoning` | Hide LLM reasoning output | `false` |

## Output Format

Default output shows a formatted table with spinner. Use `--json` for JSON output:

```json
{
  "concept": "habit tracking",
  "reasoning": "Generated names using...",
  "domains": [
    {
      "domain": "trackly.com",
      "baseName": "trackly",
      "tld": "com",
      "wordCount": 1,
      "available": true,
      "isPremium": false,
      "registerPrice": 12.98
    }
  ]
}
```

## Programmatic Usage

```typescript
import { searchDomains, checkDomainsRdap } from "domain-muse";

// Basic availability check (no credentials needed)
const results = await checkDomainsRdap(["example.com", "test.io"]);

// Full search with AI generation
const searchResults = await searchDomains("habit tracking", {
  tlds: ["com", "io", "co"],
  count: 20,
  availableOnly: true,
});
```

## How It Works

1. **Domain Generation**: Uses LLMs to generate creative domain name ideas based on your concept
2. **Availability Check**: Uses RDAP (preferred) with WHOIS fallback - free, no authentication required
3. **Pricing** (optional): If Namecheap credentials are provided, fetches current registration prices

## Supported TLDs

**Via RDAP:**
- `.com`, `.net` (Verisign)
- `.org` (PIR)
- `.info`, `.ai`, `.bio`, `.live`, `.software`, `.studio` (Identity Digital)

**Via WHOIS fallback:**
- `.io`, `.co`, `.me`, `.tv`, `.cc`, `.app`

**Not supported:**
- `.dev` - Google does not provide a public WHOIS or RDAP server

## Known Limitations

- `.dev` domains cannot be checked (no public lookup available)
- Domain availability can change between check and registration
- Namecheap API requires IP whitelisting (impractical for dynamic IPs)
- AI-generated names may occasionally be nonsensical

## License

MIT
