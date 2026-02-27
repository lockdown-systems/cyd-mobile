#!/bin/bash
set -euo pipefail

# Submit the latest .ipa to App Store Connect using xcrun altool.
#
# Prerequisites:
#   1. Create an App Store Connect API key at:
#      https://appstoreconnect.apple.com/access/integrations/api
#   2. Download the .p8 file and place it at:
#      ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8
#   3. Set these environment variables (e.g. in ~/.zshrc or ~/.zprofile):
#      export ASC_API_KEY_ID="your-key-id"
#      export ASC_API_ISSUER_ID="your-issuer-id"
#
# Usage:
#   npm run submit:ios                # submits the latest .ipa in the project
#   npm run submit:ios -- path.ipa    # submits a specific .ipa

# --- Validate environment ---
if [[ -z "${ASC_API_KEY_ID:-}" ]]; then
  echo "Error: ASC_API_KEY_ID environment variable is not set." >&2
  echo "Set it to your App Store Connect API Key ID." >&2
  exit 1
fi

if [[ -z "${ASC_API_ISSUER_ID:-}" ]]; then
  echo "Error: ASC_API_ISSUER_ID environment variable is not set." >&2
  echo "Set it to your App Store Connect Issuer ID." >&2
  exit 1
fi

KEY_FILE="$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_API_KEY_ID}.p8"
if [[ ! -f "$KEY_FILE" ]]; then
  echo "Error: API key file not found at $KEY_FILE" >&2
  echo "Download it from App Store Connect and place it there." >&2
  exit 1
fi

# --- Find the .ipa ---
if [[ -n "${1:-}" ]]; then
  IPA="$1"
else
  # Find the most recently modified .ipa in the project root
  IPA=$(ls -t *.ipa 2>/dev/null | head -1)
  if [[ -z "$IPA" ]]; then
    echo "Error: No .ipa file found in the project directory." >&2
    echo "Run 'npm run build:ios' first, or pass the path as an argument." >&2
    exit 1
  fi
fi

if [[ ! -f "$IPA" ]]; then
  echo "Error: File not found: $IPA" >&2
  exit 1
fi

echo "Uploading $IPA to App Store Connect..."
echo "  API Key: $ASC_API_KEY_ID"
echo ""

xcrun altool --upload-app \
  -f "$IPA" \
  --type ios \
  --apiKey "$ASC_API_KEY_ID" \
  --apiIssuer "$ASC_API_ISSUER_ID"

echo ""
echo "Upload complete!"
