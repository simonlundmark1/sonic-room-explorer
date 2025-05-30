import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RoomControls } from './room-calculator/RoomControls';
import { PositionControls } from './room-calculator/PositionControls';
import { RoomVisualization } from './room-calculator/RoomVisualization';
import { ResponseChart } from './room-calculator/ResponseChart';
import { 
  Point, 
  RoomDimensions, 
  clampToRoom, 
  simulateRoomResponse, 
  getHarmanTargetDB,
  SpeakerData,
  speakerGainLinear,
  DEFAULT_Q_FACTOR,
  EQSettings,
  EQBand,
  generateOptimalEQ,
  generateOptimalEQWithVisuals,
  generateEQPass1,
  generateEQPass2,
  generateEQPass3,
  applyEQToResponse,
  exportEQToText,
  exportEQToREW,
  calculateSchroederFrequency,
  calculateOptimalHarmanOffset,
  analyzeTargetError,
  generateCorrectionEQ,
  mergeEQSettings,
  type ModeResponse
} from '@/utils/roomModeCalculations';
import { MoveIcon } from 'lucide-react';
import { Button } from "@/components/ui/button";

// Define MIN_DB_VALUE, consistent with roomModeCalculations.ts or choose a suitable one
const MIN_CALC_DB_VALUE = -100;

// Interface for items in the speaker manifest
interface SpeakerManifestItem {
  id: string;
  name: string;
  path: string;
}

const DEFAULT_SURFACE_ABSORPTIONS = {
  front: 0.1,
  back: 0.1,
  left: 0.1,
  right: 0.1,
  ceiling: 0.1,
  floor: 0.1,
};

// Xerox-style dither pattern CSS
const xeroxDitherStyle = {
  backgroundImage: `
    radial-gradient(circle at 25% 25%, #d0d0d0 1px, transparent 1px),
    radial-gradient(circle at 75% 75%, #c0c0c0 1px, transparent 1px),
    radial-gradient(circle at 25% 75%, #d8d8d8 0.5px, transparent 0.5px),
    radial-gradient(circle at 75% 25%, #c8c8c8 0.5px, transparent 0.5px),
    radial-gradient(circle at 50% 50%, #b8b8b8 0.8px, transparent 0.8px),
    radial-gradient(circle at 12.5% 87.5%, #d4d4d4 0.3px, transparent 0.3px),
    radial-gradient(circle at 87.5% 12.5%, #cccccc 0.3px, transparent 0.3px)
  `,
  backgroundSize: '4px 4px, 4px 4px, 2px 2px, 2px 2px, 3px 3px, 1.5px 1.5px, 1.5px 1.5px',
  backgroundPosition: '0 0, 2px 2px, 1px 1px, 3px 3px, 1.5px 1.5px, 0.5px 0.5px, 2.5px 2.5px',
  backgroundColor: '#e8e8e8'
};

