# Pin versioned archive contract bundles

Cyd Mobile validates archive behavior against immutable, versioned contract-test bundles published from the `cyd` repository, containing the normative specification, canonical fixtures, and expected normalized results. CI pins an explicit bundle for reproducibility and reports newer available bundles; mobile does not depend on a sibling checkout, a moving branch, or shared production runtime code.
