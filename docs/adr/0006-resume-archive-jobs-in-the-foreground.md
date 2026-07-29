# Resume archive jobs in the foreground

Cyd Mobile persists import and export checkpoints plus isolated staging artifacts in durable app-managed storage so operating-system termination does not force a restart or partially mutate a local account. Jobs resume when Cyd next runs rather than promising background execution; import validates and prepares outside the live account and performs only its final merge transactionally.
