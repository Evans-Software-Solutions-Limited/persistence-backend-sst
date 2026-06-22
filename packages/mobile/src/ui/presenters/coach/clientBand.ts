import type { Tone } from "@/ui/components/foundation/tones";
import type { ClientBand } from "@/domain/models/trainerClient";

/**
 * Band → display tone + label map. Mirrors the prototype `ClientRowV2`
 * (design-source/screens/coach.jsx:507-511) exactly: stellar→gold "Stellar",
 * strong→success "Strong", wobbling→gold "Wobbling", atRisk→ember "At risk",
 * crisis→error "Crisis". The backend already classifies the band; the
 * presenter only maps it to a tone + label for the bar + caption.
 */
export const BAND_DISPLAY: Record<ClientBand, { tone: Tone; label: string }> = {
  stellar: { tone: "gold", label: "Stellar" },
  strong: { tone: "success", label: "Strong" },
  wobbling: { tone: "gold", label: "Wobbling" },
  atRisk: { tone: "ember", label: "At risk" },
  crisis: { tone: "error", label: "Crisis" },
};
