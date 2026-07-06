# Contributing to Stream Vault

Thank you for your interest in contributing to Stream Vault! This document provides guidelines and instructions for contributing.

## Code of Conduct

Be respectful, inclusive, and constructive in all interactions.

## How to Contribute

### Reporting Bugs

Before creating a bug report, check if the issue already exists. When creating a bug report, include:

- **Clear description** of what the bug is
- **Steps to reproduce** the issue
- **Expected behavior** vs actual behavior
- **Screenshots** if applicable
- **Environment details** (OS, Node version, etc.)

### Suggesting Features

Feature suggestions are welcome! Please include:

- **Clear description** of the feature
- **Why** you think it would be useful
- **Possible implementation** approach (optional)
- **Related issues** or discussions

### Pull Requests

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/my-feature`)
3. **Commit** changes with clear messages
4. **Push** to your fork
5. **Create** a Pull Request with description

#### PR Guidelines

- Keep PRs focused on a single feature or fix
- Write clear, descriptive commit messages
- Add comments for complex logic
- Test your changes locally
- Update documentation if needed
- Reference any related issues

## Development Setup

```bash
# Clone your fork
git clone https://github.com/yourusername/stream-vault.git
cd stream-vault

# Install dependencies
npm install

# Create .env from example
cp .env.example .env

# Start development
npm run dev
```

## Code Style

- Use consistent indentation (2 spaces)
- Write meaningful variable and function names
- Add comments for non-obvious logic
- Keep functions small and focused
- Follow existing code patterns

## Commit Messages

Use clear, descriptive commit messages:

```
Add feature X for better performance

- Implement core functionality
- Add error handling
- Write tests
```

## Testing

While we don't have automated tests yet, please:

- Test your changes locally
- Verify no existing features break
- Test on different browsers if frontend changes
- Document test steps in PR

## Questions?

- Open an issue with the `question` label
- Check existing issues for similar questions
- Join our discussions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

Thank you for contributing to Stream Vault! 🎬
