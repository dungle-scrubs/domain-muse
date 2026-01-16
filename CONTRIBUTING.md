# Contributing

## Development Setup

```bash
git clone https://github.com/dungle-scrubs/domain-muse.git
cd domain-muse
pnpm install
```

## Making Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run linter (`pnpm lint`)
5. Run type check (`pnpm typecheck`)
6. Build (`pnpm build`)
7. Commit your changes (`git commit -m 'Add amazing feature'`)
8. Push to the branch (`git push origin feature/amazing-feature`)
9. Open a Pull Request

## Code Style

- TypeScript with strict mode
- Biome for linting and formatting
- Run `pnpm lint:fix` before committing

## Pre-commit Hooks

Husky runs `pnpm lint && pnpm typecheck` on pre-commit. If these fail, fix the issues before committing.
