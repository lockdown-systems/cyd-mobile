# Stream and defensively validate archive imports

Cyd Mobile’s version 2 importer reads ZIP entries incrementally into an isolated staging root and validates normalized paths, entry types, counts, declared sizes, digests, expansion, and available storage before commit. An extract-all API is insufficient; mobile may keep its ZIP library only if it exposes these controls, otherwise it uses a narrow replacement or native adapter so traversal, symlinks, forged manifests, and resource-exhaustion archives are rejected safely.
