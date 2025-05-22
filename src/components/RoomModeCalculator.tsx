import { useState, useMemo, useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { RoomControls } from './room-calculator/RoomControls';
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
  DEFAULT_Q_FACTOR
} from '@/utils/roomModeCalculations';
import { MoveIcon } from 'lucide-react';

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

export default function RoomModeCalculator() {
  // State for room dimensions and positions
  const [room, setRoom] = useState<RoomDimensions>({ L: 5, W: 5, H: 3 });
  const [sub, setSub] = useState<Point>({ x: 0.10, y: 0.10, z: 0.85 });
  const [listener, setListener] = useState<Point>({ x: 2.0, y: 4.0, z: 0.55 });
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null);
  const [cameraResetCounter, setCameraResetCounter] = useState(0);
  const [showSpeakerGuidelines, setShowSpeakerGuidelines] = useState(false);
  const [lfCutoffHz, setLfCutoffHz] = useState<number>(30); // Default 30 Hz
  const [useLfCutoff, setUseLfCutoff] = useState<boolean>(true); // Toggle for LF cutoff
  const [airAbsorptionLevel, setAirAbsorptionLevel] = useState<number>(1.0); // Range 0-10, default 1.0
  const [applySpeakerSettings, setApplySpeakerSettings] = useState<boolean>(true);
  const [applySurfaceAbsorption, setApplySurfaceAbsorption] = useState<boolean>(true);
  const [highlightedSurface, setHighlightedSurface] = useState<string | null>(null);
  const [spectralTilt, setSpectralTilt] = useState<number>(-3); // Default -3 dB/octave

  // Surface absorption coefficients (0.01 to 1.0)
  const [surfaceAbsorptions, setSurfaceAbsorptions] = useState({...DEFAULT_SURFACE_ABSORPTIONS});
  const [masterAbsorptionAdjust, setMasterAbsorptionAdjust] = useState<number>(0); // New state for master offset
  const [furnitureFactor, setFurnitureFactor] = useState<number>(0.5); // Default 0.5 (moderately furnished)

  // State for JBL speaker directivity
  const [speakerData, setSpeakerData] = useState<SpeakerData | null>(null);
  const [useAnechoicResponse, setUseAnechoicResponse] = useState(false);
  const [showListeningWindow, setShowListeningWindow] = useState(true); // New state for Listening Window toggle

  // State for speaker selection
  const [availableSpeakers, setAvailableSpeakers] = useState<SpeakerManifestItem[]>([]);
  const [selectedSpeakerPath, setSelectedSpeakerPath] = useState<string | null>(null);

  // State for draggable chart
  const [chartPosition, setChartPosition] = useState<{ top: number; left: number } | null>(null);
  const [isDraggingChart, setIsDraggingChart] = useState(false);
  const dragOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const chartCardRef = useRef<HTMLDivElement>(null);

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
  }, []); // Empty dependency array: runs once on mount

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

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingChart || !chartPosition) return;
      setChartPosition({
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
  }, [isDraggingChart, chartPosition]);

  const handleChartMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!chartCardRef.current) return;
    
    let currentTop = chartPosition?.top;
    let currentLeft = chartPosition?.left;

    if (chartPosition === null) {
        const rect = chartCardRef.current.getBoundingClientRect();
        currentTop = rect.top;
        currentLeft = rect.left;
        setChartPosition({ top: rect.top, left: rect.left });
    }
    
    if (currentTop === undefined || currentLeft === undefined) return;

    setIsDraggingChart(true);
    dragOffset.current = {
      x: e.clientX - currentLeft,
      y: e.clientY - currentTop,
    };
    e.preventDefault();
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
    
    return simulateRoomResponse(sub, listener, L, W, H, 10, finalQ, spectralTilt);
  }, [sub, listener, room, surfaceAbsorptions, applySurfaceAbsorption, spectralTilt, masterAbsorptionAdjust, furnitureFactor]); // Added furnitureFactor

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
  }, [responseWithAirAbsorption, speakerData, useAnechoicResponse, sub, listener]); // Use new state name & Re-evaluate sub/listener dependency

  // Generate initial Harman target curve data
  const harmanTargetData = useMemo(() => {
    if (!rawResponse || rawResponse.length === 0) return []; 
    return rawResponse.map(point => ({
      freq: point.freq,
      db: getHarmanTargetDB(point.freq),
    }));
  }, [rawResponse]);

  // Shift Harman target to align with the middle of the simulated response
  const shiftedHarmanTargetData = useMemo(() => {
    if (!processedResponse || processedResponse.length === 0 || !harmanTargetData || harmanTargetData.length === 0) {
      return harmanTargetData; // Return original or empty if no data
    }

    const sumResponseDb = processedResponse.reduce((acc, point) => acc + point.db, 0);
    const avgResponseDb = sumResponseDb / processedResponse.length;

    const sumHarmanDb = harmanTargetData.reduce((acc, point) => acc + point.db, 0);
    const avgHarmanDb = sumHarmanDb / harmanTargetData.length;

    const offset = avgResponseDb - avgHarmanDb;

    return harmanTargetData.map(point => ({
      ...point,
      db: point.db + offset
    }));
  }, [processedResponse, harmanTargetData]);

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

  const chartStyle: React.CSSProperties = chartPosition
  ? { position: 'fixed', top: chartPosition.top, left: chartPosition.left, touchAction: 'none' }
  : { touchAction: 'none' };

  const selectedSpeakerDisplayName = useMemo(() => {
    if (speakerData && speakerData.metadata && speakerData.metadata.name) {
      return speakerData.metadata.name;
    }
    return undefined; // Or a default name like "Selected Speaker"
  }, [speakerData]);

  return (
    <div className="flex flex-col md:flex-row h-screen gap-4 p-4 bg-gray-100">
      {/* Controls Section (Left) */}
      <div className="md:w-[380px] flex-shrink-0">
        <Card className="h-full shadow-lg">
          <CardContent className="p-0 overflow-y-auto h-full">
            <RoomControls 
              room={room}
              sub={sub}
              listener={listener}
              onRoomChange={handleRoomChange}
              onSubChange={handleSubChange}
              onListenerChange={handleListenerChange}
              lfCutoff={lfCutoffHz}
              onLfCutoffChange={setLfCutoffHz}
              airAbsorption={airAbsorptionLevel}
              onAirAbsorptionChange={setAirAbsorptionLevel}
              surfaceAbsorptions={surfaceAbsorptions}
              onSurfaceAbsorptionChange={setSurfaceAbsorptions}
              onRandomizeAbsorptions={handleRandomizeAbsorptions}
              onResetAbsorptions={handleResetAbsorptions}
              masterAbsorptionAdjust={masterAbsorptionAdjust}
              onMasterAbsorptionAdjustChange={setMasterAbsorptionAdjust}
              spectralTilt={spectralTilt}
              onSpectralTiltChange={setSpectralTilt}
              applySpeakerSettings={applySpeakerSettings}
              onApplySpeakerSettingsChange={setApplySpeakerSettings}
              applySurfaceAbsorption={applySurfaceAbsorption}
              onApplySurfaceAbsorptionChange={setApplySurfaceAbsorption}
              highlightedSurface={highlightedSurface}
              onHighlightSurface={setHighlightedSurface}
              showListeningWindow={showListeningWindow}
              onShowListeningWindowChange={setShowListeningWindow}
              useAnechoicResponse={useAnechoicResponse}
              onUseAnechoicResponseChange={setUseAnechoicResponse}
              availableSpeakers={availableSpeakers}
              selectedSpeakerPath={selectedSpeakerPath}
              onSelectedSpeakerPathChange={setSelectedSpeakerPath}
              furnitureFactor={furnitureFactor}
              onFurnitureFactorChange={setFurnitureFactor}
            />
          </CardContent>
        </Card>
      </div>

      {/* Visualization and Chart Section (Center/Right) */}
      <div className="flex-1 relative min-h-[400px] md:min-h-0">
        <Card className="h-full shadow-lg">
          <CardContent className="h-full p-0">
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
          </CardContent>
        </Card>

        {/* Response Chart (Overlay) */}
        <div 
          ref={chartCardRef}
          className={`z-20 w-full md:w-[500px] lg:w-[650px] xl:w-[750px] h-[70vh] md:h-[75vh] xl:h-[40vh] ${chartPosition ? '' : 'absolute bottom-5 right-5'} flex flex-col`}
          style={chartStyle}
        >
          <Card className="shadow-xl border border-gray-200/50 bg-white/80 backdrop-blur-sm h-full flex flex-col">
            <div 
              onMouseDown={handleChartMouseDown}
              className="p-2 cursor-grab active:cursor-grabbing bg-gray-100/50 border-b border-gray-200/50 flex items-center justify-between"
            >
              <span className="text-xs font-semibold text-gray-600">Room Response (Movable)</span>
              <MoveIcon size={16} className="text-gray-500"/>
            </div>
            <CardContent className="p-3 flex-1 min-h-0">
              <div className="flex-1 min-h-0 h-full">
                 <ResponseChart 
                   response={processedResponse} 
                   harmanTarget={shiftedHarmanTargetData}
                   listeningWindowResponse={showListeningWindow ? listeningWindowCurveData : undefined}
                   selectedSpeakerName={selectedSpeakerDisplayName}
                 />
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* Legend for Visualization - Centered below visualization or as part of it */}
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex justify-center items-center space-x-4 text-xs text-gray-700 z-10 md:hidden">
            <div className="flex items-center bg-white/50 backdrop-blur-sm p-1 rounded">
              <span className="inline-block w-3 h-3 mr-1.5 bg-red-500 rounded-full"></span>
              Subwoofer
            </div>
            <div className="flex items-center bg-white/50 backdrop-blur-sm p-1 rounded">
              <span className="inline-block w-3 h-3 mr-1.5 bg-blue-500 rounded-full"></span>
              Listener
            </div>
        </div>

         <div className="hidden md:flex absolute top-4 right-4 flex-col space-y-2 text-xs text-gray-700 z-10">
            <div className="flex items-center bg-white/80 backdrop-blur-sm p-2 rounded shadow">
              <span className="inline-block w-3 h-3 mr-2 bg-red-500 rounded-full"></span>
              Subwoofer
            </div>
            <div className="flex items-center bg-white/80 backdrop-blur-sm p-2 rounded shadow">
              <span className="inline-block w-3 h-3 mr-2 bg-blue-500 rounded-full"></span>
              Listener
            </div>
             <div className="bg-white/80 backdrop-blur-sm p-2 rounded shadow">
              <span className="italic">Click point to drag</span>
            </div>
            <button 
              onClick={() => setCameraResetCounter(prev => prev + 1)}
              className="bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold py-1.5 px-3 rounded-lg shadow transition-colors duration-150 mt-2"
            >
              Reset Camera
            </button>
            <button 
              onClick={() => setShowSpeakerGuidelines(prev => !prev)}
              className={`${showSpeakerGuidelines ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'} text-white text-xs font-semibold py-1.5 px-3 rounded-lg shadow transition-colors duration-150 mt-2`}
            >
              {showSpeakerGuidelines ? 'Hide Stereo Angle' : 'Show Stereo Angle'}
            </button>
            <button 
              onClick={() => setUseAnechoicResponse(prev => !prev)}
              className={`${useAnechoicResponse ? 'bg-purple-500 hover:bg-purple-600' : 'bg-gray-500 hover:bg-gray-600'} text-white text-xs font-semibold py-1.5 px-3 rounded-lg shadow transition-colors duration-150 mt-2`}
              title={!speakerData ? "Speaker data not loaded" : (useAnechoicResponse ? "Disable Speaker Response" : "Enable Speaker Response")}
              disabled={!speakerData}
            >
              {useAnechoicResponse ? 'Speaker ON' : 'Speaker OFF'}{!speakerData ? ' (Loading...)' : ''}
            </button>
            <button 
              onClick={() => setUseLfCutoff(prev => !prev)}
              className={`${useLfCutoff && applySpeakerSettings ? 'bg-teal-500 hover:bg-teal-600' : 'bg-gray-500 hover:bg-gray-600'} ${!applySpeakerSettings ? 'opacity-50 cursor-not-allowed' : ''} text-white text-xs font-semibold py-1.5 px-3 rounded-lg shadow transition-colors duration-150 mt-2`}
              title={!applySpeakerSettings ? "Speaker Settings are globally OFF" : (useLfCutoff ? `Disable LF Cutoff (${lfCutoffHz} Hz)` : `Enable LF Cutoff (${lfCutoffHz} Hz)`)}
              disabled={!applySpeakerSettings}
            >
              {useLfCutoff && applySpeakerSettings ? `LF Cutoff ON (${lfCutoffHz}Hz)` : 'LF Cutoff OFF'}
            </button>
        </div>

      </div>
    </div>
  );
}
