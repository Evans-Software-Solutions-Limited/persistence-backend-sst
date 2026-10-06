import { CameraView, useCameraPermissions } from "expo-camera";
import QRCode from "react-native-qrcode-svg";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { AppState, Share } from "react-native";
import { View } from "@tamagui/core";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import {
  TogetherPartnersPresenter,
  type PartnerRow,
} from "@/ui/presenters/TogetherPartnersPresenter";
import type {
  TogetherSocialApi,
  SocialRelationship,
  TemplateOffer,
} from "@/domain/ports/togetherSocial.port";
import type { CloudResult } from "@/domain/ports/togetherCloud.port";

/** A keyed account boundary removes rendered personal data immediately on account changes. */
export function TogetherPartnersContainer() {
  const { api } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const boundary = useRef(0);
  const active = useRef({ userId, api: api.togetherSocial });
  if (
    active.current.userId !== userId ||
    active.current.api !== api.togetherSocial
  ) {
    active.current = { userId, api: api.togetherSocial };
    boundary.current++;
  }
  const scope = active.current;
  return (
    <PartnersAccount
      key={`${userId ?? "signed-out"}:${boundary.current}`}
      userId={userId}
      api={api.togetherSocial}
      current={() => active.current === scope}
    />
  );
}
function PartnersAccount({
  userId,
  api,
  current,
}: {
  userId: string | null;
  api: TogetherSocialApi | undefined;
  current(): boolean;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [codeVisible, setCodeVisible] = useState(false);
  const [code, setCode] = useState(""),
    [ownCode, setOwnCode] = useState<{
      code: string;
      expiresAt: string;
    } | null>(null),
    [scanning, setScanning] = useState(false);
  const scanGeneration = useRef(0),
    scanned = useRef(false);
  useEffect(() => {
    const generation = scanGeneration;
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        scanGeneration.current++;
        setScanning(false);
      }
    });
    return () => {
      generation.current++;
      listener.remove();
    };
  }, []);
  const mounted = useRef(false),
    lock = useRef(false),
    searchVersion = useRef(0);
  const [tab, setTab] = useState("Partners"),
    [query, setQuery] = useState("");
  const [friends, setFriends] = useState<PartnerRow[]>([]),
    [requests, setRequests] = useState<PartnerRow[]>([]),
    [results, setResults] = useState<PartnerRow[]>([]),
    [offers, setOffers] = useState<TemplateOffer[]>([]);
  const [reporting, setReporting] = useState(false);
  const [selected, setSelected] = useState<PartnerRow | null>(null),
    [selectedOffer, setSelectedOffer] = useState<TemplateOffer | null>(null);
  const [discoverable, setDiscoverable] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const live = () => mounted.current && current();
  const row = (r: SocialRelationship): PartnerRow => ({
    userId: r.userId === userId ? r.friendId : r.userId,
    displayName: r.person?.displayName ?? null,
    avatarUrl: r.person?.avatarUrl ?? null,
    requestId: r.id,
    outgoing: r.initiatedBy === userId,
  });
  async function unwrap<T>(promise: CloudResult<T>): Promise<T> {
    const result = await promise;
    if (!result.ok) throw result.error;
    return result.value;
  }
  async function load() {
    if (!api || !userId || !live() || lock.current) return;
    lock.current = true;
    setLoading(true);
    setError("");
    try {
      // Read complete bounded server pages, never silently presenting the first page as the whole list.
      const pages = async <T,>(
        read: (
          cursor?: string,
        ) => CloudResult<{ data: T[]; nextCursor: string | null }>,
      ) => {
        const values: T[] = [];
        let cursor: string | undefined;
        const seen = new Set<string>();
        do {
          const page = await unwrap(read(cursor));
          if (!live()) return [];
          values.push(...page.data);
          if (page.nextCursor) {
            if (seen.has(page.nextCursor) || seen.size >= 100)
              throw new Error("pagination");
            seen.add(page.nextCursor);
          }
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        return values;
      };
      const [f, r, o, profile] = await Promise.all([
        pages(api.friends.bind(api)),
        pages(api.requests.bind(api)),
        pages(api.offers.bind(api)),
        unwrap(api.getProfile()),
      ]);
      if (!live()) return;
      setFriends(f.map(row));
      setRequests(r.map(row));
      setOffers(o.filter((x) => !x.revoked && x.recipientId === userId));
      setDiscoverable(profile.discoverable);
    } catch {
      if (live())
        setError(
          "Could not refresh training partners. Connect to the internet and try again.",
        );
    } finally {
      if (live()) {
        lock.current = false;
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    const version = searchVersion;
    void load();
    return () => {
      mounted.current = false;
      version.current++;
    };
  }, [api, userId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function mutate(
    action: string,
    run: (key: string) => CloudResult<unknown>,
    success: string,
    accept?: (value: unknown) => void,
  ) {
    if (!api || !userId || !live() || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const storageKey = `together.social.retry.v1:${userId}:${action}`;
    try {
      let key = await AsyncStorage.getItem(storageKey);
      if (!live()) return;
      if (!key) {
        key = randomUUID();
        await AsyncStorage.setItem(storageKey, key);
      }
      if (!live()) return;
      const result = await unwrap(run(key));
      // Remove only our account's completed command. Ambiguous failures retain its key for retry.
      await AsyncStorage.removeItem(storageKey);
      if (!live()) return;
      accept?.(result);
      setNotice(success);
      setSelected(null);
      setSelectedOffer(null);
      setResults([]);
      lock.current = false;
      await load();
    } catch {
      if (live())
        setError(
          "Could not confirm that change. Connect and retry the same action to check safely.",
        );
    } finally {
      if (live()) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  async function search() {
    if (!api || !userId || !live() || lock.current || query.trim().length < 2)
      return;
    const version = ++searchVersion.current;
    const term = query.trim();
    lock.current = true;
    setBusy(true);
    setError("");
    setResults([]);
    try {
      const result = await unwrap(api.people(term));
      if (live() && version === searchVersion.current) {
        setResults(result.data.filter((p) => p.userId !== userId));
        setNotice(
          result.data.length ? "" : "No findable people match this name.",
        );
        if (result.nextCursor)
          setNotice(
            "Showing the first matches. Refine the name to find your partner.",
          );
      }
    } catch {
      if (live() && version === searchVersion.current)
        setError(
          "Search is unavailable. Connect to the internet and try again.",
        );
    } finally {
      if (live()) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  async function resolveCode(value = code) {
    if (!api || !userId || !live() || lock.current) return;
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_-]{32}$/.test(normalized)) {
      setError("That is not a partner code.");
      return;
    }
    const version = ++searchVersion.current;
    lock.current = true;
    setBusy(true);
    setError("");
    setResults([]);
    try {
      const person = await unwrap(api.resolvePersonCode(normalized));
      if (live() && version === searchVersion.current)
        setResults([{ ...person, personCode: normalized }]);
    } catch {
      if (live() && version === searchVersion.current)
        setError(
          "This code is unavailable or expired. Ask your partner for a new code.",
        );
    } finally {
      if (live()) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  async function scan() {
    if (!live() || !api || !userId) return;
    const generation = ++scanGeneration.current;
    try {
      const result = permission?.granted
        ? permission
        : await requestPermission();
      if (!live() || generation !== scanGeneration.current) return;
      if (!result.granted) {
        setError(
          "Camera permission is unavailable. Paste the partner code instead.",
        );
        return;
      }
      scanned.current = false;
      setScanning(true);
    } catch {
      if (live())
        setError("Camera is unavailable. Paste the partner code instead.");
    }
  }
  const available = !!api && !!userId;
  return (
    <TogetherPartnersPresenter
      codeVisible={codeVisible}
      onCloseCode={() => setCodeVisible(false)}
      onShowCode={() => {
        setCodeVisible(true);
        if (!ownCode)
          void mutate(
            "person-code",
            (key) => api!.personCode(key),
            "Your code is ready.",
            (value) => setOwnCode(value as { code: string; expiresAt: string }),
          );
      }}
      code={code}
      ownCode={ownCode}
      onCode={(value) => {
        setCode(value);
        searchVersion.current++;
        setResults([]);
      }}
      onResolve={() => void resolveCode()}
      onNewCode={() =>
        void mutate(
          "person-code",
          (key) => api!.personCode(key),
          "Your new code is ready. Previous codes no longer work.",
          (value) => setOwnCode(value as { code: string; expiresAt: string }),
        )
      }
      onCopyCode={() => {
        if (ownCode && live())
          void Clipboard.setStringAsync(ownCode.code).catch(() => {
            if (live()) setError("Could not copy the code.");
          });
      }}
      onShareCode={() => {
        if (ownCode && live())
          void Share.share({ message: ownCode.code }).catch(() => {
            if (live()) setError("Could not share the code. Copy it instead.");
          });
      }}
      onScan={() => void scan()}
      qr={
        ownCode ? (
          <View
            padding={10}
            backgroundColor="white"
            alignSelf="center"
            borderRadius={14}
          >
            <QRCode value={ownCode.code} size={152} />
          </View>
        ) : undefined
      }
      scanner={
        scanning ? (
          <CameraView
            testID="partner-code-camera"
            style={{ height: 220 }}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => {
              if (scanned.current || !live()) return;
              scanned.current = true;
              setScanning(false);
              setCode(data);
              void resolveCode(data);
            }}
          />
        ) : undefined
      }
      tab={tab}
      query={query}
      busy={busy || loading}
      loading={loading}
      available={available}
      error={
        !userId
          ? "Sign in to manage training partners."
          : !api
            ? "Training partners are unavailable in this app version."
            : error
      }
      notice={notice}
      friends={friends}
      requests={requests}
      results={results}
      offers={offers}
      reporting={reporting}
      onReporting={setReporting}
      selected={selected}
      selectedOffer={selectedOffer}
      discoverable={discoverable}
      onTab={(value) => {
        scanGeneration.current++;
        setScanning(false);
        setTab(value);
        searchVersion.current++;
        setResults([]);
        setNotice("");
      }}
      onQuery={(value) => {
        setQuery(value);
        searchVersion.current++;
        setResults([]);
        setNotice("");
      }}
      onSearch={() => void search()}
      onRefresh={() => void load()}
      onBack={() => router.back()}
      onSelect={(value) => {
        setReporting(false);
        setSelected(value);
      }}
      onRequest={(id) =>
        void mutate(
          `request:${id}`,
          (key) =>
            api!.request(
              key,
              id,
              results.find((p) => p.userId === id)?.personCode,
            ),
          "Training partner invitation sent.",
        )
      }
      onDecide={(id, decision) =>
        void mutate(
          `decide:${id}:${decision}`,
          (key) => api!.decide(key, id, decision),
          decision === "accept"
            ? "Training partner accepted."
            : "Invitation declined.",
        )
      }
      onRemove={(id) =>
        void mutate(
          `remove:${id}`,
          (key) => api!.remove(key, id),
          "Training partner removed.",
        )
      }
      onBlock={(id) =>
        void mutate(
          `block:${id}`,
          (key) => api!.block(key, id, true),
          "Account blocked.",
        )
      }
      onReport={(id, reason) =>
        void mutate(
          `report:${id}:${reason}`,
          (key) =>
            api!.report(key, {
              subjectUserId: id,
              context: "together",
              reason,
            }),
          "Report sent privately to the Persistence team.",
        )
      }
      onDiscoverable={(value) =>
        void mutate(
          `profile:${value}`,
          (key) => api!.profile(key, value),
          value
            ? "People can find you by name."
            : "You are hidden from name search.",
        )
      }
      onOffer={setSelectedOffer}
      onCopy={(id) => {
        if (
          offers.some((o) => o.id === id && !o.revoked) &&
          selectedOffer?.id === id
        )
          void mutate(
            `copy:${id}`,
            (key) => api!.copy(key, id),
            "Independent workout copy saved.",
          );
      }}
    />
  );
}
