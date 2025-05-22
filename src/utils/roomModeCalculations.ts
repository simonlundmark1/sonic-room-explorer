/* Room acoustics calculation utilities */
export const SPEED_OF_SOUND = 343; // m/s
export const DEFAULT_Q_FACTOR = 10; // Typical Q for room modes, could be a parameter
const FREQUENCY_MIN_HZ = 20;
const FREQUENCY_MAX_HZ = 300;
const FREQUENCY_STEP_HZ = 1;

export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface RoomDimensions {
  L: number; // Length
  W: number; // Width
  H: number; // Height
}

export interface ModeResponse {
  freq: number;
  db: number; // Changed from gain to db
  // mode: string; // Mode is no longer per data point with summed response
}

/**
 * Calculate pressure at a point for a given mode (standing wave pattern)
 */
export function calculateModePressure(
  n: number, 
  m: number, 
  l: number, 
  pos: Point, 
  dim: RoomDimensions
): number {
  const { x, y, z } = pos;
  const { L, W, H } = dim;
  
  // Add a small epsilon to prevent division by zero or issues at boundaries if dimensions are part of x,y,z.
  // This also helps avoid Math.cos(N*PI) issues if x,y,z can be L,W,H exactly.
  const Lx = L === 0 ? 1e-6 : L;
  const Wy = W === 0 ? 1e-6 : W;
  const Hz = H === 0 ? 1e-6 : H;

  // Use (Lx - x) for the x-coordinate calculation to invert this axis
  const effectiveX = Lx - x;

  return (
    Math.cos((n * Math.PI * effectiveX) / Lx) * // Changed x to effectiveX
    Math.cos((m * Math.PI * y) / Wy) * 
    Math.cos((l * Math.PI * z) / Hz)
  );
}

/**
 * Simulate summed room acoustic response including phase interactions.
 */
