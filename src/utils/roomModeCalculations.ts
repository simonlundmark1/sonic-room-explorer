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

// Memoization cache for simulateRoomResponse
const responseCache = new Map<string, ModeResponse[]>();
const CACHE_SIZE_LIMIT = 50; // Limit cache size to prevent memory issues

/**
 * Generate cache key for memoization
 */
function generateCacheKey(
  subPos: Point, 
  listenerPos: Point, 
  L: number, 
  W: number, 
  H: number, 
  maxModeOrder: number,
  baseQFactor: number
): string {
  return JSON.stringify({
    sub: { x: Math.round(subPos.x * 1000) / 1000, y: Math.round(subPos.y * 1000) / 1000, z: Math.round(subPos.z * 1000) / 1000 },
    listener: { x: Math.round(listenerPos.x * 1000) / 1000, y: Math.round(listenerPos.y * 1000) / 1000, z: Math.round(listenerPos.z * 1000) / 1000 },
    room: { L: Math.round(L * 1000) / 1000, W: Math.round(W * 1000) / 1000, H: Math.round(H * 1000) / 1000 },
    maxModeOrder,
    baseQFactor: Math.round(baseQFactor * 100) / 100
  });
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
 * Now with memoization for performance optimization.
 */
export function simulateRoomResponse(
  subPos: Point, 
  listenerPos: Point, 
  L: number, 
  W: number, 
  H: number, 
  maxModeOrder = 10, // Max order for n, m, l
  baseQFactor = DEFAULT_Q_FACTOR
): ModeResponse[] {
  // Generate cache key
  const cacheKey = generateCacheKey(subPos, listenerPos, L, W, H, maxModeOrder, baseQFactor);
  
  // Check cache first
  if (responseCache.has(cacheKey)) {
    console.log('🚀 Cache HIT - returning cached response (performance boost!)');
    return responseCache.get(cacheKey)!;
  }
  
  console.log('⚡ Cache MISS - calculating new response...');
  const startTime = performance.now();
  
  // If cache is getting too large, clear oldest entries
  if (responseCache.size >= CACHE_SIZE_LIMIT) {
    const keysToDelete = Array.from(responseCache.keys()).slice(0, Math.floor(CACHE_SIZE_LIMIT / 2));
    keysToDelete.forEach(key => responseCache.delete(key));
    console.log(`🧹 Cache cleanup: removed ${keysToDelete.length} old entries`);
  }

  // Calculate response (original logic)
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
          const q = Math.max(1, baseQFactor * qMultiplier);

          let modeAmplitudeResponse = 0;
          let modePhaseResponse = 0;

          if (fMode === 0 && f === 0) { // DC or 0Hz mode response
            modeAmplitudeResponse = 1;
            modePhaseResponse = 0;
          } else if (fMode > 0) {
            const fRatio = f / fMode;
            const denominatorTerm = (fRatio / q); // Use frequency-dependent Q
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
    const weightedMagnitude = currentMagnitude;
    // No spectral tilt applied - use magnitude as-is

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
  
  const endTime = performance.now();
  console.log(`✅ Response calculation completed in ${(endTime - startTime).toFixed(1)}ms`);
  
  // Cache the result
  responseCache.set(cacheKey, finalResponse);
  console.log(`💾 Response cached (cache size: ${responseCache.size}/${CACHE_SIZE_LIMIT})`);
  
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

/**
 * Calculate the Schroeder frequency for a room
 * The Schroeder frequency is the transition point between modal and statistical behavior
 * Formula: f_s = 2000 * sqrt(RT60 / V)
 * Where RT60 is reverberation time and V is room volume
 * 
 * For simplicity, we estimate RT60 based on room volume and absorption
 * Typical RT60 for residential rooms: 0.3-0.6 seconds
 */
export function calculateSchroederFrequency(
  room: RoomDimensions,
  averageAbsorption: number = 0.15 // Default absorption coefficient
): number {
  const { L, W, H } = room;
  const volume = L * W * H; // Room volume in m³
  
  if (volume <= 0) return 0;
  
  // Estimate RT60 using Sabine's formula: RT60 = 0.161 * V / A
  // Where A is total absorption area = α * S (α = absorption coefficient, S = surface area)
  const surfaceArea = 2 * (L * W + L * H + W * H);
  const totalAbsorption = Math.max(0.01, averageAbsorption) * surfaceArea;
  const rt60 = 0.161 * volume / totalAbsorption;
  
  // Clamp RT60 to reasonable values for rooms
  const clampedRT60 = Math.max(0.2, Math.min(1.5, rt60));
  
  // Calculate Schroeder frequency
  const schroederFreq = 2000 * Math.sqrt(clampedRT60 / volume);
  
  return Math.round(schroederFreq * 10) / 10; // Round to 1 decimal place
}

// Updated Harman target curve function in dB with optional bass rolloff
export const getHarmanTargetDB = (
  freq: number, 
  bassRolloffFreq?: number, 
  bassRolloffSlope?: number
): number => {
  let baseDb: number;
  
  if (freq <= 20) baseDb = 7;    // +7dB at 20Hz
  // Slope from 20Hz (+7dB) to 60Hz (+4dB)
  else if (freq < 60) baseDb = 7 - ((freq - 20) / (60 - 20)) * 3; 
  // Slope from 60Hz (+4dB) to 200Hz (0dB)
  else if (freq < 200) baseDb = 4 - ((freq - 60) / (200 - 60)) * 4;
  // Slope from 200Hz (0dB) to 300Hz (-1dB) - Adjusted for new max frequency
  else if (freq <= 300) baseDb = 0 - ((freq - 200) / (300 - 200)) * 1;
  else baseDb = -1; // Default for frequencies outside the 20-300Hz explicit definition
  
  // Apply bass rolloff if specified
  if (bassRolloffFreq && bassRolloffSlope && freq < bassRolloffFreq) {
    const octavesBelow = Math.log2(bassRolloffFreq / Math.max(freq, 1)); // Avoid log(0)
    const rolloffDb = -octavesBelow * bassRolloffSlope;
    baseDb += rolloffDb;
  }
  
  return baseDb;
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

/* ---------- EQ Generation System ---------- */

export interface EQBand {
  frequency: number; // Center frequency in Hz
  gain: number;      // Gain in dB (positive = boost, negative = cut)
  q: number;         // Q factor (bandwidth)
  type: 'peak' | 'highpass' | 'lowpass' | 'shelf'; // Filter type
}

export interface EQSettings {
  bands: EQBand[];
  enabled: boolean;
  maxBoost: number;   // Maximum boost allowed in dB
  maxCut: number;     // Maximum cut allowed in dB
  smoothing: number;  // Smoothing factor (0-1)
}

export interface EQResponse {
  freq: number;
  db: number;
}

export interface DetectedPeak {
  frequency: number;
  amplitude: number;
  prominence: number;
  width: number;
  type: 'mode' | 'resonance' | 'dip';
}

/**
 * Detect peaks and dips in the room response for targeted correction
 * ENHANCED: Much more aggressive detection with lower thresholds
 */
export function detectResponseFeatures(
  roomResponse: ModeResponse[],
  schroederFreq: number
): DetectedPeak[] {
  const features: DetectedPeak[] = [];
  const smoothingWindow = 3; // Increased from 2 back to 3 for more smoothing
  
  // Smooth the response slightly to avoid noise-induced false peaks
  const smoothedResponse = roomResponse.map((point, i) => {
    const start = Math.max(0, i - smoothingWindow);
    const end = Math.min(roomResponse.length - 1, i + smoothingWindow);
    const sum = roomResponse.slice(start, end + 1).reduce((acc, p) => acc + p.db, 0);
    return {
      freq: point.freq,
      db: sum / (end - start + 1)
    };
  });

  // Find peaks and dips with MORE CONSERVATIVE detection to avoid over-detection
  for (let i = 3; i < smoothedResponse.length - 3; i++) { // Increased from 2 to 3 for wider analysis window
    const current = smoothedResponse[i];
    const prev3 = smoothedResponse[i - 3];
    const prev2 = smoothedResponse[i - 2];
    const prev1 = smoothedResponse[i - 1];
    const next1 = smoothedResponse[i + 1];
    const next2 = smoothedResponse[i + 2];
    const next3 = smoothedResponse[i + 3];
    
    // Check for peak (local maximum) - more conservative
    if (current.db > prev3.db && current.db > prev2.db && current.db > prev1.db && 
        current.db > next1.db && current.db > next2.db && current.db > next3.db) {
      
      // Calculate prominence (how much it stands out)
      const localMin = Math.min(prev3.db, prev2.db, prev1.db, next1.db, next2.db, next3.db);
      const prominence = current.db - localMin;
      
      // LESS aggressive thresholds - only catch significant peaks
      const minProminence = current.freq < schroederFreq ? 1.0 : 0.8; // Increased from 0.3/0.2
      if (prominence > minProminence) {
        // Estimate peak width
        const width = estimatePeakWidth(smoothedResponse, i);
        
        features.push({
          frequency: current.freq,
          amplitude: current.db,
          prominence,
          width,
          type: current.freq < schroederFreq ? 'mode' : 'resonance'
        });
      }
    }
    
    // Check for dip (local minimum) - more conservative
    if (current.db < prev3.db && current.db < prev2.db && current.db < prev1.db && 
        current.db < next1.db && current.db < next2.db && current.db < next3.db) {
      
      const localMax = Math.max(prev3.db, prev2.db, prev1.db, next1.db, next2.db, next3.db);
      const prominence = localMax - current.db;
      
      // LESS aggressive thresholds for dips too
      const minProminence = current.freq < schroederFreq ? 1.5 : 1.0; // Increased from 0.5/0.3
      if (prominence > minProminence) {
        const width = estimatePeakWidth(smoothedResponse, i);
        
        features.push({
          frequency: current.freq,
          amplitude: current.db,
          prominence,
          width,
          type: 'dip'
        });
      }
    }
  }
  
  return features.sort((a, b) => b.prominence - a.prominence); // Sort by prominence
}

/**
 * Interpolate frequency for a target dB level between two points.
 */
function interpolateFrequencyForDbLevel(
  targetDb: number,
  freq1: number,
  db1: number,
  freq2: number,
  db2: number
): number {
  if (db1 === db2) {
    // If DB values are the same, it's a flat line.
    // If targetDb is also the same, any freq between freq1 and freq2 is valid.
    // We'll return freq2 as it's the point that "crossed" or matched.
    // If targetDb is different, interpolation is not meaningful in the standard sense here.
    return freq2;
  }
  // Linear interpolation for x (frequency) given y (targetDb):
  // x = x1 + (x2 - x1) * (y - y1) / (y2 - y1)
  const interpolatedFreq = freq1 + (freq2 - freq1) * (targetDb - db1) / (db2 - db1);

  // Ensure interpolated frequency is within the bounds of freq1 and freq2
  const minFreq = Math.min(freq1, freq2);
  const maxFreq = Math.max(freq1, freq2);
  return Math.max(minFreq, Math.min(maxFreq, interpolatedFreq));
}

/**
 * Estimate the width of a peak or dip for Q calculation
 * UPDATED: Uses interpolation for more accurate -3dB point finding.
 */
function estimatePeakWidth(response: ModeResponse[], centerIndex: number): number {
  if (centerIndex < 0 || centerIndex >= response.length) {
    return 0; // Should not happen if called correctly
  }
  const centerDb = response[centerIndex].db;
  const centerFreq = response[centerIndex].freq;
  
  // Determine if it's a positive peak (otherwise assume dip or flat)
  const isPositivePeak = 
    centerIndex > 0 && centerIndex < response.length - 1 &&
    response[centerIndex].db > response[centerIndex - 1].db && 
    response[centerIndex].db > response[centerIndex + 1].db;
  
  const targetLevel = isPositivePeak ? centerDb - 3 : centerDb + 3;
  
  let leftFreq = centerFreq;
  let foundLeft = false;

  // Search left
  for (let i = centerIndex - 1; i >= 0; i--) {
    const currentPoint = response[i];
    const prevPoint = response[i + 1]; // Point closer to the center

    if ((isPositivePeak && currentPoint.db <= targetLevel) ||
        (!isPositivePeak && currentPoint.db >= targetLevel)) {
      // currentPoint crossed the targetLevel. Interpolate between currentPoint and prevPoint.
      if (prevPoint.db !== currentPoint.db) { // Avoid division by zero if levels are identical
         // Check if targetLevel is actually between prevPoint.db and currentPoint.db
        if ((isPositivePeak && prevPoint.db > targetLevel && currentPoint.db <= targetLevel) ||
            (!isPositivePeak && prevPoint.db < targetLevel && currentPoint.db >= targetLevel)) {
             leftFreq = interpolateFrequencyForDbLevel(targetLevel, prevPoint.freq, prevPoint.db, currentPoint.freq, currentPoint.db);
        } else {
            // Target level not strictly between, use current point's frequency
            leftFreq = currentPoint.freq;
        }
      } else {
        leftFreq = currentPoint.freq; // Levels are same, use current point
      }
      foundLeft = true;
      break;
    }
    if (i === 0 && !foundLeft) {
      // Reached beginning, and target not crossed, so peak is wider than data on this side
      leftFreq = currentPoint.freq; 
      foundLeft = true; // Consider it "found" at the edge
    }
  }
  if (!foundLeft && response.length > 0) { 
      // If loop didn't run (e.g. centerIndex is 0), or somehow didn't set
      leftFreq = response[0].freq;
  }


  let rightFreq = centerFreq;
  let foundRight = false;

  // Search right
  for (let i = centerIndex + 1; i < response.length; i++) {
    const currentPoint = response[i];
    const prevPoint = response[i - 1]; // Point closer to the center

    if ((isPositivePeak && currentPoint.db <= targetLevel) ||
        (!isPositivePeak && currentPoint.db >= targetLevel)) {
      // currentPoint crossed the targetLevel. Interpolate between currentPoint and prevPoint.
      if (prevPoint.db !== currentPoint.db) { // Avoid division by zero
        // Check if targetLevel is actually between prevPoint.db and currentPoint.db
        if ((isPositivePeak && prevPoint.db > targetLevel && currentPoint.db <= targetLevel) ||
            (!isPositivePeak && prevPoint.db < targetLevel && currentPoint.db >= targetLevel)) {
            rightFreq = interpolateFrequencyForDbLevel(targetLevel, prevPoint.freq, prevPoint.db, currentPoint.freq, currentPoint.db);
        } else {
            rightFreq = currentPoint.freq;
        }
      } else {
        rightFreq = currentPoint.freq;
      }
      foundRight = true;
      break;
    }
     if (i === response.length - 1 && !foundRight) {
      // Reached end, and target not crossed
      rightFreq = currentPoint.freq;
      foundRight = true; // Consider it "found" at the edge
    }
  }
   if (!foundRight && response.length > 0) {
      rightFreq = response[response.length -1].freq;
  }

  const width = rightFreq - leftFreq;
  return width > 0 ? width : 0; // Ensure width is not negative (e.g. if centerFreq was an edge)
}

/**
 * Generate optimal EQ bands using iterative approach (4-pass like professional systems)
 * Pass 1: Broad corrections for major peaks/dips (30% of bands)
 * Pass 2: Targeted refinement corrections (30% of bands) 
 * Pass 3: Fine polishing corrections (25% of bands)
 * Pass 4: Ultra-fine detail corrections (15% of bands)
 * Each pass includes 250ms delay to simulate real measurement cycles
 * UPDATED: Much more aggressive and sensitive correction with 4th pass
 */
export function generateOptimalEQ(
  roomResponseWithTilt: ModeResponse[], // This has spectral tilt applied
  targetResponse: ModeResponse[],
  options: {
    numBands?: number;
    maxBoost?: number;
    maxCut?: number;
    smoothing?: number;
    minQ?: number;
    maxQ?: number;
    schroederFreq?: number;
    subPos?: Point;
    listenerPos?: Point;
    roomDimensions?: { L: number; W: number; H: number };
    baseQFactor?: number;
  } = {}
): Promise<EQSettings> {
  const {
    numBands = 20,
    maxBoost = 12.0,
    maxCut = 18.0,
    smoothing = 0.02, // MUCH more aggressive (was 0.05)
    minQ = 0.7,
    maxQ = 10.0,
    schroederFreq = 200,
    subPos,
    listenerPos,
    roomDimensions,
    baseQFactor = DEFAULT_Q_FACTOR
  } = options;

  if (!roomResponseWithTilt.length || !targetResponse.length) {
    return Promise.resolve({
      bands: [],
      enabled: false,
      maxBoost,
      maxCut,
      smoothing
    });
  }

  console.log(`🎯 Starting ULTRA-AGGRESSIVE 4-PASS EQ generation (max ${numBands} bands)`);
  console.log(`🎚️ Target: PRECISION match to Harman curve with maximum sensitivity`);
  
  // Use the same response that target alignment used (roomResponseWithTilt)
  const analysisResponse = roomResponseWithTilt;

  return new Promise((resolve) => {
    const executeIterativePasses = async () => {
      // PASS 1: Aggressive broad corrections (30% of bands)
      const pass1MaxBands = Math.ceil(numBands * 0.3); // Reduced from 0.4
      console.log(`\n🔄 === PASS 1: AGGRESSIVE Major Corrections (${pass1MaxBands} bands) ===`);
      const pass1Bands = generateEQPass(
        analysisResponse,
        targetResponse,
        {
          maxBands: pass1MaxBands,
          passType: 'broad',
          maxBoost: maxBoost * 0.95,  // MUCH more aggressive (was 0.85)
          maxCut: maxCut * 0.95,      // MUCH more aggressive (was 0.85)
          minQ: minQ,
          maxQ: Math.min(maxQ, 6.0),
          smoothing: smoothing * 0.8, // LESS smoothing for more precision (was 1.2)
          schroederFreq
        }
      );

      console.log(`✅ Pass 1 complete: ${pass1Bands.length} bands generated`);

      // Simulate response after Pass 1
      const pass1EQSettings: EQSettings = {
        bands: pass1Bands,
        enabled: true,
      maxBoost,
      maxCut,
      smoothing
    };
      
      const responseAfterPass1 = applyEQToResponse(analysisResponse, pass1EQSettings);
      
      // POST-EQ ANALYSIS: Much more aggressive detection and correction
      const newProblems = analyzePostEQProblems(responseAfterPass1, targetResponse, pass1Bands, schroederFreq);
      if (newProblems.length > 0) {
        console.log(`⚠️ POST-EQ ANALYSIS: Found ${newProblems.length} new problems created by boosting:`);
        newProblems.forEach(problem => {
          console.log(`  🔴 ${problem.frequency.toFixed(1)}Hz: ${problem.type} (${problem.severity.toFixed(1)}dB above target)`);
        });
        
        // Add corrective bands to Pass 1 - MORE aggressive correction
        const correctiveBands = generateCorrectiveBands(newProblems, pass1MaxBands - pass1Bands.length);
        pass1Bands.push(...correctiveBands);
        console.log(`🔧 Added ${correctiveBands.length} corrective bands to Pass 1`);
      }
      
      // Analysis and 250ms delay
      const errorBeforePass1 = analyzeTargetError(analysisResponse, targetResponse);
      const errorAfterPass1 = analyzeTargetError(responseAfterPass1, targetResponse);
      console.log(`📊 Pass 1 Results:`);
      console.log(`  RMS Error: ${errorBeforePass1.rmsError.toFixed(2)}dB → ${errorAfterPass1.rmsError.toFixed(2)}dB (${(errorAfterPass1.rmsError - errorBeforePass1.rmsError).toFixed(2)}dB)`);
      console.log(`  Max Error: ${errorBeforePass1.maxError.toFixed(2)}dB → ${errorAfterPass1.maxError.toFixed(2)}dB`);
      console.log(`⏱️ Visual update delay: 250ms...`);
      
      // 250ms delay for visual feedback (was 50ms)
      await new Promise(resolveDelay => setTimeout(resolveDelay, 250));

      // PASS 2: ULTRA-targeted refinement (30% of bands)
      const pass2MaxBands = Math.ceil(numBands * 0.3); // Reduced from 0.4
      const remainingAfterPass1 = numBands - pass1Bands.length;
      const pass2ActualBands = Math.min(pass2MaxBands, remainingAfterPass1);
      
      console.log(`\n🔄 === PASS 2: ULTRA-Targeted Refinement (${pass2ActualBands} bands) ===`);
      console.log(`🎯 Analyzing CORRECTED response after Pass 1 with MAXIMUM sensitivity`);
      
      const pass2Bands = generateEQPass(
        responseAfterPass1, // Analyze corrected response
        targetResponse,
        {
          maxBands: pass2ActualBands,
          passType: 'targeted',
          maxBoost: maxBoost * 0.9,   // Much more aggressive (was 0.75)
          maxCut: maxCut * 0.9,       // Much more aggressive (was 0.75)
          minQ: minQ * 1.05,          // Slightly higher Q (was 1.1)
          maxQ: maxQ,
          smoothing: smoothing * 0.7, // Much less smoothing (was 1.0)
          schroederFreq,
          usedFrequencies: new Set(pass1Bands.map(b => b.frequency))
        }
      );

      console.log(`✅ Pass 2 complete: ${pass2Bands.length} bands generated`);

      // Simulate response after Pass 2
      const pass2EQSettings: EQSettings = {
        bands: [...pass1Bands, ...pass2Bands],
        enabled: true,
        maxBoost,
        maxCut,
        smoothing
      };
      
      const responseAfterPass2 = applyEQToResponse(analysisResponse, pass2EQSettings);
      const errorAfterPass2 = analyzeTargetError(responseAfterPass2, targetResponse);
      
      console.log(`📊 Pass 2 Results:`);
      console.log(`  RMS Error after P1: ${errorAfterPass1.rmsError.toFixed(2)}dB → ${errorAfterPass2.rmsError.toFixed(2)}dB (${(errorAfterPass2.rmsError - errorAfterPass1.rmsError).toFixed(2)}dB)`);
      console.log(`⏱️ Visual update delay: 250ms...`);
      
      // 250ms delay for visual feedback (was 50ms)
      await new Promise(resolveDelay => setTimeout(resolveDelay, 250));

      // PASS 3: PRECISION polishing (25% of bands)
      const pass3MaxBands = Math.ceil(numBands * 0.25); // Increased from previous "remaining" 
      const remainingAfterPass2 = numBands - pass1Bands.length - pass2Bands.length;
      const pass3ActualBands = Math.min(pass3MaxBands, remainingAfterPass2);
      
      if (pass3ActualBands > 0) {
        console.log(`\n🔄 === PASS 3: PRECISION Polishing (${pass3ActualBands} bands) ===`);
        console.log(`✨ High precision refinement toward Harman target`);
        
        const pass3Bands = generateEQPass(
          responseAfterPass2, // Analyze twice-corrected response
          targetResponse,
          {
            maxBands: pass3ActualBands,
            passType: 'polishing',
            maxBoost: maxBoost * 0.8,   // More aggressive (was 0.6)
            maxCut: maxCut * 0.8,       // More aggressive (was 0.6)
            minQ: minQ * 1.2,           // Higher Q (was 1.3)
            maxQ: maxQ,
            smoothing: smoothing * 0.4, // Much less smoothing (was 0.6)
            schroederFreq,
            usedFrequencies: new Set([...pass1Bands, ...pass2Bands].map(b => b.frequency))
          }
        );

        console.log(`✅ Pass 3 complete: ${pass3Bands.length} bands generated`);

        // Simulate response after Pass 3
        const pass3EQSettings: EQSettings = {
          bands: [...pass1Bands, ...pass2Bands, ...pass3Bands],
          enabled: true,
          maxBoost,
          maxCut,
          smoothing
        };
        
        const responseAfterPass3 = applyEQToResponse(analysisResponse, pass3EQSettings);
        const errorAfterPass3 = analyzeTargetError(responseAfterPass3, targetResponse);
        
        console.log(`📊 Pass 3 Results:`);
        console.log(`  RMS Error after P2: ${errorAfterPass2.rmsError.toFixed(2)}dB → ${errorAfterPass3.rmsError.toFixed(2)}dB (${(errorAfterPass3.rmsError - errorAfterPass2.rmsError).toFixed(2)}dB)`);
        console.log(`⏱️ Visual update delay: 250ms...`);
        
        // 250ms delay for visual feedback
        await new Promise(resolveDelay => setTimeout(resolveDelay, 250));

        // PASS 4: ULTRA-FINE detail corrections (remaining bands, ~15%)
        const remainingAfterPass3 = numBands - pass1Bands.length - pass2Bands.length - pass3Bands.length;
        
        if (remainingAfterPass3 > 0) {
          console.log(`\n🔄 === PASS 4: ULTRA-FINE Detail Corrections (${remainingAfterPass3} bands) ===`);
          console.log(`🔬 MAXIMUM precision final detail correction for perfect target matching`);
          
          const pass4Bands = generateEQPass(
            responseAfterPass3, // Analyze thrice-corrected response
            targetResponse,
            {
              maxBands: remainingAfterPass3,
              passType: 'ultra-fine', // New pass type
              maxBoost: maxBoost * 0.7,   // Conservative for final details
              maxCut: maxCut * 0.7,       // Conservative for final details  
              minQ: minQ * 1.4,           // Very high Q for surgical precision
              maxQ: maxQ,
              smoothing: smoothing * 0.2, // Minimal smoothing for maximum precision
              schroederFreq,
              usedFrequencies: new Set([...pass1Bands, ...pass2Bands, ...pass3Bands].map(b => b.frequency))
            }
          );

          console.log(`✅ Pass 4 complete: ${pass4Bands.length} bands generated`);

          // Final analysis
          const allBands = [...pass1Bands, ...pass2Bands, ...pass3Bands, ...pass4Bands];
          
          if (pass4Bands.length > 0) {
            const finalEQSettings: EQSettings = {
              bands: allBands,
              enabled: true,
              maxBoost,
              maxCut,
              smoothing
            };
            
            const finalCorrectedResponse = applyEQToResponse(analysisResponse, finalEQSettings);
            const finalError = analyzeTargetError(finalCorrectedResponse, targetResponse);
            
            console.log(`📊 Pass 4 Results:`);
            console.log(`  RMS Error after P3: ${errorAfterPass3.rmsError.toFixed(2)}dB → ${finalError.rmsError.toFixed(2)}dB (${(finalError.rmsError - errorAfterPass3.rmsError).toFixed(2)}dB)`);
            console.log(`  🎯 TOTAL IMPROVEMENT: ${errorBeforePass1.rmsError.toFixed(2)}dB → ${finalError.rmsError.toFixed(2)}dB (${(finalError.rmsError - errorBeforePass1.rmsError).toFixed(2)}dB)`);
          }

          console.log(`\n🎛️ ULTRA-AGGRESSIVE 4-PASS EQ COMPLETE:`);
          console.log(`  Total bands: ${allBands.length}/${numBands}`);
          console.log(`  Pass 1 (aggressive): ${pass1Bands.length} bands`);
          console.log(`  Pass 2 (ultra-targeted): ${pass2Bands.length} bands`);
          console.log(`  Pass 3 (precision): ${pass3Bands.length} bands`);
          console.log(`  Pass 4 (ultra-fine): ${pass4Bands.length} bands`);
          console.log(`  🎯 Target matching: MAXIMUM precision grade with 4-pass refinement`);

          resolve({
            bands: allBands.sort((a, b) => a.frequency - b.frequency),
            enabled: true,
            maxBoost,
            maxCut,
            smoothing
          });
        } else {
          // No bands left for Pass 4
          const allBands = [...pass1Bands, ...pass2Bands, ...pass3Bands];
          console.log(`\n⚠️ Pass 4 skipped: All ${numBands} bands used in first 3 passes`);
          console.log(`🎛️ ULTRA-AGGRESSIVE 3-PASS EQ COMPLETE: ${allBands.length}/${numBands} bands`);
          
          resolve({
            bands: allBands.sort((a, b) => a.frequency - b.frequency),
            enabled: true,
            maxBoost,
            maxCut,
            smoothing
          });
        }
      } else {
        // No bands left for Pass 3
        const allBands = [...pass1Bands, ...pass2Bands];
        console.log(`\n⚠️ Pass 3 & 4 skipped: All ${numBands} bands used in first 2 passes`);
        console.log(`🎛️ ULTRA-AGGRESSIVE 2-PASS EQ COMPLETE: ${allBands.length}/${numBands} bands`);
        
        resolve({
          bands: allBands.sort((a, b) => a.frequency - b.frequency),
          enabled: true,
          maxBoost,
          maxCut,
          smoothing
        });
      }
    };

    executeIterativePasses().catch(error => {
      console.error('Error in iterative EQ passes:', error);
      resolve({
        bands: [],
        enabled: false,
        maxBoost,
        maxCut,
        smoothing
      });
    });
  });
}

/**
 * Generate EQ bands for a single pass (broad, targeted, polishing, or ultra-fine)
 */
function generateEQPass(
  currentResponse: ModeResponse[],
  targetResponse: ModeResponse[],
  options: {
    maxBands: number;
    passType: 'broad' | 'targeted' | 'polishing' | 'ultra-fine';
    maxBoost: number;
    maxCut: number;
    minQ: number;
    maxQ: number;
    smoothing: number;
    schroederFreq: number;
    usedFrequencies?: Set<number>;
  }
): EQBand[] {
  const { maxBands, passType, maxBoost, maxCut, minQ, maxQ, smoothing, schroederFreq, usedFrequencies = new Set() } = options;
  
  console.log(`  🎚️ ${passType.toUpperCase()} pass: max ${maxBands} bands, Q range ${minQ.toFixed(1)}-${maxQ.toFixed(1)}`);

  // Analyze errors between current and target
  const errorAnalysis = analyzeTargetError(currentResponse, targetResponse);
  console.log(`  📊 Error analysis: RMS=${errorAnalysis.rmsError.toFixed(2)}dB, Max=${errorAnalysis.maxError.toFixed(2)}dB`);
  
  // ENHANCED: Show what type of response we're analyzing
  if (passType === 'targeted') {
    console.log(`  🔍 Analyzing RESIDUAL errors in corrected response after Pass 1`);
    console.log(`  🎯 Looking for remaining issues that Pass 1 didn't fully resolve`);
  } else if (passType === 'polishing') {
    console.log(`  🔍 Analyzing response for precision polishing after Pass 2`);
    console.log(`  ✨ Applying high-precision corrections`);
  } else if (passType === 'ultra-fine') {
    console.log(`  🔍 Analyzing response for ULTRA-FINE detail corrections after Pass 3`);
    console.log(`  🔬 Applying surgical precision for perfect target matching`);
  } else {
    console.log(`  🔍 Analyzing ORIGINAL response for major corrections`);
  }

  // Get significant errors, filtered by type of pass
  // PROFESSIONAL APPROACH: Frequency-dependent thresholds like Dirac/ARC
  const getErrorThreshold = (freq: number): number => {
    if (passType === 'broad') {
      // Pass 1: MUCH more aggressive on all frequencies
      if (freq < 40) return 0.4;   // ULTRA sensitive for deep bass modes (was 0.8)
      if (freq < 80) return 0.5;   // ULTRA sensitive for bass modes (was 1.0)
      if (freq < 150) return 0.7;  // Much more sensitive (was 1.3)
      if (freq < schroederFreq) return 1.0;  // More sensitive for upper modal region (was 1.8)
      return 1.5;                  // Much more sensitive above Schroeder (was 2.5)
    } else if (passType === 'targeted') {
      // Pass 2: ULTRA-fine refinement thresholds
      if (freq < 40) return 0.2;   // MAXIMUM precision for deep bass (was 0.4)
      if (freq < 80) return 0.3;   // MAXIMUM precision for bass (was 0.6)
      if (freq < 150) return 0.4;  // Maximum precision (was 0.7)
      if (freq < schroederFreq) return 0.5;  // High precision above bass region (was 0.9)
      return 0.7;                  // Much more critical above Schroeder (was 1.2)
    } else if (passType === 'polishing') {
      // Pass 3: High precision thresholds
      if (freq < 40) return 0.15;  // EXTREME precision for deep bass (was 0.3)
      if (freq < 80) return 0.2;   // EXTREME precision for bass
      if (freq < 150) return 0.25; // EXTREME precision
      if (freq < schroederFreq) return 0.3;  // EXTREME precision above bass region
      return 0.4;                  // EXTREME precision above Schroeder
    } else {
      // Pass 4: ULTRA-FINE precision thresholds - surgical precision
      if (freq < 40) return 0.1;   // SURGICAL precision for deep bass
      if (freq < 80) return 0.15;  // SURGICAL precision for bass
      if (freq < 150) return 0.2;  // SURGICAL precision
      if (freq < schroederFreq) return 0.25; // SURGICAL precision above bass region
      return 0.3;                  // SURGICAL precision above Schroeder
    }
  };

  const significantErrors = errorAnalysis.errorByFrequency
    .filter(e => e.freq <= 300) // EXTENDED: Go all the way to 300Hz (was schroederFreq + 20)
    .filter(e => Math.abs(e.error) > getErrorThreshold(e.freq)) // IMPROVED: Frequency-dependent thresholds
    .sort((a, b) => {
      // PROFESSIONAL PRIORITY: Weight low frequencies much more heavily
      let aWeight = Math.abs(a.error);
      let bWeight = Math.abs(b.error);
      
      // Apply frequency-based weighting
      if (a.freq < 60) aWeight *= 3.0;      // 3x weight for critical bass modes (was 2.0)
      else if (a.freq < 100) aWeight *= 2.0; // 2x weight for bass modes
      else if (a.freq < schroederFreq) aWeight *= 1.5; // 1.5x weight for modal region
      // No extra weight above Schroeder
      
      if (b.freq < 60) bWeight *= 3.0;      // 3x weight for critical bass modes (was 2.0)
      else if (b.freq < 100) bWeight *= 2.0; // 2x weight for bass modes  
      else if (b.freq < schroederFreq) bWeight *= 1.5; // 1.5x weight for modal region
      // No extra weight above Schroeder
      
      return bWeight - aWeight;
    });

  console.log(`  🔍 Found ${significantErrors.length} significant errors (freq-dependent thresholds)`);
  if (significantErrors.length > 0) {
    console.log(`    Top errors: ${significantErrors.slice(0, 5).map(e => 
      `${e.freq.toFixed(0)}Hz(${e.error.toFixed(1)}dB)`
    ).join(', ')}`);
  }

  // Smart frequency distribution to avoid clustering
  const bands: EQBand[] = [];
  const distributedErrors = smartFrequencyDistribution(
    significantErrors, 
    maxBands, 
    schroederFreq, 
    usedFrequencies,
    passType
  );

  console.log(`  📍 Distributed to ${distributedErrors.length} well-spaced frequencies`);

  // Generate bands for distributed errors
  for (const errorPoint of distributedErrors) {
    if (bands.length >= maxBands) break;

    let requiredGain = -errorPoint.error * (1 - smoothing);
    
    // IMPROVED: Frequency-dependent scaling for better low-freq correction
    let frequencyScaling = 1.0;
    if (errorPoint.freq < 40) {
      frequencyScaling = 1.2;  // More aggressive for deep bass modes
    } else if (errorPoint.freq < 80) {
      frequencyScaling = 1.1;  // Slightly more aggressive for bass modes
    } else if (errorPoint.freq < 150) {
      frequencyScaling = 1.0;  // Standard for upper bass
    } else if (errorPoint.freq < schroederFreq) {
      frequencyScaling = 0.9;  // Slightly more conservative for modal transition
    } else {
      frequencyScaling = 0.7;  // Much more conservative above Schroeder (speaker region)
    }
    
    // Apply different scaling for different pass types
    const passScaling = passType === 'broad' ? 0.95 : 
                       passType === 'targeted' ? 0.9 : 
                       passType === 'polishing' ? 0.85 :
                       0.8; // ultra-fine gets most conservative scaling
    requiredGain *= passScaling * frequencyScaling;
    
    // Apply gain limits
      if (requiredGain > 0) {
      requiredGain = Math.min(requiredGain, maxBoost);
      } else {
        requiredGain = Math.max(requiredGain, -maxCut);
      }
    
    if (Math.abs(requiredGain) > 0.2) { // Lower threshold for more corrections (was 0.3)
      // Calculate Q based on pass type and frequency
      const q = calculatePassQ(errorPoint.freq, Math.abs(errorPoint.error), passType, minQ, maxQ, maxBands);
      
      bands.push({
        frequency: Math.round(errorPoint.freq * 10) / 10,
        gain: Math.round(requiredGain * 10) / 10,
        q: Math.round(q * 10) / 10,
        type: 'peak'
      });
      
      const regionLabel = errorPoint.freq < schroederFreq ? 'modal' : 'speaker';
      console.log(`    🎛️ ${errorPoint.freq.toFixed(1)}Hz: ${requiredGain >= 0 ? '+' : ''}${requiredGain.toFixed(1)}dB Q=${q.toFixed(1)} (${passType}, ${regionLabel})`);
    }
  }

  // SMART SPECTRAL BALANCE: For low band counts, add compensating high-frequency adjustment
  if (passType === 'broad' && maxBands <= 12) {
    const spectralBalanceBand = addSpectralBalanceCorrection(
      bands,
      currentResponse,
      targetResponse,
      maxBands,
      maxCut,
      schroederFreq
    );
    
    if (spectralBalanceBand) {
      bands.push(spectralBalanceBand);
      console.log(`    🌊 SPECTRAL BALANCE: Added ${spectralBalanceBand.frequency}Hz (${spectralBalanceBand.gain}dB) to compensate for low-freq cuts`);
    }
  }

  return bands;
}

/**
 * Smart frequency distribution to avoid clustering corrections
 * IMPROVED: Professional-grade low frequency prioritization
 */
function smartFrequencyDistribution(
  errors: Array<{freq: number, error: number}>,
  maxBands: number,
  schroederFreq: number,
  usedFrequencies: Set<number>,
  passType: 'broad' | 'targeted' | 'polishing' | 'ultra-fine'
): Array<{freq: number, error: number}> {
  if (errors.length === 0) return [];

  const distributed: Array<{freq: number, error: number}> = [];
  
  // PROFESSIONAL APPROACH: Frequency-dependent spacing like Dirac/ARC
  const getMinSpacing = (freq: number): number => {
    if (passType === 'broad') {
      if (freq < 40) return 8;   // Very tight spacing for deep bass
      if (freq < 80) return 12;  // Tight spacing for bass modes  
      if (freq < 150) return 18; // Moderate spacing for upper bass
      return 25; // Wider spacing for higher frequencies
    } else if (passType === 'targeted') {
      if (freq < 40) return 5;   // Tighter spacing for targeted corrections
      if (freq < 80) return 8;   // Tighter spacing for bass modes  
      if (freq < 150) return 12; // Moderate spacing for upper bass
      return 15; // Tighter spacing for higher frequencies
    } else if (passType === 'polishing') {
      if (freq < 40) return 4;   // Very tight spacing for polishing
      if (freq < 80) return 6;   // Very tight spacing for bass modes  
      if (freq < 150) return 8;  // Tight spacing for upper bass
      return 10; // Tight spacing for higher frequencies
    } else {
      // ultra-fine: SURGICAL precision spacing
      if (freq < 40) return 3;   // SURGICAL spacing for deep bass
      if (freq < 80) return 4;   // SURGICAL spacing for bass modes  
      if (freq < 150) return 5;  // SURGICAL spacing for upper bass
      return 6; // SURGICAL spacing for higher frequencies
    }
  };
  
  // PROFESSIONAL ZONES: Heavily weighted toward low frequencies where room modes dominate
  // BUT: More balanced allocation for lower band counts to ensure general coverage
  let zones;
  
  if (maxBands <= 12) {
    // For low band counts (≤12): More balanced to ensure general coverage
    zones = [
      { min: 20, max: 50, maxBands: Math.ceil(maxBands * 0.25), name: 'Deep Bass' },        // 25% for deep bass
      { min: 50, max: 100, maxBands: Math.ceil(maxBands * 0.30), name: 'Bass Modes' },      // 30% for bass modes
      { min: 100, max: 180, maxBands: Math.ceil(maxBands * 0.25), name: 'Upper Bass' },     // 25% for upper bass
      { min: 180, max: schroederFreq, maxBands: Math.ceil(maxBands * 0.12), name: 'Modal Transition' }, // 12% for modal transition
      { min: schroederFreq, max: 300, maxBands: Math.ceil(maxBands * 0.08), name: 'Speaker Region' }    // 8% for speaker region
    ];
  } else {
    // For higher band counts (>12): Professional room mode focused allocation
    zones = [
      { min: 20, max: 40, maxBands: Math.ceil(maxBands * 0.35), name: 'Deep Bass' },     // 35% for deep bass
      { min: 40, max: 80, maxBands: Math.ceil(maxBands * 0.40), name: 'Bass Modes' },    // 40% for bass modes
      { min: 80, max: 150, maxBands: Math.ceil(maxBands * 0.15), name: 'Upper Bass' },   // 15% for upper bass
      { min: 150, max: schroederFreq, maxBands: Math.ceil(maxBands * 0.08), name: 'Modal Transition' }, // 8% for modal transition
      { min: schroederFreq, max: 300, maxBands: Math.ceil(maxBands * 0.02), name: 'Speaker Region' }  // 2% for speaker region
    ];
  }

  console.log(`    📊 PROFESSIONAL Zone allocation: ${zones.map(z => `${z.name}(${z.maxBands})`).join(', ')}`);

  // PRIORITY PASS: First, grab the most critical low-frequency errors
  const criticalLowFreqErrors = errors.filter(e => e.freq < 80 && Math.abs(e.error) > 2.5); // Extended to 80Hz, lowered threshold
  console.log(`    🚨 Critical low-freq errors (<80Hz, >2.5dB): ${criticalLowFreqErrors.length}`);
  
  for (const error of criticalLowFreqErrors) {
    if (distributed.length >= maxBands) break;
    
    const minSpacing = getMinSpacing(error.freq);
    const tooCloseToExisting = Array.from(usedFrequencies).some(freq => 
      Math.abs(freq - error.freq) < minSpacing
    );
    const tooCloseToDistributed = distributed.some(d => 
      Math.abs(d.freq - error.freq) < minSpacing
    );

    if (!tooCloseToExisting && !tooCloseToDistributed) {
      distributed.push(error);
      console.log(`    🎯 PRIORITY: ${error.freq.toFixed(1)}Hz (${error.error.toFixed(1)}dB error)`);
    }
  }

  // ZONE PASS: Fill remaining slots by zone, respecting priority allocations
  for (const zone of zones) {
    const zoneErrors = errors.filter(e => 
      e.freq >= zone.min && 
      e.freq <= zone.max &&
      !distributed.some(d => Math.abs(d.freq - e.freq) < 1) // Not already distributed
    );
    
    let zoneBands = distributed.filter(d => d.freq >= zone.min && d.freq <= zone.max).length;
    console.log(`    📍 ${zone.name} (${zone.min}-${zone.max}Hz): ${zoneBands}/${zone.maxBands} used, ${zoneErrors.length} candidates`);

    for (const error of zoneErrors) {
      if (zoneBands >= zone.maxBands || distributed.length >= maxBands) break;

      const minSpacing = getMinSpacing(error.freq);
      const tooCloseToExisting = Array.from(usedFrequencies).some(freq => 
        Math.abs(freq - error.freq) < minSpacing
      );
      const tooCloseToDistributed = distributed.some(d => 
        Math.abs(d.freq - error.freq) < minSpacing
      );

      if (!tooCloseToExisting && !tooCloseToDistributed) {
        distributed.push(error);
        zoneBands++;
        console.log(`      ✓ ${error.freq.toFixed(1)}Hz: ${error.error.toFixed(1)}dB (spacing: ${minSpacing}Hz)`);
      }
    }
  }

  return distributed;
}

/**
 * Calculate Q factor based on pass type and characteristics
 * IMPROVED: Professional Q selection like Dirac/ARC systems
 * ENHANCED: Broader Q factors for low band counts to maximize coverage
 */
function calculatePassQ(
  frequency: number,
  errorMagnitude: number,
  passType: 'broad' | 'targeted' | 'polishing' | 'ultra-fine',
  minQ: number,
  maxQ: number,
  maxBands?: number // New optional parameter for band count consideration
): number {
  let baseQ: number;
  
  // SMART Q ADJUSTMENT: Use broader Q factors for low band counts
  const isLowBandCount = maxBands && maxBands <= 12;
  const qReductionFactor = isLowBandCount ? 0.6 : 1.0; // Reduce Q by 40% for low band counts
  
  if (passType === 'broad') {
    // Pass 1: Professional Q factors - higher than before for precise room mode correction
    if (frequency < 30) {
      baseQ = 1.8;  // Much higher for deepest bass modes (was 0.7)
    } else if (frequency < 50) {
      baseQ = 2.2;  // Higher for low bass modes (was 0.9)
    } else if (frequency < 80) {
      baseQ = 2.8;  // Professional for bass region (was 1.2)
    } else if (frequency < 120) {
      baseQ = 3.2;  // Sharp for mid-bass (was 1.6)
    } else if (frequency < 200) {
      baseQ = 3.8;  // Very sharp for upper bass (was 2.0)
    } else {
      baseQ = 4.5;  // Professional sharp above Schroeder (was 3.0)
    }
  } else if (passType === 'targeted') {
    // Pass 2: Higher precision Q factors for targeted corrections
    if (frequency < 30) {
      baseQ = 2.8;  // Professional deep bass precision (was 1.2)
    } else if (frequency < 50) {
      baseQ = 3.5;  // High precision for low bass (was 1.8)
    } else if (frequency < 80) {
      baseQ = 4.2;  // Very sharp for bass modes (was 2.5)
    } else if (frequency < 120) {
      baseQ = 5.0;  // Extremely sharp for mid-bass (was 3.2)
    } else if (frequency < 200) {
      baseQ = 5.8;  // Professional precision (was 4.0)
    } else {
      baseQ = 6.5;  // Maximum precision above Schroeder (was 5.5)
    }
  } else if (passType === 'polishing') {
    // Pass 3: Polishing - Maximum precision Q factors
    if (frequency < 30) {
      baseQ = 4.0;  // High precision deep bass polishing (was 2.0)
    } else if (frequency < 50) {
      baseQ = 2.8;  // High Q for low bass polishing
    } else if (frequency < 80) {
      baseQ = 3.5;  // Very high Q for bass polishing
    } else if (frequency < 120) {
      baseQ = 4.5;  // Extremely high Q for mid-bass polishing
    } else if (frequency < 200) {
      baseQ = 5.5;  // Very precise for upper frequencies
    } else {
      baseQ = 7.0;  // Maximum precision above Schroeder
    }
  } else {
    // Pass 4: Ultra-fine - Surgical precision Q factors
    if (frequency < 30) {
      baseQ = 5.0;  // SURGICAL precision deep bass
    } else if (frequency < 50) {
      baseQ = 4.0;  // SURGICAL precision for low bass
    } else if (frequency < 80) {
      baseQ = 4.8;  // SURGICAL precision for bass
    } else if (frequency < 120) {
      baseQ = 6.0;  // SURGICAL precision for mid-bass
    } else if (frequency < 200) {
      baseQ = 7.5;  // SURGICAL precision for upper frequencies
    } else {
      baseQ = 9.0;  // MAXIMUM surgical precision above Schroeder
    }
  }
  
  // Apply low band count adjustment
  baseQ *= qReductionFactor;
  
  if (isLowBandCount) {
    console.log(`    📐 LOW BAND COUNT: Using broader Q (${baseQ.toFixed(1)}) for ${frequency}Hz to maximize coverage`);
  }
  
  // PROFESSIONAL ADJUSTMENT: Adapt Q based on error magnitude
  if (errorMagnitude > 8) {
    baseQ *= 0.8; // Broader for very large errors (was 0.9)
  } else if (errorMagnitude > 5) {
    baseQ *= 0.95; // Slightly broader for large errors (was 1.0)
  } else if (errorMagnitude > 2) {
    baseQ *= 1.05; // Slightly sharper for moderate errors (was 1.1)
  } else {
    baseQ *= 1.15; // Sharper for small errors (was 1.2)
  }
  
  // FREQUENCY-SPECIFIC LIMITS: Better limits for different regions
  let effectiveMinQ = minQ;
  let effectiveMaxQ = maxQ;
  
  if (frequency < 40) {
    effectiveMinQ = Math.max(isLowBandCount ? 0.8 : 1.5, minQ);       // Lower minimum for low band counts
    effectiveMaxQ = Math.min(maxQ, isLowBandCount ? 4.0 : 6.0);       // Lower maximum for broader coverage
  } else if (frequency < 80) {
    effectiveMinQ = Math.max(isLowBandCount ? 1.0 : 2.0, minQ);       // Lower minimum for low band counts
    effectiveMaxQ = Math.min(maxQ, isLowBandCount ? 5.0 : 8.0);       // Lower maximum for broader coverage
  } else if (frequency < 200) {
    effectiveMinQ = Math.max(isLowBandCount ? 1.2 : 2.5, minQ);       // Lower minimum for low band counts
    effectiveMaxQ = Math.min(maxQ, isLowBandCount ? 6.0 : 10.0);      // Lower maximum for broader coverage
  } else {
    // Above Schroeder: Allow higher Q but still reduce for low band counts
    effectiveMinQ = Math.max(isLowBandCount ? 1.5 : 3.0, minQ);       // Lower minimum for low band counts
    effectiveMaxQ = isLowBandCount ? Math.min(maxQ, 7.0) : maxQ;      // Slightly reduced maximum for low band counts
  }
  
  return Math.max(effectiveMinQ, Math.min(effectiveMaxQ, baseQ));
}

/**
 * Apply correction strategy for a detected feature
 */
function applyCorrectionStrategy(
  feature: EnhancedFeature,
  targetDb: number,
  roomResponse: ModeResponse[],
  maxBoost: number,
  maxCut: number,
  minQ: number,
  maxQ: number,
  smoothing: number
): EQBand[] {
  const bands: EQBand[] = [];
  
  switch (feature.correctionStrategy) {
    case 'cut': {
      // Standard peak cutting
      const currentDb = interpolateResponse(
        new Map(roomResponse.map(p => [p.freq, p.db])), 
        roomResponse, 
        feature.frequency
      );
      let cutGain = (targetDb - currentDb) * (1 - smoothing);
      cutGain = Math.max(-maxCut, cutGain); // Limit cut amount
      
      if (Math.abs(cutGain) > 0.5) {
        const q = calculateAdaptiveQ(feature.frequency, feature.prominence, cutGain, minQ, maxQ);
        bands.push({
          frequency: Math.round(feature.frequency * 10) / 10,
          gain: Math.round(cutGain * 10) / 10,
          q: Math.round(q * 10) / 10,
          type: 'peak'
        });
      }
      break;
    }

    case 'boost': {
      // Careful boost for shallow nulls
      const currentDbBoost = interpolateResponse(
        new Map(roomResponse.map(p => [p.freq, p.db])), 
        roomResponse, 
        feature.frequency
      );
      let boostGain = (targetDb - currentDbBoost) * (1 - smoothing) * 0.6; // More conservative
      boostGain = Math.min(maxBoost * 0.7, boostGain); // Limit boost amount
      
      if (boostGain > 0.5) {
        const q = calculateAdaptiveQ(feature.frequency, feature.prominence, boostGain, minQ, maxQ * 0.8);
        bands.push({
          frequency: Math.round(feature.frequency * 10) / 10,
          gain: Math.round(boostGain * 10) / 10,
          q: Math.round(q * 10) / 10,
          type: 'peak'
        });
      }
      break;
    }

    case 'fill_around': {
      // "Fill around" strategy - boost adjacent frequencies instead of the null itself
      const fillFrequencies = [
        feature.frequency * 0.85,  // Lower adjacent
        feature.frequency * 1.15   // Upper adjacent
      ].filter(f => f >= 20 && f <= 300);

      for (const fillFreq of fillFrequencies) {
        const fillCurrentDb = interpolateResponse(
          new Map(roomResponse.map(p => [p.freq, p.db])), 
          roomResponse, 
          fillFreq
        );
        const fillTargetDb = interpolateResponse(
          new Map(roomResponse.map(p => [p.freq, p.db])), 
          roomResponse, 
          feature.frequency
        ); // Use null level as target for fill
        
        let fillGain = (fillTargetDb - fillCurrentDb + 2) * 0.4; // Gentle fill, +2dB above null
        fillGain = Math.min(maxBoost * 0.5, fillGain);
        
        if (fillGain > 0.3) {
          const q = Math.max(minQ, Math.min(maxQ * 0.6, 2.0)); // Broader Q for filling
          bands.push({
            frequency: Math.round(fillFreq * 10) / 10,
            gain: Math.round(fillGain * 10) / 10,
            q: Math.round(q * 10) / 10,
            type: 'peak'
          });
        }
      }
      break;
    }

    case 'ignore':
      // Don't correct very deep nulls
      break;
  }

  return bands;
}

/**
 * Generate additional bands for general target curve matching
 */
function generateTargetMatchingBands(
  roomResponse: ModeResponse[],
  targetResponse: ModeResponse[],
  usedFrequencies: Set<number>,
  remainingBands: number,
  maxBoost: number,
  maxCut: number,
  minQ: number,
  maxQ: number,
  smoothing: number
): EQBand[] {
  const bands: EQBand[] = [];
  const roomDbMap = new Map(roomResponse.map(p => [p.freq, p.db]));
  
  // Create error analysis for general matching
  const errorPoints: Array<{freq: number, error: number, absError: number}> = [];
  
  for (const roomPoint of roomResponse) {
    if (roomPoint.freq > 300) continue;
    
    // Skip frequencies too close to existing bands
    const tooClose = Array.from(usedFrequencies).some(freq => 
      Math.abs(freq - roomPoint.freq) < roomPoint.freq * 0.08
    );
    if (tooClose) continue;
    
    const targetDb = interpolateResponse(
      new Map(targetResponse.map(p => [p.freq, p.db])), 
      targetResponse, 
      roomPoint.freq
    );
    
    const error = roomPoint.db - targetDb;
    const absError = Math.abs(error);
    
    if (absError > 1.0) { // Only significant errors
      errorPoints.push({
        freq: roomPoint.freq,
        error: error,
        absError: absError
      });
    }
  }
  
  // Sort by error magnitude and take the largest
  errorPoints.sort((a, b) => b.absError - a.absError);
  
  for (let i = 0; i < Math.min(errorPoints.length, remainingBands); i++) {
    const errorPoint = errorPoints[i];
    let correctionGain = -errorPoint.error * (1 - smoothing) * 0.7; // Conservative
    
    // Apply limits
    if (correctionGain > 0) {
      correctionGain = Math.min(correctionGain, maxBoost);
    } else {
      correctionGain = Math.max(correctionGain, -maxCut);
    }
    
    if (Math.abs(correctionGain) > 0.5) {
      const q = calculateAdaptiveQ(errorPoint.freq, errorPoint.absError, correctionGain, minQ, maxQ);
      
      bands.push({
        frequency: Math.round(errorPoint.freq * 10) / 10,
        gain: Math.round(correctionGain * 10) / 10,
        q: Math.round(q * 10) / 10,
        type: 'peak'
      });
      
      usedFrequencies.add(errorPoint.freq);
    }
  }
  
  return bands;
}

/**
 * Calculate adaptive Q factor with improved logic
 */
function calculateAdaptiveQ(
  frequency: number,
  prominence: number,
  correctionGain: number,
  minQ: number,
  maxQ: number
): number {
  // Base Q factors by frequency (more conservative than before)
  let baseQ: number;
  if (frequency < 60) {
    baseQ = 1.5; // Broader for low frequencies
  } else if (frequency < 120) {
    baseQ = 2.0; // Moderate for mid-bass
  } else if (frequency < 200) {
    baseQ = 2.5; // More targeted for upper bass
  } else {
    baseQ = 3.0; // Sharp for higher frequencies
  }
  
  // Adjust based on prominence
  if (prominence > 6) {
    baseQ *= 1.3; // Sharper for very prominent features
  } else if (prominence < 2) {
    baseQ *= 0.7; // Broader for subtle features
  }
  
  // Adjust based on gain magnitude
  const absGain = Math.abs(correctionGain);
  if (absGain > 8) {
    baseQ *= 1.2; // Sharper for large corrections
  } else if (absGain < 3) {
    baseQ *= 0.8; // Broader for small corrections
  }
  
  return Math.max(minQ, Math.min(maxQ, baseQ));
}

/**
 * Calculate EQ statistics for reporting
 */
function calculateEQStatistics(bands: EQBand[], features: EnhancedFeature[]) {
  const nulls = features.filter(f => f.isNull);
  const peaks = features.filter(f => !f.isNull);
  
  const strategyCount = {
    cut: features.filter(f => f.correctionStrategy === 'cut').length,
    boost: features.filter(f => f.correctionStrategy === 'boost').length,
    fill_around: features.filter(f => f.correctionStrategy === 'fill_around').length,
    ignore: features.filter(f => f.correctionStrategy === 'ignore').length
  };
  
  return {
    strategyBreakdown: `Cut: ${strategyCount.cut}, Boost: ${strategyCount.boost}, Fill: ${strategyCount.fill_around}, Ignore: ${strategyCount.ignore}`,
    nullHandling: `${nulls.length} nulls detected (${strategyCount.ignore} ignored, ${strategyCount.fill_around} filled around, ${strategyCount.boost} boosted)`,
    peakCorrections: `${peaks.length} peaks corrected`
  };
}

/**
 * Calculate the response of a single EQ band at a given frequency
 * Using proper parametric EQ math with full gain range
 */
function calculateBandResponse(freq: number, band: EQBand): number {
  if (band.type !== 'peak') {
    return 0;
  }

  const f0 = band.frequency;
  const gain = band.gain;
  const q = band.q;

  if (freq <= 0 || f0 <= 0 || q <= 0 || Math.abs(gain) < 0.01) {
    return 0;
  }

  // Professional parametric EQ bell filter formula
  const freqRatio = freq / f0;
  const qTerm = q * (freqRatio - 1/freqRatio);
  const denominator = 1 + (qTerm * qTerm);
  
  if (denominator <= 0) {
    return 0;
  }
  
  // Standard bell filter transfer function:
  // H(f) = 1 + (10^(gain_dB/20) - 1) / (1 + Q²((f/f0) - (f0/f))²)
  const linearGain = Math.pow(10, gain / 20);
  const response = 1 + (linearGain - 1) / denominator;
  
  if (response <= 1e-10) {
    return -200; // Very large cut, but not infinite
  }
  
  // Convert to dB
  const responseDb = 20 * Math.log10(response);
  
  // Debug specific bands for troubleshooting
  if ((freq >= 33 && freq <= 35) && Math.abs(gain) > 5) {
    console.log(`  🔧 EQ Band ${f0.toFixed(1)}Hz (${gain.toFixed(1)}dB, Q=${q.toFixed(1)}) at ${freq.toFixed(1)}Hz:`);
    console.log(`    freqRatio=${freqRatio.toFixed(3)}, qTerm=${qTerm.toFixed(3)}, denominator=${denominator.toFixed(3)}`);
    console.log(`    linearGain=${linearGain.toFixed(3)}, response=${response.toFixed(3)}, responseDb=${responseDb.toFixed(3)}dB`);
  }
  
  // Safety checks for invalid results
  if (!isFinite(responseDb) || isNaN(responseDb)) {
    return 0;
  }
  
  // REMOVED: Conservative clamping that was limiting EQ effectiveness
  // OLD: return Math.max(-6, Math.min(6, responseDb));
  // NEW: Allow full range but with reasonable safety limits
  return Math.max(-50, Math.min(20, responseDb));
}

/**
 * Clear the response cache (useful for debugging or memory management)
 */
export function clearResponseCache(): void {
  responseCache.clear();
}

/**
 * Get cache statistics for debugging
 */
export function getCacheStats(): { size: number; keys: string[] } {
  return {
    size: responseCache.size,
    keys: Array.from(responseCache.keys())
  };
}

/**
 * Test function to demonstrate EQ improvements and performance benefits
 * This can be called from the browser console for testing
 */
export function testEQImprovements(): void {
  console.log('🧪 Testing EQ improvements...');
  
  // Create test room and positions
  const testRoom = { L: 5, W: 4, H: 3 };
  const testSub = { x: 1, y: 1, z: 0.5 };
  const testListener = { x: 3, y: 2, z: 1.2 };
  
  // Test 1: Performance with memoization
  console.log('\n📊 Performance Test:');
  console.log('First calculation (cache miss):');
  const response1 = simulateRoomResponse(testSub, testListener, testRoom.L, testRoom.W, testRoom.H);
  
  console.log('Second calculation with same parameters (cache hit):');
  const response2 = simulateRoomResponse(testSub, testListener, testRoom.L, testRoom.W, testRoom.H);
  
  console.log('Responses are identical:', JSON.stringify(response1) === JSON.stringify(response2));
  
  // Test 2: EQ generation with peak detection (updated to handle Promise)
  console.log('\n🎛️ EQ Generation Test:');
  const targetResponse = response1.map(p => ({ freq: p.freq, db: getHarmanTargetDB(p.freq) + 80 }));
  
  generateOptimalEQ(response1, targetResponse, {
    numBands: 10,
    maxBoost: 6,
    maxCut: 12,
    schroederFreq: 150
  }).then(eqSettings => {
    console.log(`Generated ${eqSettings.bands.length} EQ bands:`);
    eqSettings.bands.forEach((band, i) => {
      console.log(`  Band ${i + 1}: ${band.frequency}Hz, ${band.gain >= 0 ? '+' : ''}${band.gain}dB, Q=${band.q}`);
    });
    
    // Test 3: Feature detection
    console.log('\n🔍 Feature Detection Test:');
    const features = detectResponseFeatures(response1, 150);
    console.log(`Detected ${features.length} significant features:`);
    features.slice(0, 5).forEach((feature, i) => {
      console.log(`  ${i + 1}. ${feature.frequency.toFixed(1)}Hz ${feature.type} (prominence: ${feature.prominence.toFixed(1)}dB)`);
    });
    
    console.log('\n✅ Test completed! Check the console logs above for performance improvements.');
  }).catch(error => {
    console.error('EQ generation test failed:', error);
  });
}

/**
 * Analyze error between current response and target curve
 */
export function analyzeTargetError(
  currentResponse: ModeResponse[],
  targetResponse: ModeResponse[]
): {
  rmsError: number;
  maxError: number;
  avgError: number;
  errorByFrequency: Array<{ freq: number; error: number; currentDb: number; targetDb: number }>;
} {
  const errors: Array<{ freq: number; error: number; currentDb: number; targetDb: number }> = [];
  let sumSquaredError = 0;
  let maxError = 0;
  let sumError = 0;
  let validPoints = 0;

  for (const currentPoint of currentResponse) {
    const targetPoint = targetResponse.find(t => Math.abs(t.freq - currentPoint.freq) < 1);
    if (targetPoint) {
      const error = currentPoint.db - targetPoint.db;
      const absError = Math.abs(error);
      
      errors.push({
        freq: currentPoint.freq,
        error: error,
        currentDb: currentPoint.db,
        targetDb: targetPoint.db
      });
      
      sumSquaredError += error * error;
      sumError += error;
      maxError = Math.max(maxError, absError);
      validPoints++;
    }
  }

  const rmsError = validPoints > 0 ? Math.sqrt(sumSquaredError / validPoints) : 0;
  const avgError = validPoints > 0 ? sumError / validPoints : 0;

  return {
    rmsError,
    maxError,
    avgError,
    errorByFrequency: errors
  };
}

/**
 * Generate correction EQ for remaining error between current and target response
 */
export function generateCorrectionEQ(
  currentResponse: ModeResponse[],
  targetResponse: ModeResponse[],
  options: {
    numBands?: number;
    maxBoost?: number;
    maxCut?: number;
    smoothing?: number;
    minQ?: number;
    maxQ?: number;
    schroederFreq?: number;
    learningRate?: number;
    iteration?: number;
  } = {}
): EQSettings {
  const {
    numBands = 15,
    maxBoost = 6.0,
    maxCut = 12.0,
    smoothing = 0.2,
    minQ = 0.7,
    maxQ = 6.0,
    schroederFreq = 200,
    learningRate = 0.7,
    iteration = 1
  } = options;

  // Analyze the error between current and target
  const errorAnalysis = analyzeTargetError(currentResponse, targetResponse);
  
  console.log(`🔧 Generating correction EQ (iteration ${iteration}): RMS error = ${errorAnalysis.rmsError.toFixed(2)}dB`);

  // Focus on the most significant errors
  const significantErrors = errorAnalysis.errorByFrequency
    .filter(e => Math.abs(e.error) > 0.5) // Only correct errors > 0.5dB
    .filter(e => e.freq <= schroederFreq + 20) // Respect Schroeder frequency
    .sort((a, b) => Math.abs(b.error) - Math.abs(a.error)) // Sort by error magnitude
    .slice(0, numBands); // Limit to available bands

  const bands: EQBand[] = [];
  
  // Create frequency distribution for remaining bands if we have fewer significant errors
  const remainingBands = Math.max(0, numBands - significantErrors.length);
  const distributedFrequencies: number[] = [];
  
  if (remainingBands > 0) {
    const minFreq = 20;
    const maxFreq = Math.min(300, schroederFreq + 20);
    const logMin = Math.log10(minFreq);
    const logMax = Math.log10(maxFreq);
    
    for (let i = 0; i < remainingBands; i++) {
      const ratio = i / Math.max(1, remainingBands - 1);
      const logFreq = logMin + ratio * (logMax - logMin);
      const freq = Math.pow(10, logFreq);
      
      // Only add if not too close to significant errors
      const tooClose = significantErrors.some(e => Math.abs(e.freq - freq) < freq * 0.2);
      if (!tooClose) {
        distributedFrequencies.push(freq);
      }
    }
  }

  // Process significant errors first
  for (const errorPoint of significantErrors) {
    let requiredGain = -errorPoint.error * learningRate; // Apply learning rate
    
    // Apply iteration-based scaling (be more conservative in later iterations)
    const iterationScaling = Math.max(0.3, 1.0 - (iteration - 1) * 0.15);
    requiredGain *= iterationScaling;
    
    // Apply gain limits
      if (requiredGain > 0) {
      requiredGain = Math.min(requiredGain, maxBoost);
      } else {
        requiredGain = Math.max(requiredGain, -maxCut);
      }
    
    // Skip very small corrections - but be more aggressive in higher frequencies
    let minCorrectionThreshold: number;
    if (errorPoint.freq < 80) {
      minCorrectionThreshold = 0.4; // More aggressive for low frequencies (was 0.8)
    } else if (errorPoint.freq < 200) {
      minCorrectionThreshold = 0.3; // Much more aggressive in mid-range (was 0.6)
    } else {
      minCorrectionThreshold = 0.25; // Ultra aggressive in 200-300Hz range (was 0.4)
    }
    
    if (Math.abs(requiredGain) < minCorrectionThreshold) continue;
    
    // Calculate adaptive Q
    const q = calculateAdaptiveQ(
      errorPoint.freq,
      Math.abs(errorPoint.error),
      requiredGain, 
      minQ, 
      maxQ
    );
    
    bands.push({
      frequency: Math.round(errorPoint.freq * 10) / 10,
      gain: Math.round(requiredGain * 10) / 10,
      q: Math.round(q * 10) / 10,
      type: 'peak'
    });
  }

  // Add distributed frequency bands for general curve shaping
  for (const freq of distributedFrequencies.slice(0, numBands - bands.length)) {
    const currentPoint = currentResponse.find(r => Math.abs(r.freq - freq) < freq * 0.1);
    const targetPoint = targetResponse.find(t => Math.abs(t.freq - freq) < freq * 0.1);
    
    if (currentPoint && targetPoint) {
      const error = currentPoint.db - targetPoint.db;
      let requiredGain = -error * learningRate * 0.5; // More conservative for distributed bands
      
      // Apply iteration scaling
      const iterationScaling = Math.max(0.2, 1.0 - (iteration - 1) * 0.2);
      requiredGain *= iterationScaling;
      
      // Apply gain limits (more conservative)
      if (requiredGain > 0) {
        requiredGain = Math.min(requiredGain, maxBoost * 0.6);
      } else {
        requiredGain = Math.max(requiredGain, -maxCut * 0.6);
      }
      
      if (Math.abs(requiredGain) > 0.5) {
        const q = calculateAdaptiveQ(
          freq,
          Math.abs(error),
          requiredGain, 
          minQ, 
          Math.min(maxQ, 4.0)
        );
    
    bands.push({
          frequency: Math.round(freq * 10) / 10,
          gain: Math.round(requiredGain * 10) / 10,
          q: Math.round(q * 10) / 10,
      type: 'peak'
    });
      }
    }
  }

  console.log(`🎛️ Generated ${bands.length} correction bands for iteration ${iteration}`);

  return {
    bands,
    enabled: true,
    maxBoost,
    maxCut,
    smoothing
  };
}

/**
 * Merge two EQ settings intelligently, avoiding frequency conflicts
 */
export function mergeEQSettings(
  baseEQ: EQSettings,
  correctionEQ: EQSettings,
  maxBands: number
): EQSettings {
  const mergedBands: EQBand[] = [...baseEQ.bands];
  
  // Add correction bands, merging with existing bands if frequencies are close
  for (const correctionBand of correctionEQ.bands) {
    const existingBandIndex = mergedBands.findIndex(
      band => Math.abs(band.frequency - correctionBand.frequency) < correctionBand.frequency * 0.15
    );
    
    if (existingBandIndex >= 0) {
      // Merge with existing band
      const existingBand = mergedBands[existingBandIndex];
      
      // Combine gains additively but with some damping to prevent runaway
      const combinedGain = existingBand.gain + correctionBand.gain * 0.8;
      
      // Use average Q, favoring lower values for stability
      const combinedQ = (existingBand.q + correctionBand.q) / 2;
      
      // Apply safety limits
      const finalGain = Math.max(-30, Math.min(15, combinedGain));
      const finalQ = Math.max(0.5, Math.min(8, combinedQ));
      
      mergedBands[existingBandIndex] = {
        ...existingBand,
        gain: Math.round(finalGain * 10) / 10,
        q: Math.round(finalQ * 10) / 10
      };
    } else if (mergedBands.length < maxBands) {
      // Add as new band if we have room
      mergedBands.push(correctionBand);
    }
  }
  
  // Sort by frequency and limit to maxBands
  mergedBands.sort((a, b) => a.frequency - b.frequency);
  const finalBands = mergedBands.slice(0, maxBands);
  
  // Remove bands with very small gains
  const effectiveBands = finalBands.filter(band => Math.abs(band.gain) >= 0.2);
  
  return {
    ...baseEQ,
    bands: effectiveBands
  };
}

/**
 * Simulate room response WITHOUT spectral tilt for EQ analysis
 * This gives us the "pure" room acoustics without the artificial spectral shaping
 */
export function simulateRoomResponseForEQ(
  subPos: Point, 
  listenerPos: Point, 
  L: number, 
  W: number, 
  H: number, 
  maxModeOrder = 10,
  baseQFactor = DEFAULT_Q_FACTOR
): ModeResponse[] {
  // Call the main function with no spectral tilt (default behavior)
  return simulateRoomResponse(subPos, listenerPos, L, W, H, maxModeOrder, baseQFactor);
}

/**
 * Analyze room modes to understand what's causing peaks and nulls
 */
export interface RoomModeInfo {
  frequency: number;
  amplitude: number;
  nMode: number;  // x-direction mode
  mMode: number;  // y-direction mode  
  lMode: number;  // z-direction mode
  coupling: number; // How strongly this mode couples between sub and listener
  type: 'axial' | 'tangential' | 'oblique';
}

export function analyzeRoomModes(
  subPos: Point, 
  listenerPos: Point, 
  L: number, 
  W: number, 
  H: number, 
  maxModeOrder = 10
): RoomModeInfo[] {
  const modes: RoomModeInfo[] = [];
  
  for (let n = 0; n <= maxModeOrder; n++) {
    for (let m = 0; m <= maxModeOrder; m++) {
      for (let l = 0; l <= maxModeOrder; l++) {
        if (n === 0 && m === 0 && l === 0) continue; // Skip DC mode
        if (L === 0 && n !== 0) continue;
        if (W === 0 && m !== 0) continue; 
        if (H === 0 && l !== 0) continue;

        const termL = (L === 0) ? 0 : (n / L);
        const termW = (W === 0) ? 0 : (m / W);
        const termH = (H === 0) ? 0 : (l / H);

        const fMode = (SPEED_OF_SOUND / 2) * Math.sqrt(
          termL ** 2 + termW ** 2 + termH ** 2
        );

        if (fMode <= 0 || fMode > 300) continue; // Only analyze up to 300Hz

        const subPressure = calculateModePressure(n, m, l, subPos, { L, W, H });
        const listenerPressure = calculateModePressure(n, m, l, listenerPos, { L, W, H });
        const coupling = subPressure * listenerPressure;

        if (Math.abs(coupling) < 0.1) continue; // Skip weakly coupled modes

        // Classify mode type
        const nonZeroIndices = [n > 0 ? 1 : 0, m > 0 ? 1 : 0, l > 0 ? 1 : 0].reduce((a, b) => a + b, 0);
        let type: 'axial' | 'tangential' | 'oblique';
        if (nonZeroIndices === 1) type = 'axial';
        else if (nonZeroIndices === 2) type = 'tangential';
        else type = 'oblique';

        modes.push({
          frequency: fMode,
          amplitude: Math.abs(coupling),
          nMode: n,
          mMode: m,
          lMode: l,
          coupling,
          type
        });
      }
    }
  }

  return modes.sort((a, b) => a.frequency - b.frequency);
}

/**
 * Enhanced peak/null detection with room mode analysis
 */
export interface EnhancedFeature extends DetectedPeak {
  isNull: boolean;           // True if this is a null (destructive interference)
  nullDepth?: number;        // How deep the null is (dB below surrounding area)
  nearbyModes: RoomModeInfo[]; // Room modes near this frequency
  correctionStrategy: 'cut' | 'boost' | 'fill_around' | 'ignore';
}

/**
 * Consolidate nearby features to prevent overlapping EQ bands
 * Groups features within frequency threshold into single broader corrections
 */
function consolidateNearbyFeatures(
  features: EnhancedFeature[],
  schroederFreq: number
): EnhancedFeature[] {
  if (features.length === 0) return features;
  
  // Sort by frequency for easier grouping
  const sortedFeatures = [...features].sort((a, b) => a.frequency - b.frequency);
  const consolidated: EnhancedFeature[] = [];
  
  let currentGroup: EnhancedFeature[] = [sortedFeatures[0]];
  
  for (let i = 1; i < sortedFeatures.length; i++) {
    const current = sortedFeatures[i];
    const groupCenter = currentGroup.reduce((sum, f) => sum + f.frequency, 0) / currentGroup.length;
    
    // Define consolidation threshold based on frequency and Schroeder
    const consolidationThreshold = current.frequency < schroederFreq 
      ? Math.max(5, current.frequency * 0.08)  // Smaller threshold below Schroeder
      : Math.max(8, current.frequency * 0.12); // Larger threshold above Schroeder
    
    // Check if current feature is close to the group
    const distanceToGroup = Math.abs(current.frequency - groupCenter);
    
    if (distanceToGroup <= consolidationThreshold && 
        current.type === currentGroup[0].type && 
        current.correctionStrategy === currentGroup[0].correctionStrategy) {
      // Add to current group
      currentGroup.push(current);
    } else {
      // Finalize current group and start new one
      if (currentGroup.length > 1) {
        // Create consolidated feature from group
        const groupFreq = currentGroup.reduce((sum, f) => sum + f.frequency, 0) / currentGroup.length;
        const groupProminence = Math.max(...currentGroup.map(f => f.prominence));
        const groupAmplitude = currentGroup.reduce((sum, f) => sum + f.amplitude, 0) / currentGroup.length;
        const groupWidth = Math.max(...currentGroup.map(f => f.width));
        
        consolidated.push({
          ...currentGroup[0], // Use first feature as template
          frequency: groupFreq,
          prominence: groupProminence,
          amplitude: groupAmplitude,
          width: groupWidth,
          nearbyModes: currentGroup.flatMap(f => f.nearbyModes)
        });
      } else {
        // Single feature, keep as-is
        consolidated.push(currentGroup[0]);
      }
      
      currentGroup = [current];
    }
  }
  
  // Handle the last group
  if (currentGroup.length > 1) {
    const groupFreq = currentGroup.reduce((sum, f) => sum + f.frequency, 0) / currentGroup.length;
    const groupProminence = Math.max(...currentGroup.map(f => f.prominence));
    const groupAmplitude = currentGroup.reduce((sum, f) => sum + f.amplitude, 0) / currentGroup.length;
    const groupWidth = Math.max(...currentGroup.map(f => f.width));
    
    consolidated.push({
      ...currentGroup[0],
      frequency: groupFreq,
      prominence: groupProminence,
      amplitude: groupAmplitude,
      width: groupWidth,
      nearbyModes: currentGroup.flatMap(f => f.nearbyModes)
    });
  } else {
    consolidated.push(currentGroup[0]);
  }
  
  return consolidated;
}

export function analyzeResponseFeatures(
  roomResponse: ModeResponse[],
  roomModes: RoomModeInfo[],
  schroederFreq: number
): EnhancedFeature[] {
  const basicFeatures = detectResponseFeatures(roomResponse, schroederFreq);
  const enhancedFeatures: EnhancedFeature[] = [];

  for (const feature of basicFeatures) {
    // Find nearby room modes (within ±10% frequency)
    const freqTolerance = feature.frequency * 0.1;
    const nearbyModes = roomModes.filter(mode => 
      Math.abs(mode.frequency - feature.frequency) < freqTolerance
    );

    // Determine if this is a null based on surrounding response
    const isNull = analyzeIfNull(roomResponse, feature.frequency, feature.amplitude);
    
    let correctionStrategy: 'cut' | 'boost' | 'fill_around' | 'ignore';
    let nullDepth: number | undefined;

    if (isNull) {
      nullDepth = calculateNullDepth(roomResponse, feature.frequency);
      const nullWidth = estimateNullWidth(roomResponse, feature.frequency);
      
      console.log(`🔍 NULL ANALYSIS at ${feature.frequency.toFixed(1)}Hz: depth=${nullDepth.toFixed(1)}dB, width=${nullWidth.toFixed(1)}Hz`);
      
      // PROFESSIONAL NULL HANDLING - Much more conservative than before
      if (nullDepth > 15) {
        correctionStrategy = 'ignore'; // Very deep nulls - impossible to fix
        console.log(`  ❌ IGNORE: Very deep null (${nullDepth.toFixed(1)}dB > 15dB)`);
      } else if (nullDepth > 10) {
        correctionStrategy = 'fill_around'; // Deep nulls - fill around instead
        console.log(`  🔄 FILL_AROUND: Deep null (${nullDepth.toFixed(1)}dB > 10dB)`);
      } else if (nullDepth > 6 && nullWidth < 6) {
        correctionStrategy = 'fill_around'; // Narrow deep nulls - likely modal
        console.log(`  🔄 FILL_AROUND: Narrow deep null (${nullDepth.toFixed(1)}dB > 6dB, width ${nullWidth.toFixed(1)}Hz < 6Hz)`);
      } else if (nullDepth > 8) {
        correctionStrategy = 'ignore'; // Still too deep for safe boosting
        console.log(`  ❌ IGNORE: Too deep for safe boost (${nullDepth.toFixed(1)}dB > 8dB)`);
      } else {
        // CONSERVATIVE BOOSTING - Only for shallow, wide nulls
        correctionStrategy = 'boost'; 
        console.log(`  ⚠️ BOOST: Shallow null (${nullDepth.toFixed(1)}dB <= 6dB) - conservative boost allowed`);
      }
    } else {
      // Peak handling - always cut peaks
      correctionStrategy = 'cut';
      console.log(`🔼 PEAK at ${feature.frequency.toFixed(1)}Hz: ${feature.prominence.toFixed(1)}dB prominence - CUT`);
    }

    enhancedFeatures.push({
      ...feature,
      isNull,
      nullDepth,
      nearbyModes,
      correctionStrategy
    });
  }

  console.log(`🔬 Enhanced feature analysis: ${enhancedFeatures.length} features detected`);
  console.log(`   Nulls: ${enhancedFeatures.filter(f => f.isNull).length} (${enhancedFeatures.filter(f => f.correctionStrategy === 'ignore').length} ignored, ${enhancedFeatures.filter(f => f.correctionStrategy === 'fill_around').length} fill-around, ${enhancedFeatures.filter(f => f.correctionStrategy === 'boost').length} boost)`);
  console.log(`   Peaks: ${enhancedFeatures.filter(f => !f.isNull).length} (all cut)`);
  
  return enhancedFeatures;
}

/**
 * Analyze if a feature is a null (destructive interference) vs peak
 */
function analyzeIfNull(response: ModeResponse[], frequency: number, amplitude: number): boolean {
  const targetIndex = response.findIndex(p => Math.abs(p.freq - frequency) < 1);
  if (targetIndex === -1) return false;

  // Look at surrounding frequencies (±15Hz range for better analysis)
  const surroundingRange = 15;
  const surroundingPoints = response.filter(p => 
    Math.abs(p.freq - frequency) > 3 && 
    Math.abs(p.freq - frequency) <= surroundingRange
  );

  if (surroundingPoints.length === 0) return false;

  // Calculate average and maximum of surrounding area
  const surroundingAvg = surroundingPoints.reduce((sum, p) => sum + p.db, 0) / surroundingPoints.length;
  const surroundingMax = Math.max(...surroundingPoints.map(p => p.db));
  const currentLevel = response[targetIndex].db;

  // ENHANCED NULL DETECTION - Professional criteria:
  const depthFromAvg = surroundingAvg - currentLevel;
  const depthFromMax = surroundingMax - currentLevel;
  
  // Professional null detection criteria (more aggressive):
  const isDeepNull = depthFromAvg > 6;        // >6dB below average (was 3dB)
  const isVeryDeepNull = depthFromMax > 10;   // >10dB below peak surrounding
  const isNarrowNull = estimateNullWidth(response, frequency) < 8; // Narrow dip <8Hz
  
  // Any of these conditions indicate a likely null
  return isDeepNull || isVeryDeepNull || (depthFromAvg > 4 && isNarrowNull);
}

/**
 * Estimate the width of a null for better detection
 */
function estimateNullWidth(response: ModeResponse[], frequency: number): number {
  const targetIndex = response.findIndex(p => Math.abs(p.freq - frequency) < 1);
  if (targetIndex === -1) return 0;
  
  const targetLevel = response[targetIndex].db;
  const halfDepthThreshold = targetLevel + 3; // 3dB above the null level
  
  let leftFreq = frequency;
  let rightFreq = frequency;
  
  // Find left edge
  for (let i = targetIndex - 1; i >= 0; i--) {
    if (response[i].db > halfDepthThreshold) {
      leftFreq = response[i].freq;
      break;
    }
  }
  
  // Find right edge  
  for (let i = targetIndex + 1; i < response.length; i++) {
    if (response[i].db > halfDepthThreshold) {
      rightFreq = response[i].freq;
      break;
    }
  }
  
  return rightFreq - leftFreq;
}

/**
 * Professional null depth calculation with enhanced criteria
 */
function calculateNullDepth(response: ModeResponse[], frequency: number): number {
  const targetIndex = response.findIndex(p => Math.abs(p.freq - frequency) < 1);
  if (targetIndex === -1) return 0;

  // Get surrounding area (±12Hz for more accurate analysis)
  const surroundingPoints = response.filter(p => 
    Math.abs(p.freq - frequency) > 2 && 
    Math.abs(p.freq - frequency) <= 12
  );

  if (surroundingPoints.length === 0) return 0;

  // Use both average and maximum for more accurate depth assessment
  const surroundingAvg = surroundingPoints.reduce((sum, p) => sum + p.db, 0) / surroundingPoints.length;
  const surroundingMax = Math.max(...surroundingPoints.map(p => p.db));
  const currentLevel = response[targetIndex].db;

  // Return the more conservative (larger) depth measurement
  return Math.max(surroundingAvg - currentLevel, surroundingMax - currentLevel);
}

/**
 * Interpolate response value at a given frequency
 */
function interpolateResponse(
  dbMap: Map<number, number>,
  response: ModeResponse[],
  targetFreq: number
): number {
  // Try direct lookup first
  const directValue = dbMap.get(targetFreq);
  if (directValue !== undefined) {
    return directValue;
  }

  // Find bracketing frequencies for interpolation
  let lowerIdx = -1;
  let upperIdx = -1;

  for (let i = 0; i < response.length - 1; i++) {
    if (response[i].freq <= targetFreq && response[i + 1].freq >= targetFreq) {
      lowerIdx = i;
      upperIdx = i + 1;
      break;
    }
  }

  // Handle edge cases
  if (lowerIdx === -1) {
    if (targetFreq < response[0].freq) {
      return response[0].db;
    } else {
      return response[response.length - 1].db;
    }
  }

  // Linear interpolation in log-frequency space
  const f1 = response[lowerIdx].freq;
  const f2 = response[upperIdx].freq;
  const db1 = response[lowerIdx].db;
  const db2 = response[upperIdx].db;

  return interpolate(targetFreq, f1, f2, db1, db2);
}

/**
 * Apply EQ settings to a response curve
 */
export function applyEQToResponse(
  originalResponse: ModeResponse[],
  eqSettings: EQSettings
): ModeResponse[] {
  if (!eqSettings.enabled || !eqSettings.bands.length) {
    return originalResponse;
  }

  console.log('🎛️ Applying EQ to response:', {
    originalPoints: originalResponse.length,
    bands: eqSettings.bands.length,
    firstOriginalPoint: originalResponse[0],
    lastOriginalPoint: originalResponse[originalResponse.length - 1],
    eqBands: eqSettings.bands.slice(0, 5).map(b => `${b.frequency}Hz: ${b.gain}dB Q=${b.q}`)
  });

  // Check for specific bands around 34Hz for debugging
  const troubleshootBands = eqSettings.bands.filter(b => Math.abs(b.frequency - 34) < 2);
  if (troubleshootBands.length > 0) {
    console.log('🔧 Troubleshooting bands near 34Hz:', troubleshootBands);
  }

  return originalResponse.map((point, index) => {
    let totalGain = 0;
    const individualGains: Array<{band: EQBand, gain: number}> = [];

    // Apply each EQ band
    for (const band of eqSettings.bands) {
      const gain = calculateBandResponse(point.freq, band);
      
      // Safety check for invalid gains
      if (isNaN(gain) || !isFinite(gain)) {
        console.warn(`Invalid EQ gain calculated: ${gain} for freq ${point.freq}, band ${band.frequency}`);
        continue;
      }
      
      totalGain += gain;
      
      // Track individual band contributions for debugging
      if (Math.abs(gain) > 0.1) {
        individualGains.push({band, gain});
      }
    }

    // Debug around 34Hz specifically
    if (point.freq >= 33 && point.freq <= 35 && totalGain !== 0) {
      console.log(`🎯 EQ Application at ${point.freq}Hz:`);
      console.log(`  Original: ${point.db.toFixed(1)}dB`);
      console.log(`  Individual band contributions:`);
      individualGains.forEach(({band, gain}) => {
        console.log(`    ${band.frequency}Hz (${band.gain}dB, Q=${band.q}): ${gain.toFixed(2)}dB`);
      });
      console.log(`  Total EQ gain: ${totalGain.toFixed(2)}dB`);
      console.log(`  Final result: ${(point.db + totalGain).toFixed(1)}dB`);
    }

    // Safety check for total gain
    if (isNaN(totalGain) || !isFinite(totalGain)) {
      console.warn(`Invalid total EQ gain: ${totalGain} for freq ${point.freq}`);
      totalGain = 0;
    }

    // Apply the EQ gain to the original response
    const finalDb = point.db + totalGain;
    
    // Debug key points for general overview
    if (index === 0 || index === 1 || index === originalResponse.length - 1) {
      console.log(`  Point ${index}: ${point.freq}Hz: ${point.db.toFixed(1)}dB + ${totalGain.toFixed(2)}dB EQ = ${finalDb.toFixed(1)}dB`);
    }
    
    // Clamp the final result to reasonable bounds for audio 
    const clampedDb = Math.max(-80, Math.min(130, finalDb));

    return {
      freq: point.freq,
      db: clampedDb
    };
  });
}

/**
 * Export EQ settings to text format
 */
export function exportEQToText(eqSettings: EQSettings): string {
  if (!eqSettings.enabled || !eqSettings.bands.length) {
    return "No EQ bands configured";
  }

  let output = "# Parametric EQ Settings\n";
  output += `# Generated by Sonic Room\n`;
  output += `# Max Boost: ${eqSettings.maxBoost}dB, Max Cut: ${eqSettings.maxCut}dB\n\n`;
  output += "Band\tFreq(Hz)\tGain(dB)\tQ\tType\n";
  
  eqSettings.bands.forEach((band, index) => {
    output += `${index + 1}\t${band.frequency}\t${band.gain >= 0 ? '+' : ''}${band.gain}\t${band.q}\t${band.type}\n`;
  });
  
  return output;
}

/**
 * Export EQ settings to REW format
 */
export function exportEQToREW(eqSettings: EQSettings): string {
  if (!eqSettings.enabled || !eqSettings.bands.length) {
    return "";
  }

  let output = "# Parametric EQ Settings\n";
  output += "# Generated by Sonic Room\n\n";
  
  eqSettings.bands.forEach((band, index) => {
    // REW format: Filter N: ON PK Fc XXXX Hz Gain XX.X dB Q XX.X
    output += `Filter ${index + 1}: ON PK Fc ${band.frequency} Hz Gain ${band.gain} dB Q ${band.q}\n`;
  });
  
  return output;
}

/**
 * Calculate optimal initial offset for Harman target curve
 * Analyzes room response in the midband region (80-200Hz) and finds best alignment
 */
export function calculateOptimalHarmanOffset(
  roomResponse: ModeResponse[],
  harmanTargetData: ModeResponse[]
): number {
  if (!roomResponse.length || !harmanTargetData.length) {
    return 0;
  }

  // Focus on midband region where alignment is most meaningful (80-200Hz)
  const ANALYSIS_FREQ_MIN = 80;
  const ANALYSIS_FREQ_MAX = 200;
  
  // Filter both responses to analysis range
  const roomMidband = roomResponse.filter(p => 
    p.freq >= ANALYSIS_FREQ_MIN && p.freq <= ANALYSIS_FREQ_MAX
  );
  const harmanMidband = harmanTargetData.filter(p => 
    p.freq >= ANALYSIS_FREQ_MIN && p.freq <= ANALYSIS_FREQ_MAX
  );
  
  if (roomMidband.length < 3 || harmanMidband.length < 3) {
    return 0; // Not enough data for meaningful analysis
  }
  
  // Calculate average levels in the analysis range
  const roomAverage = roomMidband.reduce((sum, p) => sum + p.db, 0) / roomMidband.length;
  const harmanAverage = harmanMidband.reduce((sum, p) => sum + p.db, 0) / harmanMidband.length;
  
  // Calculate the offset needed to align averages
  const initialOffset = roomAverage - harmanAverage;
  
  // Apply some constraints to keep the offset reasonable
  // Typical room responses are around 70-90dB, Harman target is around 0-4dB in midband
  // So reasonable offsets would be in the range of 60-90dB
  const MIN_OFFSET = 60;
  const MAX_OFFSET = 95;
  
  const clampedOffset = Math.max(MIN_OFFSET, Math.min(MAX_OFFSET, initialOffset));
  
  // Round to nearest 0.5dB for cleaner values
  return Math.round(clampedOffset * 2) / 2;
}

/**
 * Analyze response after EQ to detect new problems created by boosting
 * (like peaks created between boosted nulls)
 */
interface PostEQProblem {
  frequency: number;
  type: 'peak' | 'overshoot';
  severity: number; // dB above target
  cause: 'boost_interaction' | 'overcorrection';
}

function analyzePostEQProblems(
  eqResponse: ModeResponse[],
  targetResponse: ModeResponse[],
  appliedBands: EQBand[],
  schroederFreq: number
): PostEQProblem[] {
  const problems: PostEQProblem[] = [];
  
  // Find boost bands that might interact
  const boostBands = appliedBands.filter(band => band.gain > 0);
  
  if (boostBands.length < 2) return problems; // Need at least 2 boost bands to interact
  
  // Check for interaction peaks between boost bands - MUCH more thorough
  for (let i = 0; i < boostBands.length - 1; i++) {
    const band1 = boostBands[i];
    const band2 = boostBands[i + 1];
    
    // Check nearby bands that could interact - expanded range
    if (Math.abs(band2.frequency - band1.frequency) > 80) continue; // Expanded from 50Hz
    
    // Check frequencies between the two boost bands - MORE thorough scanning
    const startFreq = Math.min(band1.frequency, band2.frequency);
    const endFreq = Math.max(band1.frequency, band2.frequency);
    const midFreq = (startFreq + endFreq) / 2;
    
    // Check around the midpoint with finer resolution
    for (let checkFreq = midFreq - 8; checkFreq <= midFreq + 8; checkFreq += 0.5) { // Finer resolution
      const eqPoint = eqResponse.find(p => Math.abs(p.freq - checkFreq) < 0.5);
      const targetPoint = targetResponse.find(p => Math.abs(p.freq - checkFreq) < 0.5);
      
      if (!eqPoint || !targetPoint) continue;
      
      const overshoot = eqPoint.db - targetPoint.db;
      
      // MUCH more aggressive criteria: Flag if >2dB above target (was 3dB)
      if (overshoot > 2) {
        problems.push({
          frequency: checkFreq,
          type: 'peak',
          severity: overshoot,
          cause: 'boost_interaction'
        });
        
        console.log(`  🔍 Detected boost interaction: ${band1.frequency}Hz + ${band2.frequency}Hz → peak at ${checkFreq.toFixed(1)}Hz (+${overshoot.toFixed(1)}dB)`);
        break; // One problem per band pair
      }
    }
  }
  
  // Check for general overcorrection (too much boost) - MORE aggressive
  for (const band of boostBands) {
    const eqPoint = eqResponse.find(p => Math.abs(p.freq - band.frequency) < 1);
    const targetPoint = targetResponse.find(p => Math.abs(p.freq - band.frequency) < 1);
    
    if (!eqPoint || !targetPoint) continue;
    
    const overshoot = eqPoint.db - targetPoint.db;
    
    // Flag if boost overshot target by >3dB (was 4dB)
    if (overshoot > 3) {
      problems.push({
        frequency: band.frequency,
        type: 'overshoot',
        severity: overshoot,
        cause: 'overcorrection'
      });
    }
  }
  
  return problems;
}

/**
 * Generate corrective bands to fix problems created by boosting
 * UPDATED: Much more aggressive correction
 */
function generateCorrectiveBands(
  problems: PostEQProblem[],
  maxCorrectiveBands: number
): EQBand[] {
  const correctiveBands: EQBand[] = [];
  
  // Sort problems by severity and take the worst ones
  const sortedProblems = problems.sort((a, b) => b.severity - a.severity);
  
  for (let i = 0; i < Math.min(sortedProblems.length, maxCorrectiveBands); i++) {
    const problem = sortedProblems[i];
    
    // Generate a cut band to fix the problem - MUCH more aggressive
    const correctionGain = -problem.severity * 0.95; // 95% correction (was 80%) - almost full correction
    
    // Use higher Q for more precise corrective cuts
    const correctionQ = problem.type === 'peak' ? 3.5 : 2.5; // Higher Q (was 2.5, 1.8)
    
    correctiveBands.push({
      frequency: Math.round(problem.frequency * 10) / 10,
      gain: Math.round(correctionGain * 10) / 10,
      q: correctionQ,
      type: 'peak'
    });
    
    console.log(`  🔧 Corrective band: ${problem.frequency.toFixed(1)}Hz ${correctionGain.toFixed(1)}dB Q=${correctionQ.toFixed(1)} (fixing ${problem.type})`);
  }
  
  return correctiveBands;
}

/**
 * Generate EQ Pass 1: Aggressive broad corrections 
 * Returns the EQ settings and the corrected response
 */
export async function generateEQPass1(
  roomResponse: ModeResponse[],
  targetResponse: ModeResponse[],
  options: {
    numBands?: number;
    maxBoost?: number;
    maxCut?: number;
    smoothing?: number;
    minQ?: number;
    maxQ?: number;
    schroederFreq?: number;
  } = {}
): Promise<{ eqSettings: EQSettings; correctedResponse: ModeResponse[] }> {
  const {
    numBands = 20,
    maxBoost = 12.0,
    maxCut = 18.0,
    smoothing = 0.02,
    minQ = 0.7,
    maxQ = 10.0,
    schroederFreq = 200
  } = options;

  console.log(`🔄 === PASS 1: AGGRESSIVE Major Corrections ===`);
  
  const pass1MaxBands = Math.ceil(numBands * 0.4);
  const pass1Bands = generateEQPass(
    roomResponse,
    targetResponse,
    {
      maxBands: pass1MaxBands,
      passType: 'broad',
      maxBoost: maxBoost * 0.95,
      maxCut: maxCut * 0.95,
      minQ: minQ,
      maxQ: Math.min(maxQ, 6.0),
      smoothing: smoothing * 0.8,
      schroederFreq
    }
  );

  const pass1EQSettings: EQSettings = {
    bands: pass1Bands,
    enabled: true,
    maxBoost,
    maxCut,
    smoothing
  };
  
  const correctedResponse = applyEQToResponse(roomResponse, pass1EQSettings);
  
  // Check for boost interaction problems and add corrective bands
  const newProblems = analyzePostEQProblems(correctedResponse, targetResponse, pass1Bands, schroederFreq);
  if (newProblems.length > 0) {
    console.log(`⚠️ POST-EQ ANALYSIS: Found ${newProblems.length} new problems created by boosting`);
    const correctiveBands = generateCorrectiveBands(newProblems, pass1MaxBands - pass1Bands.length);
    pass1Bands.push(...correctiveBands);
    
    // Recalculate with corrective bands
    const finalPass1EQSettings: EQSettings = {
      bands: pass1Bands,
      enabled: true,
      maxBoost,
      maxCut,
      smoothing
    };
    const finalCorrectedResponse = applyEQToResponse(roomResponse, finalPass1EQSettings);
    
    console.log(`✅ Pass 1 complete: ${pass1Bands.length} bands (${correctiveBands.length} corrective)`);
    return { eqSettings: finalPass1EQSettings, correctedResponse: finalCorrectedResponse };
  }

  console.log(`✅ Pass 1 complete: ${pass1Bands.length} bands`);
  return { eqSettings: pass1EQSettings, correctedResponse };
}

/**
 * Generate EQ Pass 2: Ultra-targeted refinement
 * Takes the result from Pass 1 and adds more precision
 */
export async function generateEQPass2(
  pass1Result: { eqSettings: EQSettings; correctedResponse: ModeResponse[] },
  originalResponse: ModeResponse[],
  targetResponse: ModeResponse[],
  options: {
    numBands?: number;
    maxBoost?: number;
    maxCut?: number;
    smoothing?: number;
    minQ?: number;
    maxQ?: number;
    schroederFreq?: number;
  } = {}
): Promise<{ eqSettings: EQSettings; correctedResponse: ModeResponse[] }> {
  const {
    numBands = 20,
    maxBoost = 12.0,
    maxCut = 18.0,
    smoothing = 0.02,
    minQ = 0.7,
    maxQ = 10.0,
    schroederFreq = 200
  } = options;

  console.log(`🔄 === PASS 2: ULTRA-Targeted Refinement ===`);
  
  const pass2MaxBands = Math.ceil(numBands * 0.4);
  const remainingBands = numBands - pass1Result.eqSettings.bands.length;
  const pass2ActualBands = Math.min(pass2MaxBands, remainingBands);
  
  // Analyze the CORRECTED response from Pass 1
  const pass2Bands = generateEQPass(
    pass1Result.correctedResponse,
    targetResponse,
    {
      maxBands: pass2ActualBands,
      passType: 'targeted',
      maxBoost: maxBoost * 0.9,
      maxCut: maxCut * 0.9,
      minQ: minQ * 1.05,
      maxQ: maxQ,
      smoothing: smoothing * 0.7,
      schroederFreq,
      usedFrequencies: new Set(pass1Result.eqSettings.bands.map(b => b.frequency))
    }
  );

  // Combine Pass 1 and Pass 2 bands
  const combinedBands = [...pass1Result.eqSettings.bands, ...pass2Bands];
  const pass2EQSettings: EQSettings = {
    bands: combinedBands,
    enabled: true,
    maxBoost,
    maxCut,
    smoothing
  };
  
  // Apply combined EQ to original response
  const correctedResponse = applyEQToResponse(originalResponse, pass2EQSettings);
  
  console.log(`✅ Pass 2 complete: ${pass2Bands.length} new bands (total: ${combinedBands.length})`);
  return { eqSettings: pass2EQSettings, correctedResponse };
}

/**
 * Generate EQ Pass 3: Precision polishing
 * Takes the result from Pass 2 and adds final refinement
 */
export async function generateEQPass3(
  pass2Result: { eqSettings: EQSettings; correctedResponse: ModeResponse[] },
  originalResponse: ModeResponse[],
  targetResponse: ModeResponse[],
  options: {
    numBands?: number;
    maxBoost?: number;
    maxCut?: number;
    smoothing?: number;
    minQ?: number;
    maxQ?: number;
    schroederFreq?: number;
  } = {}
): Promise<{ eqSettings: EQSettings; correctedResponse: ModeResponse[] }> {
  const {
    numBands = 20,
    maxBoost = 12.0,
    maxCut = 18.0,
    smoothing = 0.02,
    minQ = 0.7,
    maxQ = 10.0,
    schroederFreq = 200
  } = options;

  console.log(`🔄 === PASS 3: PRECISION Polishing ===`);
  
  const remainingBands = numBands - pass2Result.eqSettings.bands.length;
  
  if (remainingBands <= 0) {
    console.log(`⚠️ Pass 3 skipped: All ${numBands} bands used in first 2 passes`);
    return pass2Result;
  }
  
  // Analyze the CORRECTED response from Pass 2
  const pass3Bands = generateEQPass(
    pass2Result.correctedResponse,
    targetResponse,
    {
      maxBands: remainingBands,
      passType: 'polishing',
      maxBoost: maxBoost * 0.8,
      maxCut: maxCut * 0.8,
      minQ: minQ * 1.2,
      maxQ: maxQ,
      smoothing: smoothing * 0.4,
      schroederFreq,
      usedFrequencies: new Set(pass2Result.eqSettings.bands.map(b => b.frequency))
    }
  );

  // Combine all bands
  const allBands = [...pass2Result.eqSettings.bands, ...pass3Bands];
  const finalEQSettings: EQSettings = {
    bands: allBands.sort((a, b) => a.frequency - b.frequency),
    enabled: true,
    maxBoost,
    maxCut,
    smoothing
  };
  
  // Apply final EQ to original response
  const finalCorrectedResponse = applyEQToResponse(originalResponse, finalEQSettings);
  
  console.log(`✅ Pass 3 complete: ${pass3Bands.length} new bands (total: ${allBands.length})`);
  console.log(`🎯 ULTRA-AGGRESSIVE EQ COMPLETE: ${allBands.length}/${numBands} bands`);
  
  return { eqSettings: finalEQSettings, correctedResponse: finalCorrectedResponse };
}

/**
 * Generate optimal EQ with visual feedback callbacks for smooth animations
 * Enhanced version that provides real-time updates for visual effects
 */
export function generateOptimalEQWithVisuals(
  roomResponseWithTilt: ModeResponse[],
  targetResponse: ModeResponse[],
  options: {
    numBands?: number;
    maxBoost?: number;
    maxCut?: number;
    smoothing?: number;
    minQ?: number;
    maxQ?: number;
    schroederFreq?: number;
  } = {},
  visualCallbacks?: {
    onPassStart?: (passNumber: number, passName: string) => void;
    onBandsGenerated?: (passNumber: number, newBands: EQBand[], activeBandFreqs: number[]) => void;
    onPassComplete?: (passNumber: number, totalBands: number, correctedResponse: ModeResponse[]) => void;
    onProgressUpdate?: (message: string) => void;
  }
): Promise<EQSettings> {
  const {
    numBands = 25, // Updated default
    maxBoost = 12.0,
    maxCut = 18.0,
    smoothing = 0.02,
    minQ = 0.7,
    maxQ = 10.0,
    schroederFreq = 200
  } = options;

  if (!roomResponseWithTilt.length || !targetResponse.length) {
    return Promise.resolve({
      bands: [],
      enabled: false,
      maxBoost,
      maxCut,
      smoothing
    });
  }

  console.log(`🎯 Starting ULTRA-AGGRESSIVE 4-PASS EQ with VISUAL EFFECTS (max ${numBands} bands)`);
  visualCallbacks?.onProgressUpdate?.('🎯 Starting 4-Pass EQ Generation with Visual Effects...');
  
  const analysisResponse = roomResponseWithTilt;

  return new Promise((resolve) => {
    const executeVisualPasses = async () => {
      // PASS 1: Aggressive broad corrections (30% of bands)
      const pass1MaxBands = Math.ceil(numBands * 0.3);
      
      visualCallbacks?.onPassStart?.(1, 'AGGRESSIVE Major Corrections');
      visualCallbacks?.onProgressUpdate?.(`🔄 Pass 1: Analyzing major peaks and nulls...`);
      
      const pass1Bands = generateEQPass(
        analysisResponse,
        targetResponse,
        {
          maxBands: pass1MaxBands,
          passType: 'broad',
          maxBoost: maxBoost * 0.95,
          maxCut: maxCut * 0.95,
          minQ: minQ,
          maxQ: Math.min(maxQ, 6.0),
          smoothing: smoothing * 0.8,
          schroederFreq
        }
      );

      // Extract frequencies for visual highlighting
      const pass1Frequencies = pass1Bands.map(b => b.frequency);
      visualCallbacks?.onBandsGenerated?.(1, pass1Bands, pass1Frequencies);
      
      const pass1EQSettings: EQSettings = {
        bands: pass1Bands,
        enabled: true,
        maxBoost,
        maxCut,
        smoothing
      };
      
      const responseAfterPass1 = applyEQToResponse(analysisResponse, pass1EQSettings);
      
      // Check for boost interaction problems
      const newProblems = analyzePostEQProblems(responseAfterPass1, targetResponse, pass1Bands, schroederFreq);
      if (newProblems.length > 0) {
        visualCallbacks?.onProgressUpdate?.(`⚠️ Detected ${newProblems.length} boost interactions - adding corrective bands...`);
        const correctiveBands = generateCorrectiveBands(newProblems, pass1MaxBands - pass1Bands.length);
        pass1Bands.push(...correctiveBands);
        
        // Update visual with corrective bands
        const correctedFrequencies = pass1Bands.map(b => b.frequency);
        visualCallbacks?.onBandsGenerated?.(1, pass1Bands, correctedFrequencies);
      }
      
      const finalResponseAfterPass1 = applyEQToResponse(analysisResponse, { ...pass1EQSettings, bands: pass1Bands });
      
      visualCallbacks?.onPassComplete?.(1, pass1Bands.length, finalResponseAfterPass1);
      visualCallbacks?.onProgressUpdate?.(`✅ Pass 1 Complete: ${pass1Bands.length} bands applied`);
      
      // Visual delay
      await new Promise(resolve => setTimeout(resolve, 250));

      // PASS 2: ULTRA-targeted refinement (30% of bands)
      const pass2MaxBands = Math.ceil(numBands * 0.3);
      const remainingAfterPass1 = numBands - pass1Bands.length;
      const pass2ActualBands = Math.min(pass2MaxBands, remainingAfterPass1);
      
      visualCallbacks?.onPassStart?.(2, 'ULTRA-Targeted Refinement');
      visualCallbacks?.onProgressUpdate?.(`🔄 Pass 2: Analyzing corrected response for refinements...`);
      
      const pass2Bands = generateEQPass(
        finalResponseAfterPass1,
        targetResponse,
        {
          maxBands: pass2ActualBands,
          passType: 'targeted',
          maxBoost: maxBoost * 0.9,
          maxCut: maxCut * 0.9,
          minQ: minQ * 1.05,
          maxQ: maxQ,
          smoothing: smoothing * 0.7,
          schroederFreq,
          usedFrequencies: new Set(pass1Bands.map(b => b.frequency))
        }
      );

      const pass2Frequencies = pass2Bands.map(b => b.frequency);
      visualCallbacks?.onBandsGenerated?.(2, pass2Bands, pass2Frequencies);
      
      const pass2EQSettings: EQSettings = {
        bands: [...pass1Bands, ...pass2Bands],
        enabled: true,
        maxBoost,
        maxCut,
        smoothing
      };
      
      const responseAfterPass2 = applyEQToResponse(analysisResponse, pass2EQSettings);
      
      visualCallbacks?.onPassComplete?.(2, pass2Bands.length, responseAfterPass2);
      visualCallbacks?.onProgressUpdate?.(`✅ Pass 2 Complete: ${pass2Bands.length} additional bands applied`);
      
      // Visual delay
      await new Promise(resolve => setTimeout(resolve, 250));

      // PASS 3: PRECISION polishing (25% of bands)
      const pass3MaxBands = Math.ceil(numBands * 0.25);
      const remainingAfterPass2 = numBands - pass1Bands.length - pass2Bands.length;
      const pass3ActualBands = Math.min(pass3MaxBands, remainingAfterPass2);
      
      if (pass3ActualBands > 0) {
        visualCallbacks?.onPassStart?.(3, 'PRECISION Polishing');
        visualCallbacks?.onProgressUpdate?.(`🔄 Pass 3: High precision polishing...`);
        
        const pass3Bands = generateEQPass(
          responseAfterPass2,
          targetResponse,
          {
            maxBands: pass3ActualBands,
            passType: 'polishing',
            maxBoost: maxBoost * 0.8,
            maxCut: maxCut * 0.8,
            minQ: minQ * 1.2,
            maxQ: maxQ,
            smoothing: smoothing * 0.4,
            schroederFreq,
            usedFrequencies: new Set([...pass1Bands, ...pass2Bands].map(b => b.frequency))
          }
        );

        const pass3Frequencies = pass3Bands.map(b => b.frequency);
        visualCallbacks?.onBandsGenerated?.(3, pass3Bands, pass3Frequencies);
        
        const pass3EQSettings: EQSettings = {
          bands: [...pass1Bands, ...pass2Bands, ...pass3Bands],
          enabled: true,
          maxBoost,
          maxCut,
          smoothing
        };
        
        const responseAfterPass3 = applyEQToResponse(analysisResponse, pass3EQSettings);
        
        visualCallbacks?.onPassComplete?.(3, pass3Bands.length, responseAfterPass3);
        visualCallbacks?.onProgressUpdate?.(`✅ Pass 3 Complete: ${pass3Bands.length} additional bands applied`);
        
        // Visual delay
        await new Promise(resolve => setTimeout(resolve, 250));

        // PASS 4: ULTRA-FINE detail corrections (remaining bands)
        const remainingAfterPass3 = numBands - pass1Bands.length - pass2Bands.length - pass3Bands.length;
        
        if (remainingAfterPass3 > 0) {
          visualCallbacks?.onPassStart?.(4, 'ULTRA-FINE Detail Corrections');
          visualCallbacks?.onProgressUpdate?.(`🔄 Pass 4: Surgical precision final corrections...`);
          
          const pass4Bands = generateEQPass(
            responseAfterPass3,
            targetResponse,
            {
              maxBands: remainingAfterPass3,
              passType: 'ultra-fine',
              maxBoost: maxBoost * 0.7,
              maxCut: maxCut * 0.7,
              minQ: minQ * 1.4,
              maxQ: maxQ,
              smoothing: smoothing * 0.2,
              schroederFreq,
              usedFrequencies: new Set([...pass1Bands, ...pass2Bands, ...pass3Bands].map(b => b.frequency))
            }
          );

          const pass4Frequencies = pass4Bands.map(b => b.frequency);
          visualCallbacks?.onBandsGenerated?.(4, pass4Bands, pass4Frequencies);
          
          const allBands = [...pass1Bands, ...pass2Bands, ...pass3Bands, ...pass4Bands];
          const finalEQSettings: EQSettings = {
            bands: allBands.sort((a, b) => a.frequency - b.frequency),
            enabled: true,
            maxBoost,
            maxCut,
            smoothing
          };
          
          const finalResponse = applyEQToResponse(analysisResponse, finalEQSettings);
          
          visualCallbacks?.onPassComplete?.(4, pass4Bands.length, finalResponse);
          visualCallbacks?.onProgressUpdate?.(`🎉 4-Pass EQ Complete! Total: ${allBands.length} bands applied`);
          
          resolve(finalEQSettings);
        } else {
          const allBands = [...pass1Bands, ...pass2Bands, ...pass3Bands];
          visualCallbacks?.onProgressUpdate?.(`🎉 3-Pass EQ Complete! Total: ${allBands.length} bands applied`);
          
          resolve({
            bands: allBands.sort((a, b) => a.frequency - b.frequency),
            enabled: true,
            maxBoost,
            maxCut,
            smoothing
          });
        }
      } else {
        const allBands = [...pass1Bands, ...pass2Bands];
        visualCallbacks?.onProgressUpdate?.(`🎉 2-Pass EQ Complete! Total: ${allBands.length} bands applied`);
        
        resolve({
          bands: allBands.sort((a, b) => a.frequency - b.frequency),
          enabled: true,
          maxBoost,
          maxCut,
          smoothing
        });
      }
    };

    executeVisualPasses().catch(error => {
      console.error('Error in visual EQ passes:', error);
      visualCallbacks?.onProgressUpdate?.('❌ EQ generation failed');
      resolve({
        bands: [],
        enabled: false,
        maxBoost,
        maxCut,
        smoothing
      });
    });
  });
}

/**
 * Add spectral balance correction for low band counts
 * When we cut low frequencies with limited bands, we need to compensate the higher frequencies
 * to maintain overall spectral balance and prevent relative boost in uncorrected regions
 */
function addSpectralBalanceCorrection(
  existingBands: EQBand[],
  currentResponse: ModeResponse[],
  targetResponse: ModeResponse[],
  maxBands: number,
  maxCut: number,
  schroederFreq: number
): EQBand | null {
  // Don't add if we're at the band limit
  if (existingBands.length >= maxBands) {
    return null;
  }

  // Calculate the total correction applied in the low frequency region (20-120Hz)
  const lowFreqCuts = existingBands.filter(band => 
    band.frequency >= 20 && 
    band.frequency <= 120 && 
    band.gain < 0
  );

  if (lowFreqCuts.length === 0) {
    return null; // No low frequency cuts to compensate for
  }

  // Calculate average cut amount in low frequencies
  const totalLowFreqCut = lowFreqCuts.reduce((sum, band) => sum + Math.abs(band.gain), 0);
  const avgLowFreqCut = totalLowFreqCut / lowFreqCuts.length;

  // Only add compensation if we have significant low frequency cuts
  if (avgLowFreqCut < 2.0) {
    return null; // Not enough cutting to worry about
  }

  // Analyze the high frequency region (150-280Hz) for relative boost
  const highFreqRegion = currentResponse.filter(p => p.freq >= 150 && p.freq <= 280);
  const highFreqTargets = targetResponse.filter(p => p.freq >= 150 && p.freq <= 280);
  
  if (highFreqRegion.length === 0 || highFreqTargets.length === 0) {
    return null;
  }

  // Calculate average error in high frequency region
  let totalHighFreqError = 0;
  let validPoints = 0;
  
  for (const currentPoint of highFreqRegion) {
    const targetPoint = highFreqTargets.find(t => Math.abs(t.freq - currentPoint.freq) < 2);
    if (targetPoint) {
      const error = currentPoint.db - targetPoint.db;
      totalHighFreqError += error;
      validPoints++;
    }
  }

  if (validPoints === 0) return null;
  
  const avgHighFreqError = totalHighFreqError / validPoints;
  
  // Only add compensation if high frequencies are significantly above target
  if (avgHighFreqError < 1.5) {
    return null; // High frequencies aren't problematically elevated
  }

  // Calculate compensation parameters
  const compensationFreq = 200; // Center of the problematic region
  const compensationGain = Math.max(-maxCut * 0.6, -avgHighFreqError * 0.8); // Conservative compensation
  const compensationQ = 0.8; // Broad Q to cover the region
  
  console.log(`    📊 SPECTRAL ANALYSIS: Low freq cuts avg=${avgLowFreqCut.toFixed(1)}dB, High freq error avg=${avgHighFreqError.toFixed(1)}dB`);
  console.log(`    🎯 COMPENSATION: Adding broad cut at ${compensationFreq}Hz to balance spectrum`);

  return {
    frequency: compensationFreq,
    gain: Math.round(compensationGain * 10) / 10,
    q: compensationQ,
    type: 'peak' as const
  };
}
