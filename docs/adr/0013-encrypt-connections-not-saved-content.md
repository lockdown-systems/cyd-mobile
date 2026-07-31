# Encrypt connections, not saved content

Cyd Mobile does not add application-level encryption for runtime databases, chats, or media in the initial Bluesky version 2 work; saved content relies on the mobile operating system’s app sandbox, access controls, and device encryption. OAuth connection material remains the protected-storage exception, while plaintext Bluesky version 2 export explicitly warns that an archive may contain sensitive saved content; archive encryption requires a future Bluesky format and recovery design.