export function simulateRoomResponse(
  subPos: Point, 
  listenerPos: Point, 
  L: number, 
  W: number, 
  H: number, 
  maxModeOrder = 10, // Max order for n, m, l
  baseQFactor = DEFAULT_Q_FACTOR,
  spectralTilt_dB_per_Octave: number = -3 // New parameter, default to current behavior
): ModeResponse[] {
  const intermediateResponse: Array<{ freq: number; magnitude: number }> = []; // Store magnitude before dB conversion
  let maxOverallMagnitude = 0;

  for (let f = FREQUENCY_MIN_HZ; f <= FREQUENCY_MAX_HZ; f += FREQUENCY_STEP_HZ) {
    let totalReal = 0;
    let totalImag = 0;

    for (let n = 0; n <= maxModeOrder; n++) {
      for (let m = 0; m <= maxModeOrder; m++) {
        for (let l = 0; l <= maxModeOrder; l++) {
          if (n === 0 && m === 0 && l === 0 && !(L === 0 && W === 0 && H === 0) ) {
            // For non-zero room dimensions, the (0,0,0) mode is DC / constant pressure, often handled differently or omitted in AC response.
            // If we wanted to include it for some reason (e.g. pressurization gain), it would need special handling.
            // For typical modal frequency response, we skip it unless it is the *only* possible mode (e.g. 0-dim room).
            continue;
          }
          if (L === 0 && n !== 0) continue; // No x-modes if L=0
          if (W === 0 && m !== 0) continue; // No y-modes if W=0
          if (H === 0 && l !== 0) continue; // No z-modes if H=0

          const termL = (L === 0) ? 0 : (n / L);
          const termW = (W === 0) ? 0 : (m / W);
          const termH = (H === 0) ? 0 : (l / H);

          const fMode = (SPEED_OF_SOUND / 2) * Math.sqrt(
            termL ** 2 + termW ** 2 + termH ** 2
          );

          if (fMode === 0 && f > 0) continue; // Skip 0Hz mode for AC response if not f=0
          if (fMode > FREQUENCY_MAX_HZ * 1.5 && fMode > 0) { 
            // Optimization: if mode an octave above max freq, its contribution is likely small at f.
            // This factor (1.5) can be tuned. For high Q, it might need to be larger.
            // Let's be more conservative with this optimization if Q can be high for LF
            // if (n > 2 && m > 2 && l > 2) continue; 
            // Re-evaluating optimization: given high maxModeOrder, it's still useful.
            // The original condition `if (n > 2 && m > 2 && l > 2)` might be too restrictive.
            // Let's adjust it to skip if *any* index is high, to prune faster.
            // if (n > 5 || m > 5 || l > 5) continue; // Example of a more aggressive pruning
            // For now, let's stick to the original optimization logic for higher order modes,
            // but be mindful of its impact with varying Q.
             if (n > 3 && m > 3 && l > 3) continue; // A slightly less aggressive pruning than original
          } 

          // Calculate pressure terms for coupling
          const subPressureTerm = calculateModePressure(n, m, l, subPos, { L, W, H });
          const listenerPressureTerm = calculateModePressure(n, m, l, listenerPos, { L, W, H });
          const coupling = subPressureTerm * listenerPressureTerm;

          if (Math.abs(coupling) < 1e-9) continue; // Negligible coupling

          // Use the provided baseQFactor, but apply a multiplier for low frequencies.
          let qMultiplier = 1.0;
          if (fMode > 0 && fMode < 80) { // Modes below 80 Hz
            qMultiplier = 2.0;
          } else if (fMode >= 80 && fMode < 150) { // Modes between 80 Hz and 150 Hz
            qMultiplier = 1.5;
          }
          const effectiveQ = Math.max(1, baseQFactor * qMultiplier);

          let modeAmplitudeResponse = 0;
          let modePhaseResponse = 0;

          if (fMode === 0 && f === 0) { // DC or 0Hz mode response
            modeAmplitudeResponse = 1;
            modePhaseResponse = 0;
          } else if (fMode > 0) {
            const fRatio = f / fMode;
            const denominatorTerm = (fRatio / effectiveQ); // Use frequency-dependent Q
            modeAmplitudeResponse = 1 / Math.sqrt( (1 - fRatio**2)**2 + denominatorTerm**2 );
            // Corrected phase: phase of 1 / ( (1-fRatio^2) + j*denominatorTerm )
            modePhaseResponse = Math.atan2(-denominatorTerm, (1 - fRatio**2) ); 
          } else {
            continue; // Should not happen if fMode=0 and f > 0 is caught
          }
          
          const effectiveMagnitude = coupling * modeAmplitudeResponse;
          totalReal += effectiveMagnitude * Math.cos(modePhaseResponse);
          totalImag += effectiveMagnitude * Math.sin(modePhaseResponse);
        }
      }
    }
    const currentMagnitude = Math.sqrt(totalReal**2 + totalImag**2);
    
    // Apply frequency weighting 1/sqrt(f) for a more natural roll-off
    let weightedMagnitude = currentMagnitude;
    // Apply spectral tilt
    if (spectralTilt_dB_per_Octave !== 0 && f > 0 && FREQUENCY_MIN_HZ > 0) {
      // Calculate octaves from the reference frequency (FREQUENCY_MIN_HZ)
      // If f is FREQUENCY_MIN_HZ, log2(1) = 0, so no tilt at the reference frequency itself.
      const octaves_from_ref = Math.log2(f / FREQUENCY_MIN_HZ);
      const dB_adjustment = spectralTilt_dB_per_Octave * octaves_from_ref;
      const linear_multiplier = Math.pow(10, dB_adjustment / 20);
      weightedMagnitude *= linear_multiplier;
    } else if (f > 0 && spectralTilt_dB_per_Octave === 0) {
      // This branch is essentially "no tilt", weightedMagnitude remains currentMagnitude
      // No operation needed if tilt is zero.
    } else if (f === 0 && currentMagnitude > 0) {
      // Handle DC component if necessary, though current loop starts at 20Hz.
      // For now, no specific tilt for DC.
      // However, the loop starts at FREQUENCY_MIN_HZ = 20Hz, so f will not be 0.
      // This else-if is more for conceptual robustness if the loop range changes.
      // For now, it won't be hit with current FREQUENCY_MIN_HZ.
      // Assigning currentMagnitude or a scaled version might be one approach.
      // For a typical AC response, f=0 is often handled separately or has negligible magnitude.
    }
    // The original 1/sqrt(f) weighting is now replaced by the spectralTilt_dB_per_Octave logic.

    intermediateResponse.push({ freq: f, magnitude: weightedMagnitude });
    if (weightedMagnitude > maxOverallMagnitude) {
      maxOverallMagnitude = weightedMagnitude;
    }
  }

  const finalResponse: ModeResponse[] = [];
  // Convert to dB, normalizing so that maxOverallMagnitude is 0 dB.
  // Handle cases where maxOverallMagnitude might be 0 or very small.
  const MIN_DB_VALUE = -100; // Or some other suitable minimum dB value

  for (const point of intermediateResponse) {
    let dbValue: number;
    // Removed normalization to maxOverallMagnitude.
    // Calculate dB directly from point.magnitude (which is weightedMagnitude).
    // A magnitude of 1.0 will result in 0 dB.
    if (point.magnitude <= 1e-9) { // Use a small threshold to avoid log(0)
      dbValue = MIN_DB_VALUE;
    } else {
      dbValue = 20 * Math.log10(point.magnitude);
    }
    // Ensure db is not below MIN_DB_VALUE (e.g. if magnitude was extremely small)
    finalResponse.push({ freq: point.freq, db: Math.max(MIN_DB_VALUE, dbValue) });
  }
  return finalResponse;
}

