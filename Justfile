set shell := ["bash", "-euo", "pipefail", "-c"]

validate:
  npm ci --ignore-scripts
  npm run validate

supabase-version:
  npx --yes supabase@2.116.0 --version