export default function RoomModeCalculator() {
  // State for room dimensions and positions
  const [room, setRoom] = useState<RoomDimensions>({ L: 4.8, W: 4.8, H: 2.7 });
  const [sub, setSub] = useState<Point>({ x: 0.38, y: 0.25, z: 0.83 });
  const [listener, setListener] = useState<Point>({ x: 2.0, y: 3.70, z: 0.55 });
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null);
  const [cameraResetCounter, setCameraResetCounter] = useState(0);
  const [showSpeakerGuidelines, setShowSpeakerGuidelines] = useState(false);
  const [lfCutoffHz, setLfCutoffHz] = useState<number>(30); // Default 30 Hz
  const [useLfCutoff, setUseLfCutoff] = useState<boolean>(true); // Toggle for LF cutoff
  const [airAbsorptionLevel, setAirAbsorptionLevel] = useState<number>(1.0); // Range 0-10, default 1.0
  const [applySpeakerSettings, setApplySpeakerSettings] = useState<boolean>(true);
  const [applySurfaceAbsorption, setApplySurfaceAbsorption] = useState<boolean>(true);
  const [highlightedSurface, setHighlightedSurface] = useState<string | null>(null);

  // Surface absorption coefficients (0.01 to 1.0)
  const [surfaceAbsorptions, setSurfaceAbsorptions] = useState({...DEFAULT_SURFACE_ABSORPTIONS});
  const [masterAbsorptionAdjust, setMasterAbsorptionAdjust] = useState<number>(0); // New state for master offset
  const [furnitureFactor, setFurnitureFactor] = useState<number>(0.5); // Default 0.5 (moderately furnished)

  // State for JBL speaker directivity
  const [speakerData, setSpeakerData] = useState<SpeakerData | null>(null);
  const [useAnechoicResponse, setUseAnechoicResponse] = useState(true);
  const [showListeningWindow, setShowListeningWindow] = useState(true); // New state for Listening Window toggle

  // State for Harman curve controls
  const [showHarmanFill, setShowHarmanFill] = useState<boolean>(false); // Toggle for red/blue fill, default OFF
  const [harmanCurveOffset, setHarmanCurveOffset] = useState<number>(0); // Offset in dB, range -20 to +20 (relative to auto baseline)
  const [harmanAutoBaseline, setHarmanAutoBaseline] = useState<number>(0); // Auto-calculated baseline offset
  const [harmanBassRolloffEnabled, setHarmanBassRolloffEnabled] = useState<boolean>(false); // Enable bass rolloff for Harman curve
  const [harmanBassRolloffFreq, setHarmanBassRolloffFreq] = useState<number>(53); // Bass rolloff frequency for Harman curve - changed from 50 to 53
  const [harmanBassRolloffSlope, setHarmanBassRolloffSlope] = useState<number>(36); // Bass rolloff slope for Harman curve - changed from 12 to 36
  const [hasAutoAlignedHarman, setHasAutoAlignedHarman] = useState<boolean>(false); // Track if auto-alignment has been performed

  // State for speaker selection
  const [availableSpeakers, setAvailableSpeakers] = useState<SpeakerManifestItem[]>([]);
  const [selectedSpeakerPath, setSelectedSpeakerPath] = useState<string | null>(null);

  // State for EQ system
  const [eqEnabled, setEqEnabled] = useState<boolean>(false);
  const [eqSettings, setEqSettings] = useState<EQSettings>({
    bands: [],
    enabled: false,
    maxBoost: 12.0, // Increased from 4.0
    maxCut: 18.0,   // Increased from 15.0 
    smoothing: 0.05 // Much reduced smoothing for better target matching
  });
  const [showEQCurve, setShowEQCurve] = useState<boolean>(true);
  const [eqNumBands, setEqNumBands] = useState<number>(25); // Reduced from 25 for more focused correction
  const [eqMaxBoost, setEqMaxBoost] = useState<number>(12.0); // Increased from 9.0
  const [eqMaxCut, setEqMaxCut] = useState<number>(18.0);     // Reduced from 24.0 but still generous
  const [eqSmoothing, setEqSmoothing] = useState<number>(0.05); // Much reduced from 0.1

  // State for draggable chart
  const [isDraggingChart, setIsDraggingChart] = useState(false);
  const dragOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const chartRef = useRef<HTMLDivElement>(null);
  const centralContentRef = useRef<HTMLDivElement>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null); // Ref for the canvas wrapper

  // State for resizable chart
  const [chartTopLeft, setChartTopLeft] = useState<{ top: number; left: number }>({ top: 0, left: 0 }); // Initial pixel values, will be updated by useEffect
  const [chartDimensions, setChartDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 }); // Initial pixel values, will be updated by useEffect
  const [isChartManuallyPositioned, setIsChartManuallyPositioned] = useState(false);
  const [isResizingChart, setIsResizingChart] = useState(false);
  const resizeStartInfo = useRef<{startX: number, startY: number, startWidth: number, startHeight: number} | null>(null);
  const leftScrollableRef = useRef<HTMLDivElement>(null);
  const rightScrollableRef = useRef<HTMLDivElement>(null);
  const [canvasAspectRatio, setCanvasAspectRatio] = useState<string>('16/9');
  const [canvasScale, setCanvasScale] = useState<number>(1);

  // Calculate EQ settings with professional 3-pass system
  const [calculatedEQSettings, setCalculatedEQSettings] = useState<EQSettings>({
    bands: [],
    enabled: false,
    maxBoost: eqMaxBoost,
    maxCut: eqMaxCut,
    smoothing: eqSmoothing
  });

  // Visual effects for EQ iterations
  const [currentEQPass, setCurrentEQPass] = useState<number>(0); // Track which pass we're on (0 = not running, 1-4 = pass number)
  const [activeEQBands, setActiveEQBands] = useState<Set<number>>(new Set()); // Track which bands are being applied this pass
  const [eqIterationProgress, setEqIterationProgress] = useState<string>(''); // Progress message
  const [showPassAnimation, setShowPassAnimation] = useState<boolean>(false); // Trigger animation effects

  useEffect(() => {
    // Fetch available speakers manifest
    fetch('/speakers/speakers.json')
      .then(res => {
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        return res.json();
      })
      .then((data: SpeakerManifestItem[]) => {
        setAvailableSpeakers(data);
        if (data.length > 0 && !selectedSpeakerPath) {
          // Set the first speaker as default if none is selected
          setSelectedSpeakerPath(data[0].path);
        }
      })
      .catch(error => console.error("Failed to load speaker manifest:", error));
  }, [selectedSpeakerPath]); // Added selectedSpeakerPath dependency

  useEffect(() => {
    // Fetch speaker data when selectedSpeakerPath changes
    if (!selectedSpeakerPath) {
      setSpeakerData(null); // Clear speaker data if no path is selected
      return;
    }
    fetch(selectedSpeakerPath)
      .then(res => {
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status} for speaker path: ${selectedSpeakerPath}`);
        }
        return res.json();
      })
      .then(data => setSpeakerData(data as SpeakerData))
      .catch(error => {
        console.error(`Failed to load speaker data from ${selectedSpeakerPath}:`, error);
        setSpeakerData(null); // Clear speaker data on error
      });
  }, [selectedSpeakerPath]); // Re-run when selectedSpeakerPath changes

  // Monitor zoom level and adjust canvas size
  useEffect(() => {
    const updateCanvasSize = () => {
      const viewportHeight = window.innerHeight;
      
      // Keep 16:9 aspect ratio always
      setCanvasAspectRatio('16/9');
      
      // Smooth canvas scaling based on viewport height
      let scale = 1; // Default scale for 100% zoom
      
      // Smooth transition between 900px (scale=1) and 600px (scale=0.5)
      const maxHeight = 900; // Full scale at this height and above
      const minHeight = 600; // Minimum scale at this height and below
      const maxScale = 1.0;   // Scale at maxHeight
      const minScale = 0.5;   // Scale at minHeight
      
      if (viewportHeight >= maxHeight) {
        scale = maxScale;
      } else if (viewportHeight <= minHeight) {
        scale = minScale;
      } else {
        // Linear interpolation between min and max
        const ratio = (viewportHeight - minHeight) / (maxHeight - minHeight);
        scale = minScale + (maxScale - minScale) * ratio;
      }
      
      setCanvasScale(scale);
    };

    updateCanvasSize();
    
    window.addEventListener('resize', updateCanvasSize);
    return () => window.removeEventListener('resize', updateCanvasSize);
  }, []);



  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingChart || !chartTopLeft) return;
      setChartTopLeft({
        top: e.clientY - dragOffset.current.y,
        left: e.clientX - dragOffset.current.x,
      });
    };

    const handleMouseUp = () => {
      setIsDraggingChart(false);
    };

    if (isDraggingChart) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingChart, chartTopLeft]);

  // Effect for chart resizing
  useEffect(() => {
    const handleResizeMouseMove = (e: MouseEvent) => {
      if (!isResizingChart || !resizeStartInfo.current) return;
      const dx = e.clientX - resizeStartInfo.current.startX;
      const dy = e.clientY - resizeStartInfo.current.startY;
      let newWidth = resizeStartInfo.current.startWidth + dx;
      let newHeight = resizeStartInfo.current.startHeight + dy;

      newWidth = Math.max(newWidth, 300);
      newHeight = Math.max(newHeight, 200);

      setChartDimensions({ width: newWidth, height: newHeight });
    };

    const handleResizeMouseUp = () => {
      setIsResizingChart(false);
      resizeStartInfo.current = null;
      document.removeEventListener('mousemove', handleResizeMouseMove);
      document.removeEventListener('mouseup', handleResizeMouseUp);
      document.body.style.userSelect = '';
    };

    if (isResizingChart) {
      document.addEventListener('mousemove', handleResizeMouseMove);
      document.addEventListener('mouseup', handleResizeMouseUp);
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleResizeMouseMove);
      document.removeEventListener('mouseup', handleResizeMouseUp);
      document.body.style.userSelect = '';
    };
  }, [isResizingChart]);

  // Effect for initial and responsive chart positioning (if not manually moved)
  useEffect(() => {
    const updateChartLayout = () => {
      if (canvasAreaRef.current && centralContentRef.current && !isChartManuallyPositioned) {
        const viewportHeight = window.innerHeight;

        // Get central content dimensions for positioning
        const centralRect = centralContentRef.current.getBoundingClientRect();
        
        // Chart width matches central content area width (like before)
        const targetWidth = centralRect.width + 2;
        
        // Chart height based on width ratio and viewport constraints (like before)
        const desiredHeightBasedOnWidth = targetWidth * 0.96; // Decreased by 1% from 0.97 to 0.96
        const maxHeightBasedOnViewport = viewportHeight * 0.426; // Decreased by 1% from 0.43 to 0.426
        const targetHeight = Math.min(desiredHeightBasedOnWidth, maxHeightBasedOnViewport) + 2; // Added 2px

        setChartDimensions({ width: targetWidth, height: targetHeight });

        // Position it at the bottom of the screen by default, moved down by 1rem (16px)
        const targetTop = viewportHeight - targetHeight - 10 + 8 + 2;
        
        // Center the chart horizontally under the central content area, offset by 1rem to the right
        const targetLeft = centralRect.left + (centralRect.width - targetWidth) / 2 + 5; // +16px = +1rem
        
        setChartTopLeft({
          top: targetTop,
          left: targetLeft,
        });
      }
    };

    updateChartLayout();

    window.addEventListener('resize', updateChartLayout);
    return () => window.removeEventListener('resize', updateChartLayout);
  }, [isChartManuallyPositioned, centralContentRef, canvasScale]); // Track canvasScale changes

  const handleChartMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!chartRef.current) return;
    setIsChartManuallyPositioned(true);

    const currentTop = chartTopLeft.top;
    const currentLeft = chartTopLeft.left;

    setIsDraggingChart(true);
    dragOffset.current = {
      x: e.clientX - currentLeft,
      y: e.clientY - currentTop,
    };
    e.preventDefault();
  };

  const handleChartResizeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!chartRef.current) return;
    setIsChartManuallyPositioned(true);
    setIsResizingChart(true);
    resizeStartInfo.current = {
      startX: e.clientX,
      startY: e.clientY,
      startWidth: chartDimensions.width,
      startHeight: chartDimensions.height,
    };
  };

  const handleRandomizeAbsorptions = () => {
    const randomValue = () => parseFloat((0.05 + Math.random() * 0.75).toFixed(2)); // Range 0.05 to 0.80
    setSurfaceAbsorptions({
      front: randomValue(),
      back: randomValue(),
      left: randomValue(),
      right: randomValue(),
      ceiling: randomValue(),
      floor: randomValue(),
    });
  };

  const handleResetAbsorptions = () => {
    setSurfaceAbsorptions({...DEFAULT_SURFACE_ABSORPTIONS});
    // Optionally, also reset masterAbsorptionAdjust if desired, or keep it independent.
    // setMasterAbsorptionAdjust(0); 
  };

  // Calculate room response when inputs change
  const rawResponse = useMemo(() => {
    const { L, W, H } = room;
    // Use a helper for clarity
    const getEffectiveAbsorption = (surfaceKey: keyof typeof DEFAULT_SURFACE_ABSORPTIONS) => {
      return Math.max(0.01, Math.min(1.0, surfaceAbsorptions[surfaceKey] + masterAbsorptionAdjust));
    };

    let currentQ = DEFAULT_Q_FACTOR;

    if (applySurfaceAbsorption) {
      const areaFrontBack = W * H;
      const areaLeftRight = L * H;
      const areaCeilingFloor = L * W;
      const totalArea = 2 * (areaFrontBack + areaLeftRight + areaCeilingFloor);

      if (totalArea > 0) {
        const totalEffectiveAbsorption =
          (getEffectiveAbsorption('front') * areaFrontBack) +
          (getEffectiveAbsorption('back') * areaFrontBack) +
          (getEffectiveAbsorption('left') * areaLeftRight) +
          (getEffectiveAbsorption('right') * areaLeftRight) +
          (getEffectiveAbsorption('ceiling') * areaCeilingFloor) +
          (getEffectiveAbsorption('floor') * areaCeilingFloor);
        
        const alphaAvg = Math.max(0.01, Math.min(1.0, totalEffectiveAbsorption / totalArea));
        currentQ = Math.max(1, Math.min(50, 1.0 / alphaAvg)); 
      } else {
        currentQ = DEFAULT_Q_FACTOR; 
      }
    } // else, currentQ remains DEFAULT_Q_FACTOR set initially
    
    // Adjust Q based on furnitureFactor
    const Q_DAMPING_MIN = 0.3; // Max damping effect (heavily furnished)
    const Q_DAMPING_MAX = 1.0; // No damping effect (empty room)
    // furnitureFactor is from 0 (empty) to 1 (heavily furnished)
    const effectiveFurnitureDampingMultiplier = Q_DAMPING_MAX - (furnitureFactor * (Q_DAMPING_MAX - Q_DAMPING_MIN));
    
    const qAdjustedForFurniture = currentQ * effectiveFurnitureDampingMultiplier;
    const finalQ = Math.max(1, qAdjustedForFurniture);
    
    return simulateRoomResponse(sub, listener, L, W, H, 10, finalQ);
  }, [sub, listener, room, surfaceAbsorptions, applySurfaceAbsorption, masterAbsorptionAdjust, furnitureFactor]); // Added furnitureFactor

  // Apply LF roll-off to the raw modal response
  const responseWithLfRollOff = useMemo(() => {
    // Apply LF cutoff only if NOT using JBL directivity (which has its own roll-off)
    // AND if global speaker settings and LF cutoff are enabled.
    if (useAnechoicResponse || !applySpeakerSettings || !useLfCutoff || !lfCutoffHz || lfCutoffHz <= 0) { // Use new state name
      return rawResponse; 
    }
    return rawResponse.map(point => {
      if (point.freq <= 0) return { ...point }; // Avoid division by zero or issues with 0 Hz
      const ratio = lfCutoffHz / point.freq;
      // 2nd order Butterworth HPF: Gain_dB(f) = -10 * log10(1 + (fc/f)^4)
      const gainDbAdjustment = -10 * Math.log10(1 + Math.pow(ratio, 4));
      return { ...point, db: point.db + gainDbAdjustment };
    });
  }, [rawResponse, lfCutoffHz, useLfCutoff, applySpeakerSettings, useAnechoicResponse]); // Use new state name

  // Apply Air Absorption to the (potentially LF-rolled-off) response
  const responseWithAirAbsorption = useMemo(() => {
    // --- DEBUGGING START ---
    console.log('[AirAbsorption] applySpeakerSettings:', applySpeakerSettings);
    console.log('[AirAbsorption] airAbsorptionLevel:', airAbsorptionLevel);
    // --- DEBUGGING END ---

    if (!applySpeakerSettings || airAbsorptionLevel <= 0) { // Check applySpeakerSettings
      console.log('[AirAbsorption] Skipping calculation.');
      return responseWithLfRollOff; 
    }
    
    const distance = Math.hypot(listener.x - sub.x, listener.y - sub.y, listener.z - sub.z) || 0.1; // Min distance 0.1m to avoid issues
    // --- DEBUGGING START ---
    console.log('[AirAbsorption] sub:', JSON.stringify(sub));
    console.log('[AirAbsorption] listener:', JSON.stringify(listener));
    console.log('[AirAbsorption] Calculated distance:', distance);
    // --- DEBUGGING END ---

    // airAbsorptionLevel (slider 0-10) now represents dB loss at F_REF (20kHz) for 1m distance.
    const F_REF = 20000.0; // Reference frequency (20kHz)

    let loggedFreqCount = 0; // To avoid too many logs

    return responseWithLfRollOff.map(point => {
      if (point.freq <= 0) return { ...point };
      const lossDb = -airAbsorptionLevel * Math.pow(point.freq / F_REF, 2) * distance;
      
      // --- DEBUGGING START ---
      if (loggedFreqCount < 5 || point.freq > 19000) { // Log first few and high frequencies
        console.log(`[AirAbsorption] freq: ${point.freq.toFixed(2)} Hz, initial dB: ${point.db.toFixed(2)}, lossDb: ${lossDb.toFixed(2)}, final dB: ${(point.db + lossDb).toFixed(2)}`);
        if (point.freq > 19000) loggedFreqCount = 5; // ensure we log at least one high freq if available
        else loggedFreqCount++;
      }
      // --- DEBUGGING END ---
      
      return { ...point, db: point.db + lossDb };
    });
  }, [responseWithLfRollOff, airAbsorptionLevel, sub, listener, applySpeakerSettings]);

  // Process response with speaker directivity if enabled
  const processedResponse = useMemo(() => {
    // Start with the response that has LF and Air Absorption applied
    const baseResponse = responseWithAirAbsorption; // Changed from responseWithHfRollOff

    if (useAnechoicResponse && speakerData && baseResponse.length > 0) {
      return baseResponse.map(point => {
        const magnitudeBeforeDirectivity = 10**(point.db / 20);
        // Call speakerGainLinear without angle arguments
        const directivityLinearGain = speakerGainLinear(speakerData, point.freq);
        const finalMagnitude = magnitudeBeforeDirectivity * directivityLinearGain;
        let finalDb = 20 * Math.log10(Math.max(1e-9, finalMagnitude)); // Avoid log(0)
        finalDb = Math.max(MIN_CALC_DB_VALUE, finalDb); // Ensure not below min dB
        return { ...point, db: finalDb };
      });
    }
    // If not using JBL directivity, the processed response is just the one with LF/Air Absorption
    return baseResponse;
  }, [responseWithAirAbsorption, speakerData, useAnechoicResponse]);

  // Generate initial Harman target curve data with optional bass rolloff
  const harmanTargetData = useMemo(() => {
    if (!rawResponse || rawResponse.length === 0) return []; 
    return rawResponse.map(point => ({
      freq: point.freq,
      db: getHarmanTargetDB(
        point.freq,
        harmanBassRolloffEnabled ? harmanBassRolloffFreq : undefined,
        harmanBassRolloffEnabled ? harmanBassRolloffSlope : undefined
      ),
    }));
  }, [rawResponse, harmanBassRolloffEnabled, harmanBassRolloffFreq, harmanBassRolloffSlope]);

  // Auto-align Harman curve when processed response is first available
  useEffect(() => {
    if (!hasAutoAlignedHarman && processedResponse.length > 0 && harmanTargetData.length > 0) {
      const optimalOffset = calculateOptimalHarmanOffset(processedResponse, harmanTargetData);
      setHarmanAutoBaseline(optimalOffset - 3.0); // Apply -3dB offset to auto-alignment
      setHarmanCurveOffset(0); // Reset offset to 0 relative to new baseline
      setHasAutoAlignedHarman(true);
      console.log(`🎯 Auto-aligned Harman curve with -3dB offset: ${(optimalOffset - 3.0).toFixed(1)}dB`);
    }
  }, [processedResponse, harmanTargetData, hasAutoAlignedHarman]);

  // Reset auto-alignment flag when room dimensions or key parameters change significantly
  useEffect(() => {
    setHasAutoAlignedHarman(false);
  }, [room.L, room.W, room.H, selectedSpeakerPath, useAnechoicResponse]);

  // Auto-enable bass rolloff when EQ generation is enabled
  useEffect(() => {
    if (eqEnabled && !harmanBassRolloffEnabled) {
      setHarmanBassRolloffEnabled(true);
      console.log('🎚️ Auto-enabled bass rolloff for EQ generation (53Hz, 36dB/octave)');
    }
  }, [eqEnabled, harmanBassRolloffEnabled]);

  // Apply user offset to Harman target (baseline + user adjustment)
  const shiftedHarmanTargetData = useMemo(() => {
    if (!harmanTargetData || harmanTargetData.length === 0) {
      return harmanTargetData; // Return original or empty if no data
    }

    // Apply the auto-calculated baseline plus user adjustment
    const totalOffset = harmanAutoBaseline + harmanCurveOffset;
    console.log(`🎚️ Harman Offset: baseline=${harmanAutoBaseline.toFixed(1)}dB + user=${harmanCurveOffset.toFixed(1)}dB = total=${totalOffset.toFixed(1)}dB`);
    
    return harmanTargetData.map(point => ({
      ...point,
      db: point.db + totalOffset
    }));
  }, [harmanTargetData, harmanAutoBaseline, harmanCurveOffset]); // Updated dependencies

  // Prepare Listening Window data for the chart
  const listeningWindowCurveData = useMemo(() => {
    if (!speakerData || !speakerData.freqs || !speakerData.responses.ListeningWindow) {
      return undefined;
    }
    // Ensure freqs and ListeningWindow response have the same length
    if (speakerData.freqs.length !== speakerData.responses.ListeningWindow.length) {
      console.warn("Speaker data frequency and ListeningWindow response arrays have different lengths.");
      return undefined;
    }
    return speakerData.freqs.map((freq, index) => ({
      freq: freq,
      db: speakerData.responses.ListeningWindow[index]
    }));
  }, [speakerData]);

  // Calculate Schroeder frequency for the room
  const schroederFrequency = useMemo(() => {
    // Calculate average absorption from surface absorptions
    const absorptions = Object.values(surfaceAbsorptions);
    const avgAbsorption = absorptions.reduce((sum, abs) => sum + abs, 0) / absorptions.length;
    
    // Apply master absorption adjustment
    const effectiveAbsorption = Math.max(0.01, Math.min(1.0, avgAbsorption + masterAbsorptionAdjust));
    
    return calculateSchroederFrequency(room, effectiveAbsorption);
  }, [room, surfaceAbsorptions, masterAbsorptionAdjust]);

  // Handle surface absorption changes
  const handleSurfaceAbsorptionChange = (surface: string, value: number) => {
    setSurfaceAbsorptions(prev => ({
      ...prev,
      [surface]: value,
    }));
  };

  // Calculate EQ settings using the new visual effects system
  // NOTE: This will only run when manually triggered by Generate button, not when checkbox changes
  const generateEQWithVisualEffects = useCallback(async () => {
    if (!eqEnabled || !processedResponse?.length || !shiftedHarmanTargetData?.length) {
      setCalculatedEQSettings({
        bands: [],
        enabled: false,
        maxBoost: eqMaxBoost,
        maxCut: eqMaxCut,
        smoothing: eqSmoothing
      });
      setCurrentEQPass(0);
      setActiveEQBands(new Set());
      setEqIterationProgress('');
      return;
    }

    console.log(`🎯 Starting VISUAL EQ generation with morphing effects`);
    
    const eqOptions = {
      numBands: eqNumBands,
      maxBoost: eqMaxBoost,
      maxCut: eqMaxCut,
      smoothing: eqSmoothing,
      minQ: 0.7,
      maxQ: 12.0,
      schroederFreq: schroederFrequency
    };

    // Set up visual callbacks for smooth morphing effects
    const visualCallbacks = {
      onPassStart: (passNumber: number, passName: string) => {
        setCurrentEQPass(passNumber);
        setShowPassAnimation(true);
        setEqIterationProgress(`🔄 Pass ${passNumber}: ${passName}`);
        console.log(`🎬 VISUAL: Starting Pass ${passNumber} - ${passName}`);
      },
      
      onBandsGenerated: (passNumber: number, newBands: EQBand[], activeBandFreqs: number[]) => {
        // Highlight the frequencies being corrected with cool morphing effect
        setActiveEQBands(new Set(activeBandFreqs));
        setEqIterationProgress(`✨ Pass ${passNumber}: Applied ${newBands.length} bands at: ${activeBandFreqs.map(f => f.toFixed(0) + 'Hz').join(', ')}`);
        console.log(`🎬 VISUAL: Pass ${passNumber} generated ${newBands.length} bands:`, activeBandFreqs.map(f => f.toFixed(1) + 'Hz'));
        
        // Create temporary intermediate EQ settings for visual feedback
        const intermediateBands = passNumber === 1 ? newBands : 
                                 passNumber === 2 ? [...(calculatedEQSettings.bands || []), ...newBands] :
                                 passNumber === 3 ? [...(calculatedEQSettings.bands || []), ...newBands] :
                                 [...(calculatedEQSettings.bands || []), ...newBands];
        
        setCalculatedEQSettings({
          bands: intermediateBands,
          enabled: true,
          maxBoost: eqMaxBoost,
          maxCut: eqMaxCut,
          smoothing: eqSmoothing
        });
      },
      
      onPassComplete: (passNumber: number, totalBands: number, correctedResponse: ModeResponse[]) => {
        setShowPassAnimation(false);
        setEqIterationProgress(`✅ Pass ${passNumber} Complete: ${totalBands} bands applied`);
        console.log(`🎬 VISUAL: Pass ${passNumber} completed with ${totalBands} bands`);
        
        // Brief pause to show completion
        setTimeout(() => {
          setActiveEQBands(new Set()); // Clear highlighting
        }, 500);
      },
      
      onProgressUpdate: (message: string) => {
        setEqIterationProgress(message);
        console.log(`🎬 VISUAL PROGRESS:`, message);
      }
    };

    // Execute visual EQ generation with morphing effects
    try {
      const finalEQSettings = await generateOptimalEQWithVisuals(processedResponse, shiftedHarmanTargetData, eqOptions, visualCallbacks);
      setCalculatedEQSettings(finalEQSettings);
      setCurrentEQPass(0); // Reset to normal state
      setActiveEQBands(new Set());
      setEqIterationProgress('🎉 4-Pass EQ Generation Complete!');
      console.log(`🎬 VISUAL: Final EQ complete with ${finalEQSettings.bands.length} bands`);
      
      // Clear progress message after a moment
      setTimeout(() => {
        setEqIterationProgress('');
      }, 3000);
    } catch (error) {
      console.error('Visual EQ generation failed:', error);
      setCurrentEQPass(0);
      setActiveEQBands(new Set());
      setEqIterationProgress('❌ EQ generation failed');
    }
  }, [processedResponse, shiftedHarmanTargetData, eqEnabled, eqNumBands, eqMaxBoost, eqMaxCut, eqSmoothing, schroederFrequency, calculatedEQSettings.bands]);

  // Handle Generate EQ button click
  const handleGenerateEQ = () => {
    generateEQWithVisualEffects();
  };

  // Apply EQ to get corrected response
  const eqCorrectedResponse = useMemo(() => {
    console.log('🎛️ EQ Corrected Response Calculation:');
    console.log('  eqEnabled:', eqEnabled);
    console.log('  calculatedEQSettings.enabled:', calculatedEQSettings.enabled);
    console.log('  calculatedEQSettings.bands.length:', calculatedEQSettings.bands.length);
    console.log('  processedResponse.length:', processedResponse.length);
    
    // Debug original response values
    if (processedResponse.length > 0) {
      console.log('  📊 Original processedResponse range:', {
        first: processedResponse[0],
        last: processedResponse[processedResponse.length - 1],
        sample: processedResponse.slice(0, 5).map(p => `${p.freq}Hz: ${p.db.toFixed(1)}dB`)
      });
    }
    
    if (!eqEnabled) {
      console.log('  ❌ EQ disabled, returning undefined');
      return undefined; // Don't show EQ corrected response when EQ is disabled
    }
    
    if (!calculatedEQSettings.enabled || !calculatedEQSettings.bands.length) {
      console.log('  ⚠️ EQ enabled but no bands, returning processedResponse as EQ corrected');
      return processedResponse; // Show original response as "corrected" when no EQ bands
    }
    
    console.log('  ✅ Applying EQ with', calculatedEQSettings.bands.length, 'bands');
    const corrected = applyEQToResponse(processedResponse, calculatedEQSettings);
    console.log('  🎯 EQ corrected response calculated, length:', corrected.length);
    
    return corrected;
  }, [processedResponse, calculatedEQSettings, eqEnabled]);

  // Debug EQ corrected response changes
  useEffect(() => {
    console.log('🔍 EQ Corrected Response changed:', {
      hasData: !!eqCorrectedResponse,
      length: eqCorrectedResponse?.length || 0,
      firstPoint: eqCorrectedResponse?.[0],
      lastPoint: eqCorrectedResponse?.[eqCorrectedResponse.length - 1]
    });
  }, [eqCorrectedResponse]);

  // Generate EQ curve data for visualization
  const eqCurveData = useMemo(() => {
    if (!eqEnabled || !calculatedEQSettings.enabled || !calculatedEQSettings.bands.length || !showEQCurve) {
      return undefined;
    }

    // Create a flat response to apply EQ to, for visualization
    const flatResponse = processedResponse.map(point => ({
      freq: point.freq,
      db: 0 // Flat reference
    }));

    const eqResponse = applyEQToResponse(flatResponse, calculatedEQSettings);
    // Offset by +50dB for better visibility
    return eqResponse.map(point => ({
      freq: point.freq,
      db: point.db + 50
    }));
  }, [processedResponse, calculatedEQSettings, eqEnabled, showEQCurve]);

  // Handle room dimension changes
  const handleRoomChange = (key: keyof RoomDimensions, value: number) => {
    setRoom((prev) => {
      const updated = { ...prev, [key]: value };
      // Ensure points remain inside room
      setSub(clampToRoom(sub, updated));
      setListener(clampToRoom(listener, updated));
      return updated;
    });
  };

  // Handle subwoofer position changes
  const handleSubChange = (key: keyof Point, value: number) => {
    setSub((prev) => ({ ...prev, [key]: value }));
  };

  // Handle listener position changes
  const handleListenerChange = (key: keyof Point, value: number) => {
    setListener((prev) => ({ ...prev, [key]: value }));
  };

  // Handle EQ export
  const handleExportEQ = () => {
    if (!eqEnabled || !calculatedEQSettings.enabled || !calculatedEQSettings.bands.length) {
      alert('No EQ settings to export');
      return;
    }

    const textFormat = exportEQToText(calculatedEQSettings);
    const rewFormat = exportEQToREW(calculatedEQSettings);
    
    // Create a combined export with both formats
    const combinedExport = `# EQ Settings\n${textFormat}\n\n${rewFormat}`;
    
    // Create and download file
    const blob = new Blob([combinedExport], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `room-eq-settings.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Handle auto-align Harman curve
  const handleAutoAlignHarman = () => {
    if (processedResponse.length > 0 && harmanTargetData.length > 0) {
      const optimalOffset = calculateOptimalHarmanOffset(processedResponse, harmanTargetData);
      setHarmanAutoBaseline(optimalOffset - 3.0); // Apply -3dB offset to auto-alignment
      setHarmanCurveOffset(0); // Reset offset to 0 relative to new baseline
    }
  };

  // Effective style for the chart, always fixed position now
  const chartEffectiveStyle: React.CSSProperties = {
    position: 'fixed', // Chart is always fixed now, default position calculated in useEffect
    top: chartTopLeft.top,
    left: chartTopLeft.left,
    width: chartDimensions.width, // Corrected from chartSize
    height: chartDimensions.height, // Corrected from chartSize
    touchAction: 'none',
    overflow: 'hidden',
  };

  const selectedSpeakerDisplayName = useMemo(() => {
    if (speakerData && speakerData.metadata && speakerData.metadata.name) {
      return speakerData.metadata.name;
    }
    return undefined; // Or a default name like "Selected Speaker"
  }, [speakerData]);

  return (
    <>
      {/* Fixed white bar at the top */}
      <div 
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          width: '100vw',
          height: '4.55rem',
          backgroundColor: 'white',
          borderBottom: '1px solid black',
          zIndex: -5,
          pointerEvents: 'none',
          ...xeroxDitherStyle
        }}
      />
      
      <div className="flex flex-row h-screen overflow-hidden bg-transparent">
        {/* Left Sidebar: Room Controls and Settings */}
        <div className=" w-80 flex-shrink-0 h-full text-card-foreground flex flex-col border-r border-black !bg-transparent">
          <CardHeader className="">
            <CardTitle className="text-lg -ml-3">Controls & Settings</CardTitle>
          </CardHeader>
          <div 
            ref={leftScrollableRef}
            className="w-full flex-1 min-h-0 overflow-y-scroll pt-4 pl-1 pr-4 pb-6 space-y-6 [&::-webkit-scrollbar]:w-3 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-black [&::-webkit-scrollbar-thumb]:rounded-none [&::-webkit-scrollbar-thumb:hover]:bg-gray-800 scrollbar-thin !bg-transparent"
            style={{
              scrollbarColor: 'black transparent'
            }}
          >
            <RoomControls
              room={room}
              onRoomChange={handleRoomChange}
              surfaceAbsorptions={surfaceAbsorptions}
              onSurfaceAbsorptionChange={handleSurfaceAbsorptionChange}
              onRandomizeAbsorptions={handleRandomizeAbsorptions}
              onResetAbsorptions={handleResetAbsorptions}
              masterAbsorptionAdjust={masterAbsorptionAdjust}
              onMasterAbsorptionAdjustChange={setMasterAbsorptionAdjust}
              applySurfaceAbsorption={applySurfaceAbsorption}
              onApplySurfaceAbsorptionChange={setApplySurfaceAbsorption}
              highlightedSurface={highlightedSurface}
              onHighlightedSurfaceChange={setHighlightedSurface}
              furnitureFactor={furnitureFactor}
              onFurnitureFactorChange={setFurnitureFactor}

              // Speaker Settings
              useLfCutoff={useLfCutoff}
              onUseLfCutoffChange={setUseLfCutoff}
              airAbsorptionLevel={airAbsorptionLevel}
              onAirAbsorptionLevelChange={setAirAbsorptionLevel}
              applySpeakerSettings={applySpeakerSettings}
              onApplySpeakerSettingsChange={setApplySpeakerSettings}
              availableSpeakers={availableSpeakers}
              selectedSpeakerPath={selectedSpeakerPath}
              onSelectedSpeakerPathChange={setSelectedSpeakerPath}
              useAnechoicResponse={useAnechoicResponse}
              onUseAnechoicResponseChange={setUseAnechoicResponse}
              showListeningWindow={showListeningWindow}
              onShowListeningWindowChange={setShowListeningWindow}

              // Harman Curve Settings
              showHarmanFill={showHarmanFill}
              onShowHarmanFillChange={setShowHarmanFill}
              harmanCurveOffset={harmanCurveOffset}
              onHarmanCurveOffsetChange={setHarmanCurveOffset}
              harmanAutoBaseline={harmanAutoBaseline}
              onHarmanAutoBaselineChange={setHarmanAutoBaseline}
              harmanBassRolloffEnabled={harmanBassRolloffEnabled}
              onHarmanBassRolloffEnabledChange={setHarmanBassRolloffEnabled}
              harmanBassRolloffFreq={harmanBassRolloffFreq}
              onHarmanBassRolloffFreqChange={setHarmanBassRolloffFreq}
              harmanBassRolloffSlope={harmanBassRolloffSlope}
              onHarmanBassRolloffSlopeChange={setHarmanBassRolloffSlope}
              onAutoAlignHarman={handleAutoAlignHarman}

              // EQ Settings
              eqEnabled={eqEnabled}
              onEqEnabledChange={setEqEnabled}
              eqNumBands={eqNumBands}
              onEqNumBandsChange={setEqNumBands}
              eqMaxBoost={eqMaxBoost}
              onEqMaxBoostChange={setEqMaxBoost}
              eqMaxCut={eqMaxCut}
              onEqMaxCutChange={setEqMaxCut}
              eqSmoothing={eqSmoothing}
              onEqSmoothingChange={setEqSmoothing}
              showEQCurve={showEQCurve}
              onShowEQCurveChange={setShowEQCurve}
              eqBandCount={calculatedEQSettings.bands.length}
              onGenerateEQ={handleGenerateEQ}
              onExportEQ={handleExportEQ}
              speakerData={speakerData}
            />
          </div>
        </div>

        {/* Center Content: Visualization and Chart */}
        <div ref={centralContentRef} className="flex flex-col flex-1 relative h-full overflow-hidden bg-transparent">
          
          {/* New Top Bar */}
          <div className="h-[4.55rem] flex-shrink-0 bg-white flex items-center px-4 border-b border-black" style={xeroxDitherStyle}>
            <img src="/assets/logo.png" alt="Room Acoustics Logo" className="h-[3rem] -ml-1" />
          </div>

          {/* Canvas Area - responsive size, 16:9 aspect ratio, centrally positioned */}
          <div className="w-full bg-white flex justify-center items-start border-b border-black">
            <div 
              ref={canvasAreaRef} 
              className="bg-white transition-all duration-300 ease-in-out" 
              style={{ 
                aspectRatio: canvasAspectRatio,
                width: `${canvasScale * 100}%`
              }}
            >
              <RoomVisualization
                room={room}
                sub={sub}
                listener={listener}
                selectedPoint={selectedPoint}
                onSubPositionChange={setSub}
                onListenerPositionChange={setListener}
                onSelectPoint={setSelectedPoint}
                resetTrigger={cameraResetCounter}
                showAngleGuidelines={showSpeakerGuidelines}
                highlightedSurface={highlightedSurface}
              />
            </div>
          </div>

          {/* Response Chart (Overlay - still fixed position, its initial position logic uses centralContentRef) */}
          <div
            ref={chartRef}
            className={`z-20 flex flex-col`}
            style={chartEffectiveStyle}
          >
            <Card className="border border-black bg-white h-full flex flex-col relative">
              <div
                onMouseDown={handleChartMouseDown}
                className="p-2 cursor-grab active:cursor-grabbing bg-white border-b border-black flex items-center justify-between"
                style={xeroxDitherStyle}
              >
                <span className="text-xs font-semibold text-black">Room Response (Movable)</span>
                <MoveIcon size={16} className="text-black"/>
              </div>
              <CardContent className="p-3 flex-1 min-h-0">
                <div className="flex-1 min-h-0 h-full">
                   <ResponseChart
                     response={processedResponse}
                     harmanTarget={shiftedHarmanTargetData}
                     listeningWindowResponse={showListeningWindow ? listeningWindowCurveData : undefined}
                     selectedSpeakerName={selectedSpeakerDisplayName}
                     eqCorrectedResponse={eqCorrectedResponse}
                     eqCurve={eqCurveData}
                     showEQCurve={showEQCurve}
                     showHarmanFill={showHarmanFill}
                     schroederFrequency={schroederFrequency}
                     eqBands={eqEnabled && calculatedEQSettings.enabled ? calculatedEQSettings.bands : undefined}
                     currentEQPass={currentEQPass}
                     activeEQBands={activeEQBands}
                     showPassAnimation={showPassAnimation}
                   />
                </div>
              </CardContent>
              <div
                onMouseDown={handleChartResizeMouseDown}
                style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
                  width: '16px',
                  height: '16px',
                  cursor: 'se-resize',
                  backgroundColor: 'rgba(0, 0, 0, 0.25)',
                  borderTop: '1px solid black',
                  borderLeft: '1px solid black',
                  zIndex: 10
                }}
                title="Resize chart"
              />
            </Card>
          </div>

          {/* Legend for Visualization - Centered below visualization or as part of it */}
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex justify-center items-center space-x-4 text-xs z-10 lg:hidden">
              <div className="flex items-center bg-white border border-black p-1 text-black">
                <span className="inline-block w-3 h-3 mr-1.5 bg-red-500 rounded-full"></span>
                Subwoofer
              </div>
              <div className="flex items-center bg-white border border-black p-1 text-black">
                <span className="inline-block w-3 h-3 mr-1.5 bg-blue-500 rounded-full"></span>
                Listener
              </div>
          </div>

           <div className="hidden lg:flex absolute top-[7.5rem] right-[calc(50%-360px)] flex-col space-y-2 text-xs z-10">
              <div className="flex items-center bg-white border border-black p-2 text-black">
                <span className="inline-block w-3 h-3 mr-2 bg-red-500 rounded-full"></span>
                Subwoofer
              </div>
              <div className="flex items-center bg-white border border-black p-2 text-black">
                <span className="inline-block w-3 h-3 mr-2 bg-blue-500 rounded-full"></span>
                Listener
              </div>
               <div className="bg-white border border-black p-2 text-black">
                <span className="italic">Click point to drag</span>
              </div>
              <Button
                size="xs"
                variant="default"
                onClick={() => setCameraResetCounter(prev => prev + 1)}
                className="text-xs font-semibold"
              >
                Reset Camera
              </Button>
              <Button
                size="xs"
                variant="default"
                onClick={() => setShowSpeakerGuidelines(prev => !prev)}
                className="text-xs font-semibold"
              >
                {showSpeakerGuidelines ? 'Hide Stereo Angle' : 'Show Stereo Angle'}
              </Button>
              <Button
                size="xs"
                variant="default"
                onClick={() => { 
                  const newUseAnechoic = !useAnechoicResponse;
                  setUseAnechoicResponse(newUseAnechoic);
                  setApplySpeakerSettings(newUseAnechoic); 
                }}
                className="text-xs font-semibold"
                title={!speakerData ? "Speaker data not loaded" : (useAnechoicResponse && applySpeakerSettings ? "Disable Speaker Response" : "Enable Speaker Response")}
                disabled={!speakerData}
              >
                {useAnechoicResponse && applySpeakerSettings ? 'Speaker ON' : 'Speaker OFF'}{!speakerData ? ' (Loading...)' : ''}
              </Button>
          </div>
        </div>

        {/* Right Sidebar: Position Controls */}
        <div className="w-[23rem] flex-shrink-0 h-full text-card-foreground flex flex-col border-l border-black !bg-transparent">
          <CardHeader className="">
            <CardTitle className="text-lg ml-2">Object Positions</CardTitle>
          </CardHeader>
          <div 
            ref={rightScrollableRef}
            className="w-full flex-1 min-h-0 overflow-y-scroll pt-4 pl-4 pb-6 scrollbar-thin !bg-transparent"
            style={{
              scrollbarColor: 'black transparent',
              scrollbarWidth: 'thin',
              paddingRight: '0.25rem'
            }}
          >
            <PositionControls
              room={room}
              sub={sub}
              listener={listener}
              onSubChange={handleSubChange}
              onListenerChange={handleListenerChange}
            />
          </div>
        </div>
      </div>
    </>
  );
}