/**
 * Ensure position is within room boundaries
 */
export function clampToRoom(point: Point, room: RoomDimensions): Point {
  return {
    x: Math.min(Math.max(0, point.x), room.L),
    y: Math.min(Math.max(0, point.y), room.W),
    z: Math.min(Math.max(0, point.z), room.H)
  };
}

// Updated Harman target curve function in dB
export const getHarmanTargetDB = (freq: number): number => {
  if (freq <= 20) return 7;    // +7dB at 20Hz
  // Slope from 20Hz (+7dB) to 60Hz (+4dB)
  if (freq < 60) return 7 - ((freq - 20) / (60 - 20)) * 3; 
  // Slope from 60Hz (+4dB) to 200Hz (0dB)
  if (freq < 200) return 4 - ((freq - 60) / (200 - 60)) * 4;
  // Slope from 200Hz (0dB) to 300Hz (-1dB) - Adjusted for new max frequency
  if (freq <= 300) return 0 - ((freq - 200) / (300 - 200)) * 1;
  
  return -1; // Default for frequencies outside the 20-300Hz explicit definition
};

/* ---------- Speaker data types ---------- */
export interface SpeakerMetadataVendorSpecs {
  dispersion_horizontal_deg?: number;
  dispersion_vertical_deg?: number;
  sensitivity_db_1m?: number;
  max_spl_continuous_db?: number;
  max_spl_peak_db?: number;
  size_mm?: { width?: number; height?: number; depth?: number };
  weight_kg?: number;
  lf_driver_mm?: number;
  hf_driver_mm?: number;
  hf_driver_type?: string;
  crossover_hz?: number;
  crossover_type?: string;
  power_config?: string;
  hf_power_amp_w?: number;
  lf_power_amp_w?: number;
  frequency_response_plus_minus_3db_hz?: [number, number];
  frequency_range_minus_10db_hz?: [number, number];
  low_frequency_extension_minus_10db_hz?: number;
  input_sensitivity_neg10dbv_input_db_1m?: number;
  max_peak_input_level_neg10dbv_dbv?: number;
  max_peak_input_level_plus4dbu_dbu?: number;
  system_distortion_criteria?: string;
  electrical_distortion_criteria?: string;
  signal_to_noise_ratio_dba?: number;
  hf_trim_control_db?: number[];
  boundary_eq_lf_shelf_50hz_db?: number[];
}

