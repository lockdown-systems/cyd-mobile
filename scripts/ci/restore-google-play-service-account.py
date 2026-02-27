#!/usr/bin/env python3

import base64
import os
from pathlib import Path

raw = os.environ["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64"]
data = base64.b64decode(raw)

Path("google-play-service-account.json").write_bytes(data)
