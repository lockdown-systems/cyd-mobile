import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/account/shared-tab-components";
import { withBlueskyController } from "@/controllers";
import { getPortableBlueskySettings } from "@/database/accounts";
import type { BlueskyArchiveExportProgress } from "@/services/archive-export";
import type { AccountTabPalette } from "@/types/account-tabs";

/**
 * The development-only way to write a Cyd Bluesky archive.
 *
 * Mobile builds its version 2 writer before the readers that consume it, so
 * that reader work has real archives to be tested against (ADR 0004). What
 * that ordering must not do is put an export button in front of people before
 * #100 proves an archive Mobile writes can be read back — by Mobile and by
 * Desktop. Hence `__DEV__`: this renders nothing at all in a release build.
 *
 * It is deliberately plain. The shippable export flow — resumable, with its
 * plaintext warning and a share sheet — is #99's, and none of it belongs here
 * yet.
 */

const PHASE_LABELS: Record<BlueskyArchiveExportProgress["phase"], string> = {
  staging: "Pausing account work and copying the database…",
  hashing: "Hashing preserved media…",
  translating: "Translating into the interchange format…",
  packaging: "Packaging the archive…",
  done: "Finished",
};

type ExportState =
  | { status: "idle" }
  | { status: "running"; progress: BlueskyArchiveExportProgress }
  | {
      status: "done";
      location: string;
      byteLength: number;
      completeness: "complete" | "incomplete";
      assets: { available: number; missing: number; unavailable: number };
    }
  | { status: "failed"; message: string };

export type DevArchiveExportCardProps = {
  accountId: number;
  accountUUID: string;
  palette: AccountTabPalette;
};

export function DevArchiveExportCard({
  accountId,
  accountUUID,
  palette,
}: DevArchiveExportCardProps) {
  const [state, setState] = useState<ExportState>({ status: "idle" });

  const exportArchive = useCallback(async () => {
    setState({
      status: "running",
      progress: { phase: "staging", packagedPayloads: 0, totalPayloads: 0 },
    });
    try {
      const portableSettings = await getPortableBlueskySettings(accountId);
      const result = await withBlueskyController(
        accountId,
        accountUUID,
        (controller) =>
          controller.exportBlueskyArchive({
            exportId: `dev-${Date.now()}`,
            portableSettings,
            onProgress: (progress) => setState({ status: "running", progress }),
          }),
      );
      setState({
        status: "done",
        location: result.location,
        byteLength: result.byteLength,
        completeness: result.metadata.completeness,
        assets: result.assets,
      });
    } catch (error) {
      setState({
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [accountId, accountUUID]);

  if (!__DEV__) {
    return null;
  }

  return (
    <View
      style={[
        styles.card,
        { borderColor: palette.icon + "44", backgroundColor: palette.card },
      ]}
    >
      <Text style={[styles.title, { color: palette.text }]}>
        Export a Cyd Bluesky archive (development only)
      </Text>
      <Text style={[styles.body, { color: palette.icon }]}>
        Writes a version 2 archive into export staging. Not available in
        release builds until Bluesky archive import is proven.
      </Text>

      <PrimaryButton
        label={state.status === "running" ? "Exporting…" : "Export archive"}
        palette={palette}
        onPress={exportArchive}
        disabled={state.status === "running"}
      />

      {state.status === "running" ? (
        <View style={styles.status}>
          <ActivityIndicator color={palette.tint} />
          <Text style={[styles.body, { color: palette.icon }]}>
            {PHASE_LABELS[state.progress.phase]}
            {state.progress.totalPayloads > 0
              ? ` (${state.progress.packagedPayloads}/${state.progress.totalPayloads} media)`
              : ""}
          </Text>
        </View>
      ) : null}

      {state.status === "done" ? (
        <View style={styles.status}>
          <Text style={[styles.body, { color: palette.text }]}>
            {`${state.completeness} · ${(state.byteLength / 1024).toFixed(1)} KiB · ` +
              `${state.assets.available} assets packaged, ` +
              `${state.assets.missing + state.assets.unavailable} unavailable`}
          </Text>
          <Text selectable style={[styles.path, { color: palette.icon }]}>
            {state.location}
          </Text>
        </View>
      ) : null}

      {state.status === "failed" ? (
        <Text style={[styles.body, { color: palette.tint }]}>
          {state.message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    borderStyle: "dashed",
    padding: 16,
    gap: 8,
    marginTop: 24,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
  },
  path: {
    fontSize: 11,
    fontFamily: "monospace",
  },
  status: {
    gap: 6,
  },
});
