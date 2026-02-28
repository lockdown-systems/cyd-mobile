#!/usr/bin/env python3

import base64
import os
from pathlib import Path

raw = os.environ["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64"]
data = base64.b64decode(raw)

# submit-android.js resolves this path relative to scripts/ci/../
# i.e. <repo>/scripts/google-play-service-account.json
dest = Path(__file__).resolve().parent.parent / "google-play-service-account.json"
dest.write_bytes(data)
