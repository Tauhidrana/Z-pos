import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
// Type-only, and therefore erased at build time: the library itself still
// arrives through the dynamic import below, so naming the hint type here does
// not drag ZXing into the main bundle.
import type { DecodeHintType as ZXingHint } from "@zxing/library";

type CameraScannerProps = {
  /** Fired once per accepted decode, already de-duplicated. */
  onDecode: (code: string, format: string) => void;
  /** Pause decoding without tearing the camera down (e.g. while a scan awaits approval). */
  paused?: boolean;
  /** What the paused overlay tells the operator to do to resume. */
  pausedMessage?: string;
  className?: string;
};

/**
 * Every symbology a shop actually meets at the counter.
 *
 * Naming them is not a restriction, it is what makes the reader fast enough to
 * be one. Left unhinted, ZXing runs three 2D decoders (Data Matrix, Aztec,
 * PDF417) ahead of the 1D ones on every frame — formats no retail label uses —
 * and the 1D pass that matters gets whatever budget is left. Listing the retail
 * formats cuts the readers down to QR plus the 1D set.
 */
const RETAIL_FORMATS = [
  "EAN_13",
  "EAN_8",
  "UPC_A",
  "UPC_E",
  "CODE_128",
  "CODE_39",
  "CODE_93",
  "ITF",
  "CODABAR",
  "QR_CODE",
] as const;

/**
 * Milliseconds between decode attempts.
 *
 * ZXing defaults to 500 ms — two frames a second. That is a large part of why
 * anything other than the crisp labels we print ourselves feels like it "does
 * not scan": a hand-held phone holds a curved carton in focus for a moment, and
 * two chances inside that moment is not many. At 100 ms it gets ten.
 */
const SCAN_INTERVAL_MS = 100;

/**
 * Live camera barcode scanner.
 *
 * ZXing is loaded on demand: it is a ~300 kB decoder that only matters once
 * someone actually opens the scanner, so importing it at module scope would
 * put it on the Sales page's critical path for every visitor.
 *
 * A real scanning session fires the same code many times a second. Emitting
 * each one would add a line per frame, so decodes are gated on a short cooldown
 * and on the code actually changing.
 */
export function CameraScanner({
  onDecode,
  paused = false,
  pausedMessage = "Paused — approve or discard the scan",
  className,
}: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  // Read inside the decode callback, which is created once per camera start and
  // would otherwise close over the values from that first render forever.
  const onDecodeRef = useRef(onDecode);
  const pausedRef = useRef(paused);
  useEffect(() => {
    onDecodeRef.current = onDecode;
  }, [onDecode]);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setActive(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setStarting(true);
    try {
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] =
        await Promise.all([import("@zxing/browser"), import("@zxing/library")]);

      const hints = new Map<ZXingHint, unknown>();
      hints.set(
        DecodeHintType.POSSIBLE_FORMATS,
        RETAIL_FORMATS.map((name) => BarcodeFormat[name]),
      );
      // Also reads the row backwards, which is how a carton held upside down
      // still resolves instead of quietly failing.
      hints.set(DecodeHintType.TRY_HARDER, true);

      const reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: SCAN_INTERVAL_MS,
        delayBetweenScanSuccess: 400,
      });

      const controls = await reader.decodeFromVideoDevice(
        undefined, // let the browser pick; it prefers the rear camera on phones
        videoRef.current ?? undefined,
        (result) => {
          if (!result || pausedRef.current) return;
          const code = result.getText().trim();
          if (!code) return;

          // Same code within the cooldown is the same physical label still in
          // frame, not a second item.
          const now = Date.now();
          if (code === lastRef.current.code && now - lastRef.current.at < 1500) return;
          lastRef.current = { code, at: now };

          onDecodeRef.current(code, BarcodeFormat[result.getBarcodeFormat()] ?? "");
        },
      );

      controlsRef.current = controls;
      setActive(true);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setError(
        name === "NotAllowedError"
          ? "Camera access was blocked. Allow it in your browser's site settings, then try again."
          : name === "NotFoundError"
            ? "No camera found on this device. Use the barcode box below instead."
            : "Could not start the camera. Use the barcode box below instead.",
      );
    } finally {
      setStarting(false);
    }
  }, []);

  // Releasing the camera on unmount matters: the browser keeps the capture
  // indicator lit and holds the device until the track is stopped.
  useEffect(() => stop, [stop]);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative aspect-video w-full overflow-hidden rounded-lg border bg-muted">
        <video
          ref={videoRef}
          className={cn("h-full w-full object-cover", !active && "invisible")}
          muted
          playsInline
        />

        {!active && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
            <Camera className="h-8 w-8 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              Point the camera at a barcode to add it to the sale. Any retail
              barcode reads &mdash; the shop&rsquo;s own labels and the
              manufacturer&rsquo;s alike.
            </p>
          </div>
        )}

        {active && (
          <>
            {/* Aiming guide — a barcode reads best filling the box horizontally. */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-1/3 w-4/5 rounded-lg border-2 border-primary/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
            {paused && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                <span className="rounded-md bg-background px-3 py-1.5 text-xs font-medium shadow">
                  {pausedMessage}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex gap-2">
        {active ? (
          <Button type="button" variant="outline" size="sm" onClick={stop} className="flex-1">
            <CameraOff className="mr-2 h-4 w-4" />
            Stop camera
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={start}
            disabled={starting}
            className="flex-1"
          >
            {starting ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Camera className="mr-2 h-4 w-4" />
            )}
            {starting ? "Starting…" : error ? "Retry camera" : "Start camera"}
          </Button>
        )}
      </div>
    </div>
  );
}