export interface SpeakerMetadata {
  name: string;
  source?: string;
  description?: string;
  price_usd_pair?: number;
  lf_cutoff_minus_3db_hz?: number;
  lf_cutoff_minus_6db_hz?: number;
  reference_level_info?: string;
  frequency_deviation_db?: number;
  frequency_deviation_range_hz?: [number, number];
  horizontal_directivity_plus_minus_6db?: { angle_range_deg?: [number, number]; freq_range_khz?: [number, number] };
  vertical_directivity_plus_minus_6db?: { angle_range_deg?: [number, number]; freq_range_khz?: [number, number] };
  tonality_preference_score?: number;
  tonality_preference_score_with_ideal_sub?: number;
  tonality_preference_score_with_eq?: number;
  tonality_preference_score_with_eq_and_ideal_sub?: number;
  vendor_specs?: SpeakerMetadataVendorSpecs;
}

export interface SpeakerData {
  metadata: SpeakerMetadata;
  freqs: number[]; /* Hz, ascending */
  responses: { // Changed from number[][][]
    [curveName: string]: number[]; // e.g., "OnAxis", "ListeningWindow"
  };
}

/* ---------- Math helpers for speaker directivity ---------- */
export function dBToLinear(db: number): number {
  return 10 ** (db / 20);
}

export function interpolate(x: number, x1: number, x2: number, y1: number, y2: number): number {
  // Handle cases where x1 and x2 are the same to avoid division by zero
  if (x1 === x2) {
    return y1; // Or (y1 + y2) / 2, or based on which side x is, but typically implies a flat line
  }
  const t = (x - x1) / (x2 - x1);
  return y1 + t * (y2 - y1);
}

export function findBracket(arr: number[], value: number): readonly [number, number] {
  if (arr.length === 0) {
    console.warn("findBracket called with empty array");
    return [0, 0] as const;
  }
  if (arr.length === 1 || value <= arr[0]) {
    return [0, 0] as const;
  }
  if (value >= arr[arr.length - 1]) {
    return [arr.length - 1, arr.length - 1] as const;
  }

  // Linear scan for the bracket
  for (let i = 0; i < arr.length - 1; i++) {
    if (value >= arr[i] && value < arr[i + 1]) {
      return [i, i + 1] as const;
    }
  }
  // Should be unreachable due to boundary checks, but as a robust fallback:
  // This case implies value is somehow greater than or equal to the last element,
  // which should have been caught by `value >= arr[arr.length - 1]`.
  // However, to satisfy the type system and ensure a return, we can return the last valid bracket.
  return [arr.length - 2, arr.length - 1] as const; 
}

export function speakerGainLinear(speaker: SpeakerData | null, freq: number): number { // Removed angleH, angleV
  if (!speaker || !speaker.responses || !speaker.responses.ListeningWindow || speaker.responses.ListeningWindow.length === 0) {
    return 1; /* fallback flat (0 dB gain) if data is missing or ListeningWindow curve is not present */
  }
  const { freqs, responses } = speaker;
  const listeningWindowCurve = responses.ListeningWindow;

  if (freqs.length !== listeningWindowCurve.length) {
    console.warn("Speaker data freqs and ListeningWindow lengths differ.");
    return 1; // Fallback
  }
  if (freqs.length === 0) {
    return 1; // No data
  }

  const [loF, hiF] = findBracket(freqs, freq);

  // Get dB values at the bracket frequencies
  const dbAtLoF = listeningWindowCurve[loF];
  const dbAtHiF = listeningWindowCurve[hiF];
  
  // Interpolate the dB value for the given frequency
  const interpolatedDb = interpolate(freq, freqs[loF], freqs[hiF], dbAtLoF, dbAtHiF);
  
  return dBToLinear(interpolatedDb);
}
