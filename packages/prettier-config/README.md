# @repo/prettier-config

Shared Prettier configuration for the monorepo.

## Usage

Install in your app or package:

```json
{
  "devDependencies": {
    "@repo/prettier-config": "*",
    "prettier": "^3.6.0"
  },
  "prettier": "@repo/prettier-config"
}
```

## Configuration

- Uses `prettier-plugin-tailwindcss` for automatic Tailwind CSS class sorting
- Print width: 120 characters
