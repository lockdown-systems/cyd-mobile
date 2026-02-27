#!/usr/bin/env python3

import base64
import os
from pathlib import Path

key_id = os.environ["ASC_API_KEY_ID"]
key_b64 = os.environ["ASC_API_PRIVATE_KEY_BASE64"]
key_data = base64.b64decode(key_b64)

key_dir = Path.home() / ".appstoreconnect" / "private_keys"
key_dir.mkdir(parents=True, exist_ok=True)

key_path = key_dir / f"AuthKey_{key_id}.p8"
key_path.write_bytes(key_data)
