import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Line } from 'react-chartjs-2';
import { HelpCircle } from 'lucide-react';
import { ModeResponse } from '@/utils/roomModeCalculations';
import { EQBand } from '@/utils/roomModeCalculations'; // Import EQBand type
import { 
  Chart as ChartJS,
  LinearScale, // Using LinearScale for both X and Y initially
  PointElement, 
  LineElement,
  Title, // Added for basic chart title
  Tooltip, // Basic tooltip
  Legend,  // Basic legend
  LogarithmicScale, // Added LogarithmicScale
  Filler, // Import Filler plugin
  // Filler // Not using filler in this minimal version
  // LogarithmicScale, // Not using log scale initially
  // CategoryScale, // Not using category if X is linear numeric
  type ChartOptions, // Added import
  type ChartDataset, // Added import
  type ScriptableLineSegmentContext, // Changed from ScriptableContext
  type Color, // Added import
  type Point as ChartPoint // Import Chart.js Point type
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';

// Register necessary Chart.js components
ChartJS.register(
  LinearScale,
  LogarithmicScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler, // Register Filler plugin
  annotationPlugin
  // CategoryScale, // Not needed if X is linear numeric
  // LogarithmicScale, // Not needed initially
  // Filler // Not needed initially
  // Annotation // Register if used
);

// // New Harman target curve function in dB - REMOVED FOR SIMPLICITY
// const getHarmanTargetDB = (freq: number): number => { ... };

interface ResponseChartProps {
  response: ModeResponse[];
  harmanTarget?: ModeResponse[]; // Added harmanTarget (optional)
  listeningWindowResponse?: ModeResponse[]; // New prop for Listening Window
  selectedSpeakerName?: string; // New prop for selected speaker name
  eqCorrectedResponse?: ModeResponse[]; // EQ corrected response
  eqCurve?: ModeResponse[]; // EQ curve for visualization
  showEQCurve?: boolean; // Toggle for EQ curve visibility
  showHarmanFill?: boolean; // Toggle for red/blue fill under/above Harman curve
  schroederFrequency?: number; // Schroeder frequency for the room
  eqBands?: EQBand[]; // EQ bands to display as annotations
  // Visual effects props
  currentEQPass?: number; // Current EQ pass number (0 = not active, 1-4 = pass number)
  activeEQBands?: Set<number>; // Set of active frequency bands being corrected
  showPassAnimation?: boolean; // Whether to show pass animation effects
}

// Throttle utility function for performance optimization
const throttle = <T extends (...args: unknown[]) => void>(func: T, delay: number): ((...args: Parameters<T>) => void) => {
  let timeoutId: NodeJS.Timeout | null = null;
  let lastExecTime = 0;
  return (...args: Parameters<T>) => {
    const currentTime = Date.now();
    
    if (currentTime - lastExecTime > delay) {
      func(...args);
      lastExecTime = currentTime;
    } else {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        func(...args);
        lastExecTime = Date.now();
      }, delay - (currentTime - lastExecTime));
    }
  };
};

export function ResponseChart({ response, harmanTarget, listeningWindowResponse, selectedSpeakerName, eqCorrectedResponse, eqCurve, showEQCurve, showHarmanFill, schroederFrequency, eqBands, currentEQPass, activeEQBands, showPassAnimation }: ResponseChartProps) {
  const chartRef = useRef<ChartJS<"line", (number | ChartPoint | null)[], number> | null>(null); // Update TData type
  const chartContainerRef = useRef<HTMLDivElement>(null);
  
  // Realistic limits for audio measurements
  const LIMITS = {
    FREQ_MIN: 20,  // Don't show anything below 20Hz
    FREQ_MAX: 1000,
    DB_MIN: 0,    // Never show anything below 0 dB
    DB_MAX: 140   // Maximum realistic dB level (threshold of pain ~120dB, with some headroom)
  };

  // Zoom and pan state
  const [zoomState, setZoomState] = useState({
    xMin: 20,
    xMax: 300,
    yMin: 60,  // Changed from -40 to 60 (never go below 0 dB)
    yMax: 100  // Changed from 60 to 100 (better range for typical response around 80 dB)
  });
  
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPoint, setLastPanPoint] = useState<{ x: number; y: number } | null>(null);
  const [crosshairPosition, setCrosshairPosition] = useState<{ x: number; y: number } | null>(null);
  const [hasUserInteracted, setHasUserInteracted] = useState(false); // Track if user has manually interacted

  // Force chart update when crosshair position changes - OPTIMIZED for immediate response
  useEffect(() => {
    if (chartRef.current && crosshairPosition) {
      // Direct annotation update for immediate responsiveness
      const chart = chartRef.current;
      if (chart.options.plugins?.annotation?.annotations) {
        const annotations = chart.options.plugins.annotation.annotations as Record<string, {
          xMin?: number;
          xMax?: number;
          yMin?: number;
          yMax?: number;
        }>;
        if (annotations.crosshairV && annotations.crosshairH) {
          annotations.crosshairV.xMin = crosshairPosition.x;
          annotations.crosshairV.xMax = crosshairPosition.x;
          annotations.crosshairH.yMin = crosshairPosition.y;
          annotations.crosshairH.yMax = crosshairPosition.y;
        }
      }
      chart.update('resize'); // Use 'resize' mode for slightly smoother updates with minimal delay
    }
  }, [crosshairPosition]);

  // REMOVED console.logs for cleaner minimal version
  // useEffect(() => {
  //   console.log('ResponseChart received response prop:', response);
  // }, [response]);

  const chartData = useMemo(() => {
    if (!response || response.length === 0) {
      return {
        labels: [],
        datasets: [],
      };
    }
    // console.log('ResponseChart calculating chartData with response:', response);

    // const simplifiedResponseData = response.map(r => r.gain);
    // console.log('Simplified response data (direct gain):', simplifiedResponseData);

    let harmanDbMap: Map<number, number> | undefined = undefined;
    if (harmanTarget && harmanTarget.length > 0) {
      harmanDbMap = new Map(harmanTarget.map(p => [p.freq, p.db]));
    }

    const simulatedResponseDataset: ChartDataset<'line', (ChartPoint | null)[]> = {
      label: 'Simulated Response (dB)',
      data: response.map(r => ({ x: r.freq, y: r.db })),
      borderColor: 'rgb(0, 0, 0)', // Changed to black
      borderWidth: 2, // Reduced from 3 to 2
      tension: 0.4, // Increased from 0.1 for smoother curves
      pointRadius: 0, // Hidden dots (was 1)
      pointHoverRadius: 3, // Show dots only on hover
      order: 3, // Higher order = lower z-index (drawn behind)
      // fill and segment.backgroundColor will be set conditionally below
    };

    const labels = response.map(r => r.freq);

    if (harmanDbMap && showHarmanFill) {
      simulatedResponseDataset.fill = 1; // Fill towards the next dataset (Harman Target at index 1)
      simulatedResponseDataset.segment = {
        borderColor: (ctx: ScriptableLineSegmentContext): Color | undefined => {
          if (!ctx.p1 || harmanDbMap === undefined) { 
            return 'rgb(0, 0, 0)'; // Changed to black
          }
          const simulatedDb = ctx.p1.parsed.y;
          const freq = ctx.p1.parsed.x;
          if (freq === undefined || simulatedDb === undefined) {
            return 'rgb(0, 0, 0)'; // Changed to black
          }
          const targetDb = harmanDbMap.get(freq);
          if (targetDb === undefined) {
            return 'rgb(0, 0, 0)'; // Changed to black
          }
          const diff = simulatedDb - targetDb;
          const MAX_COLOR_DIFF = 15;
          const MIN_ALPHA_BORDER = 0.4;
          const MAX_ALPHA_BORDER = 1.0;
          if (diff > 1) {
            const intensity = Math.min(1, Math.max(0, diff / MAX_COLOR_DIFF));
            const alpha = MIN_ALPHA_BORDER + (MAX_ALPHA_BORDER - MIN_ALPHA_BORDER) * intensity;
            return `rgba(255, 0, 0, ${alpha.toFixed(2)})`;
          } else if (diff < -1) {
            const intensity = Math.min(1, Math.max(0, Math.abs(diff) / MAX_COLOR_DIFF));
            const alpha = MIN_ALPHA_BORDER + (MAX_ALPHA_BORDER - MIN_ALPHA_BORDER) * intensity;
            return `rgba(0, 0, 255, ${alpha.toFixed(2)})`;
          } else {
            return 'rgb(0, 180, 0)'; // Green for border when within +/- 1dB of target
          }
        },
        backgroundColor: (ctx: ScriptableLineSegmentContext): Color | undefined => {
          if (!ctx.p1 || harmanDbMap === undefined) {
            return 'rgba(0, 0, 0, 0.2)'; // Changed to black with transparency
          }
          const simulatedDb = ctx.p1.parsed.y;
          const freq = ctx.p1.parsed.x;
          if (freq === undefined || simulatedDb === undefined) {
            return 'rgba(0, 0, 0, 0.2)'; // Changed to black with transparency
          }
          const targetDb = harmanDbMap.get(freq);
          if (targetDb === undefined) {
            return 'rgba(0, 0, 0, 0.2)'; // Changed to black with transparency
          }
          const diff = simulatedDb - targetDb;
          const MAX_COLOR_DIFF = 15; // Same as border for consistent intensity scaling
          const MIN_ALPHA_FILL = 0.1; // Minimum alpha for fill
          const MAX_ALPHA_FILL = 0.6; // Maximum alpha for fill

          if (diff > 1) {
            const intensity = Math.min(1, Math.max(0, diff / MAX_COLOR_DIFF));
            const fillAlpha = MIN_ALPHA_FILL + (MAX_ALPHA_FILL - MIN_ALPHA_FILL) * intensity;
            return `rgba(255, 0, 0, ${fillAlpha.toFixed(2)})`; // Dynamic red fill
          } else if (diff < -1) {
            const intensity = Math.min(1, Math.max(0, Math.abs(diff) / MAX_COLOR_DIFF));
            const fillAlpha = MIN_ALPHA_FILL + (MAX_ALPHA_FILL - MIN_ALPHA_FILL) * intensity;
            return `rgba(0, 0, 255, ${fillAlpha.toFixed(2)})`; // Dynamic blue fill
          } else {
            return `rgba(0, 180, 0, ${MIN_ALPHA_FILL.toFixed(2)})`; // Green fill when within +/- 1dB of target
          }
        },
      };
    } else {
      // If no Harman target or fill is disabled, use simple styling
      simulatedResponseDataset.fill = false; // No fill
      simulatedResponseDataset.backgroundColor = 'rgba(0, 0, 0, 0.2)'; // Changed to black with transparency
      simulatedResponseDataset.borderColor = 'rgb(0, 0, 0)'; // Changed to black
      simulatedResponseDataset.borderWidth = 2; // Reduced from 3 to 2
      // Ensure segment is at least an empty object if not defined above
      if (!simulatedResponseDataset.segment) {
        simulatedResponseDataset.segment = {};
      }
    }

    const datasets: ChartDataset<'line', (ChartPoint | null)[]>[] = [simulatedResponseDataset];

    if (harmanTarget && harmanTarget.length > 0) {
      datasets.push({
        label: 'Harman Target (dB)',
        data: harmanTarget.map(r => ({ x: r.freq, y: r.db })),
        borderColor: 'rgb(255, 99, 132)',
        fill: false,
        tension: 0.4, // Increased from 0.1 for smoother curves
        pointRadius: 0, // Hidden dots (was 1)
        pointHoverRadius: 3, // Show dots only on hover
        borderWidth: 2, // Added explicit border width
        order: 4, // Behind simulated response
        // Removed borderDash to make it solid instead of dashed
      } as ChartDataset<'line', (ChartPoint | null)[]>);
    }

    if (listeningWindowResponse && listeningWindowResponse.length > 0) { // Add Listening Window dataset
      datasets.push({
        label: selectedSpeakerName ? `${selectedSpeakerName} (dB)` : 'Listening Window (dB)', // Dynamic label
        data: listeningWindowResponse.map(r => ({ x: r.freq, y: r.db })), // Use {x,y} pairs
        borderColor: 'rgb(255, 159, 64)', // Orange color for Listening Window
        fill: false,
        tension: 0.4, // Increased from 0.1 for smoother curves
        pointRadius: 0, // Hidden dots (was 1)
        pointHoverRadius: 3, // Show dots only on hover
        borderWidth: 2, // Added explicit border width
        order: 5, // Behind Harman target
      } as ChartDataset<'line', (ChartPoint | null)[]>);
    }

    // Add EQ corrected response dataset
    if (eqCorrectedResponse && eqCorrectedResponse.length > 0) {
      console.log('📊 Adding EQ Corrected Response dataset with', eqCorrectedResponse.length, 'points');
      
      // Enhanced styling during EQ passes
      const isEQActive = currentEQPass && currentEQPass > 0;
      const lineColor = isEQActive ? 'rgb(255, 165, 0)' : 'rgb(34, 197, 94)'; // Orange during EQ, green when done
      const lineWidth = isEQActive ? 4 : 3; // Thicker during EQ
      
      datasets.push({
        label: isEQActive ? `EQ Pass ${currentEQPass} - Corrected Response` : 'EQ Corrected Response (dB)',
        data: eqCorrectedResponse.map(r => ({ x: r.freq, y: r.db })),
        borderColor: lineColor,
        fill: false,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: lineWidth,
        order: 1, // Lower order number = higher z-index (drawn on top)
        // Add glow effect during animation
        ...(showPassAnimation && {
          shadowColor: 'rgba(255, 165, 0, 0.8)',
          shadowBlur: 8,
          shadowOffsetX: 0,
          shadowOffsetY: 0
        })
      } as ChartDataset<'line', (ChartPoint | null)[]>);
    } else {
      console.log('📊 No EQ Corrected Response to add:', {
        hasData: !!eqCorrectedResponse,
        length: eqCorrectedResponse?.length || 0
      });
    }

    // Add EQ curve dataset
    if (eqCurve && eqCurve.length > 0 && showEQCurve) {
      datasets.push({
        label: 'EQ Curve (+50dB offset)',
        data: eqCurve.map(r => ({ x: r.freq, y: r.db })),
        borderColor: 'rgb(168, 85, 247)', // Purple color for EQ curve
        fill: false,
        tension: 0.4, // Increased from 0.1 for smoother curves
        pointRadius: 0, // Hidden dots (was 0.5)
        pointHoverRadius: 3, // Show dots only on hover
        borderWidth: 1,
        borderDash: [3, 3],
        order: 6, // Behind other main curves
      } as ChartDataset<'line', (ChartPoint | null)[]>);
    }

    return {
      labels: labels, // Keep labels for now, Chart.js might use them for tick generation or fallbacks
      datasets: datasets,
    };
    // console.log('ResponseChart finalChartData (simplified):', finalChartData);
  }, [response, harmanTarget, listeningWindowResponse, selectedSpeakerName, eqCorrectedResponse, eqCurve, showEQCurve, showHarmanFill]); // Added showHarmanFill dependency
  
  const chartOptions: ChartOptions<'line'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: currentEQPass && currentEQPass > 0 ? 800 : 50, // Longer animations during EQ passes for morphing effect
      easing: currentEQPass && currentEQPass > 0 ? 'easeInOutQuart' : 'linear', // Smoother easing during EQ
    },
    transitions: {
      active: {
        animation: {
          duration: currentEQPass && currentEQPass > 0 ? 400 : 25 // Enhanced active transitions during EQ
        }
      }
    },
    interaction: {
      intersect: false,
      mode: 'nearest'
    },
    scales: {
      x: {
        type: 'logarithmic' as const, // Explicitly set type
        title: {
          display: true,
          text: 'Frequency (Hz) - Logarithmic Scale',
        },
        min: Math.max(LIMITS.FREQ_MIN, zoomState.xMin),
        max: Math.min(LIMITS.FREQ_MAX, zoomState.xMax),
        ticks: {
          callback: function(value: string | number) {
            // Convert to number and round to nearest integer to avoid floating point precision issues
            const numValue = typeof value === 'string' ? parseFloat(value) : value;
            return Math.round(numValue).toString();
          }
        }
      },
      y: {
        type: 'linear' as const, // Explicitly set type
        title: {
          display: true,
          text: 'Level (dB)',
        },
        min: Math.max(LIMITS.DB_MIN, zoomState.yMin),
        max: Math.min(LIMITS.DB_MAX, zoomState.yMax),
        ticks: {
          // Suggest Y-axis ticks every 10 dB for clarity
          stepSize: 10 
        }
      },
    },
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
      },
      title: {
        display: true,
        text: 'Frequency Response & Target (dB)',
      },
      tooltip: {
        enabled: true,
        animation: {
          duration: 100 // Very short tooltip animation for polish
        },
        backgroundColor: 'rgba(255, 255, 255, 1)', // Solid white background
        titleColor: 'rgb(0, 0, 0)', // Black title text
        bodyColor: 'rgb(0, 0, 0)', // Black body text
        borderColor: 'rgb(0, 0, 0)', // Black border
        borderWidth: 1, // Thin border
        cornerRadius: 0, // Sharp corners for Xerox style
        displayColors: true, // Show dataset colors
        titleFont: {
          family: 'monospace', // Monospace font for Xerox feel
          size: 12,
          weight: 'bold'
        },
        bodyFont: {
          family: 'monospace', // Monospace font for Xerox feel
          size: 11,
          weight: 'normal'
        },
        padding: 8, // Consistent padding
        caretSize: 6, // Arrow size
        caretPadding: 4, // Arrow padding
      },
      annotation: {
        annotations: {
          // Schroeder frequency line (always visible if provided) - NO LABEL
          ...(schroederFrequency && schroederFrequency > 0 ? {
            schroederLine: {
              type: 'line' as const,
              xMin: schroederFrequency,
              xMax: schroederFrequency,
              borderColor: 'rgba(128, 128, 128, 0.6)',
              borderWidth: 1,
              borderDash: [10, 5],
              // Removed label - will be handled separately as UI element
            }
          } : {}),
          // EQ bands annotations (show frequency, gain, Q)
          ...(eqBands && eqBands.length > 0 ? 
            eqBands.reduce((acc, band, index) => {
              // Only show bands within current view
              if (band.frequency >= zoomState.xMin && band.frequency <= zoomState.xMax) {
                const gainText = band.gain >= 0 ? `+${band.gain.toFixed(1)}` : band.gain.toFixed(1);
                const isActiveBand = activeEQBands && activeEQBands.has(band.frequency);
                const isEQActive = currentEQPass && currentEQPass > 0;
                
                acc[`eqBand${index}`] = {
                  type: 'label' as const,
                  xValue: band.frequency,
                  yValue: zoomState.yMin + (zoomState.yMax - zoomState.yMin) * 0.1, // Position near bottom
                  backgroundColor: isActiveBand 
                    ? (band.gain >= 0 ? 'rgba(255, 165, 0, 0.95)' : 'rgba(255, 69, 0, 0.95)') // Bright orange for active bands
                    : (band.gain >= 0 ? 'rgba(34, 197, 94, 0.8)' : 'rgba(239, 68, 68, 0.8)'), // Normal colors for inactive
                  borderColor: isActiveBand ? 'rgba(255, 255, 255, 1)' : 'rgba(0, 0, 0, 0.8)',
                  borderWidth: isActiveBand ? 3 : 1, // Thicker border for active bands
                  borderRadius: isActiveBand ? 8 : 4, // More rounded for active bands
                  color: isActiveBand ? 'black' : 'white',
                  content: [`${band.frequency.toFixed(0)}Hz`, `${gainText}dB`, `Q:${band.q.toFixed(1)}`],
                  font: {
                    family: 'monospace',
                    size: isActiveBand ? 12 : 10, // Larger font for active bands
                    weight: isActiveBand ? 'bold' : 'bold'
                  },
                  padding: isActiveBand ? 6 : 4, // More padding for active bands
                  textAlign: 'center',
                  // Enhanced visual effects for active bands
                  ...(isActiveBand && {
                    shadowColor: 'rgba(255, 165, 0, 0.8)',
                    shadowBlur: 12,
                    shadowOffsetX: 0,
                    shadowOffsetY: 2
                  }),
                  // Add a small vertical line to connect to frequency
                  callout: {
                    enabled: true,
                    position: 'top',
                    start: 0.9,
                    end: 0.95,
                    borderColor: isActiveBand ? 'rgba(255, 165, 0, 0.8)' : 'rgba(0, 0, 0, 0.5)',
                    borderWidth: isActiveBand ? 3 : 1 // Thicker callout for active bands
                  }
                };
                
                // Add morphing frequency lines for active bands
                if (isActiveBand && isEQActive) {
                  acc[`activeLine${index}`] = {
                    type: 'line' as const,
                    xMin: band.frequency,
                    xMax: band.frequency,
                    borderColor: 'rgba(255, 165, 0, 0.7)',
                    borderWidth: 4,
                    borderDash: [2, 2],
                    // Add pulsing animation effect
                    display: true
                  };
                }
              }
              return acc;
            }, {} as Record<string, object>)
          : {}),
          // Crosshair annotations (only when crosshair is set)
          ...(crosshairPosition ? {
            crosshairV: {
              type: 'line' as const,
              xMin: crosshairPosition.x,
              xMax: crosshairPosition.x,
              borderColor: 'rgba(0, 0, 0, 0.8)',
              borderWidth: 2,
              borderDash: [5, 5],
            },
            crosshairH: {
              type: 'line' as const,
              yMin: crosshairPosition.y,
              yMax: crosshairPosition.y,
              borderColor: 'rgba(0, 0, 0, 0.8)',
              borderWidth: 2,
              borderDash: [5, 5],
            }
          } : {})
        }
      }
    },
    onHover: (event, elements) => {
      if (chartContainerRef.current) {
        chartContainerRef.current.style.cursor = isPanning ? 'grabbing' : 'default';
      }
    },
    // Remove onClick handler - crosshair will be set via right-click in separate handler
  }), [zoomState, isPanning, crosshairPosition, schroederFrequency, eqBands]);

  // Auto-center view around main response data
  const autoCenter = (markAsUserInteraction = true) => {
    if (!response || response.length === 0) return;
    
    if (markAsUserInteraction) {
      setHasUserInteracted(true); // Mark that user has interacted when manually auto-centering
    }
    
    // Find data bounds
    const freqs = response.map(r => r.freq);
    const dbs = response.map(r => r.db);
    
    const minFreq = Math.min(...freqs);
    const maxFreq = Math.max(...freqs);
    const minDb = Math.min(...dbs);
    const maxDb = Math.max(...dbs);
    
    // Add some padding
    const freqPadding = (maxFreq - minFreq) * 0.1;
    const dbPadding = Math.max(8, (maxDb - minDb) * 0.25); // At least 8dB padding
    
    setZoomState({
      xMin: Math.max(LIMITS.FREQ_MIN, minFreq - freqPadding),  // Use LIMITS.FREQ_MIN (20Hz)
      xMax: Math.min(LIMITS.FREQ_MAX, maxFreq + freqPadding),
      yMin: Math.max(LIMITS.DB_MIN, minDb - dbPadding),        // Never go below 0 dB
      yMax: Math.min(LIMITS.DB_MAX, maxDb + dbPadding)
    });
  };

  // Reset to default view
  const resetToDefault = () => {
    setZoomState({
      xMin: 20,
      xMax: 300,
      yMin: 60,  // Changed from -40 to 60 (never go below 0 dB)
      yMax: 100  // Changed from 60 to 100 (better range for typical response around 80 dB)
    });
    setCrosshairPosition(null);
  };

  // Calculate maximum reasonable view - SAME as autoCenter for consistency
  const getMaximumView = () => {
    if (response && response.length > 0) {
      // Use EXACT same logic as autoCenter() for consistent behavior
      const freqs = response.map(r => r.freq);
      const dbs = response.map(r => r.db);
      
      const minFreq = Math.min(...freqs);
      const maxFreq = Math.max(...freqs);
      const minDb = Math.min(...dbs);
      const maxDb = Math.max(...dbs);
      
      // Use SAME padding as autoCenter
      const freqPadding = (maxFreq - minFreq) * 0.1;
      const dbPadding = Math.max(8, (maxDb - minDb) * 0.25); // At least 8dB padding
      
      return {
        xMin: Math.max(LIMITS.FREQ_MIN, minFreq - freqPadding),  // Use LIMITS.FREQ_MIN (20Hz)
        xMax: Math.min(LIMITS.FREQ_MAX, maxFreq + freqPadding),
        yMin: Math.max(LIMITS.DB_MIN, minDb - dbPadding),        // Never go below 0 dB
        yMax: Math.min(LIMITS.DB_MAX, maxDb + dbPadding)
      };
    } else {
      // Fallback to default view if no response data
      return {
        xMin: 20,
        xMax: 300,
        yMin: 60,
        yMax: 100
      };
    }
  };

  // Zoom and pan functions with realistic limits - OPTIMIZED for logarithmic consistency
  const handleZoom = (zoomIn: boolean, centerX?: number, centerY?: number) => {
    setHasUserInteracted(true); // Mark that user has interacted
    const zoomFactor = zoomIn ? 0.8 : 1.25;
    
    setZoomState(prev => {
      // Y-axis: Linear zoom (same as before)
      const yRange = prev.yMax - prev.yMin;
      const newYRange = yRange * zoomFactor;
      
      // X-axis: LOGARITHMIC zoom for consistency with panning
      const logMin = Math.log10(Math.max(LIMITS.FREQ_MIN, prev.xMin));
      const logMax = Math.log10(Math.min(LIMITS.FREQ_MAX, prev.xMax));
      const logRange = logMax - logMin;
      const newLogRange = logRange * zoomFactor;
      
      // Get the maximum reasonable view for zoom-out limits
      const maxView = getMaximumView();
      const maxLogMin = Math.log10(Math.max(LIMITS.FREQ_MIN, maxView.xMin));
      const maxLogMax = Math.log10(Math.min(LIMITS.FREQ_MAX, maxView.xMax));
      const maxLogRange = maxLogMax - maxLogMin;
      const maxYRange = maxView.yMax - maxView.yMin;
      
      // If zooming out and we're already at or near maximum view, don't zoom out further
      if (!zoomIn) {
        // Check if we're already at maximum view (within 5% tolerance)
        const isAtMaxX = logRange >= maxLogRange * 0.95;
        const isAtMaxY = yRange >= maxYRange * 0.95;
        
        if (isAtMaxX && isAtMaxY) {
          // Already at maximum view, don't zoom out further
          return prev;
        }
        
        // If the new range would exceed maximum, clamp to maximum view
        if (newLogRange >= maxLogRange || newYRange >= maxYRange) {
          return maxView;
        }
      }
      
      // Use provided center (crosshair position) - should always be provided now
      const xCenter = centerX || Math.pow(10, (logMin + logMax) / 2);
      const yCenter = centerY || (prev.yMin + prev.yMax) / 2;
      
      // Calculate new bounds
      // X-axis (logarithmic)
      const logCenter = Math.log10(Math.max(LIMITS.FREQ_MIN, xCenter));
      const newLogMin = logCenter - newLogRange / 2;
      const newLogMax = logCenter + newLogRange / 2;
      
      // Y-axis (linear)
      const newYMin = yCenter - newYRange / 2;
      const newYMax = yCenter + newYRange / 2;
      
      // Apply realistic limits
      const finalXMin = Math.max(LIMITS.FREQ_MIN, Math.pow(10, Math.max(Math.log10(LIMITS.FREQ_MIN), newLogMin)));
      const finalXMax = Math.min(LIMITS.FREQ_MAX, Math.pow(10, Math.min(Math.log10(LIMITS.FREQ_MAX), newLogMax)));
      const finalYMin = Math.max(LIMITS.DB_MIN, newYMin);
      const finalYMax = Math.min(LIMITS.DB_MAX, newYMax);
      
      return {
        xMin: finalXMin,
        xMax: finalXMax,
        yMin: finalYMin,
        yMax: finalYMax
      };
    });
  };

  // Auto-center when data changes
  useEffect(() => {
    // Only auto-center if user hasn't manually interacted and isn't currently panning
    if (!hasUserInteracted && !isPanning) {
      autoCenter(false); // Don't mark as user interaction for automatic centering
    }
  }, [response, hasUserInteracted, isPanning]);

  // Mouse wheel zoom - ONLY zoom at crosshair position
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!chartContainerRef.current) return;
      
      e.preventDefault();
      
      // ONLY zoom if crosshair is set
      if (crosshairPosition) {
        handleZoom(e.deltaY < 0, crosshairPosition.x, crosshairPosition.y);
      }
      // If no crosshair, do nothing - user must set crosshair first
    };

    const container = chartContainerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
      return () => container.removeEventListener('wheel', handleWheel);
    }
  }, [crosshairPosition, response]); // Add crosshairPosition and response as dependencies

  // Mouse event handlers with logarithmic panning and performance optimization
  useEffect(() => {
    let isLeftMouseDown = false;
    let isRightMouseDown = false;
    let dragStartTime = 0;
    const CLICK_TIME_THRESHOLD = 200; // milliseconds
    const CLICK_DISTANCE_THRESHOLD = 5; // pixels
    let startPos = { x: 0, y: 0 };
    let lastPos = { x: 0, y: 0 };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0) { // Left click - crosshair only
        e.preventDefault();
        isLeftMouseDown = true;
        dragStartTime = Date.now();
        startPos = { x: e.clientX, y: e.clientY };
      } else if (e.button === 2) { // Right click - start panning
        e.preventDefault();
        setHasUserInteracted(true); // Mark user interaction when starting to pan
        isRightMouseDown = true;
        lastPos = { x: e.clientX, y: e.clientY };
        setIsPanning(true);
      }
    };

    // Optimized mouse move handler with proper logarithmic panning
    const handleMouseMove = (e: MouseEvent) => {
      // Right-click drag panning with LOGARITHMIC scaling for X-axis
      if (isRightMouseDown && chartRef.current) {
        const currentDeltaX = e.clientX - lastPos.x;
        const currentDeltaY = e.clientY - lastPos.y;
        
        const chart = chartRef.current;
        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        
        // Check if scales are available
        if (!xScale || !yScale) {
          return;
        }
        
        // IMMEDIATE state update for responsiveness
        setZoomState(prev => {
          // Y-axis: Linear panning (same as before)
          const yRange = prev.yMax - prev.yMin;
          const yDataDelta = (currentDeltaY / yScale.height) * yRange;
          
          // X-axis: LOGARITHMIC panning (FIXED!)
          const logMin = Math.log10(Math.max(LIMITS.FREQ_MIN, prev.xMin));
          const logMax = Math.log10(Math.min(LIMITS.FREQ_MAX, prev.xMax));
          const logRange = logMax - logMin;
          const logDelta = -(currentDeltaX / xScale.width) * logRange;
          
          // Calculate new logarithmic bounds
          const newLogMin = logMin + logDelta;
          const newLogMax = logMax + logDelta;
          
          // Convert back to linear frequency space
          let newXMin = Math.pow(10, newLogMin);
          let newXMax = Math.pow(10, newLogMax);
          
          // Apply Y-axis changes
          let newYMin = prev.yMin + yDataDelta;
          let newYMax = prev.yMax + yDataDelta;
          
          // Apply boundaries while maintaining ranges
          // X-axis boundaries (logarithmic)
          if (newXMin < LIMITS.FREQ_MIN) {
            const logShift = Math.log10(LIMITS.FREQ_MIN) - newLogMin;
            newXMin = LIMITS.FREQ_MIN;
            newXMax = Math.pow(10, newLogMax + logShift);
          }
          if (newXMax > LIMITS.FREQ_MAX) {
            const logShift = Math.log10(LIMITS.FREQ_MAX) - newLogMax;
            newXMax = LIMITS.FREQ_MAX;
            newXMin = Math.pow(10, newLogMin + logShift);
          }
          
          // Y-axis boundaries (linear)
          if (newYMin < LIMITS.DB_MIN) {
            const yShift = LIMITS.DB_MIN - newYMin;
            newYMin = LIMITS.DB_MIN;
            newYMax = prev.yMax + yDataDelta + yShift;
          }
          if (newYMax > LIMITS.DB_MAX) {
            const yShift = LIMITS.DB_MAX - newYMax;
            newYMax = LIMITS.DB_MAX;
            newYMin = prev.yMin + yDataDelta + yShift;
          }
          
          return {
            xMin: Math.max(LIMITS.FREQ_MIN, newXMin),
            xMax: Math.min(LIMITS.FREQ_MAX, newXMax),
            yMin: Math.max(LIMITS.DB_MIN, newYMin),
            yMax: Math.min(LIMITS.DB_MAX, newYMax)
          };
        });
        
        lastPos = { x: e.clientX, y: e.clientY };
      }
    };

    // Throttled version for performance with slight smoothness (45fps for polish)
    const throttledMouseMove = throttle(handleMouseMove, 22);

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 0 && isLeftMouseDown) { // Left click release - set crosshair
        const timeDiff = Date.now() - dragStartTime;
        const distance = Math.sqrt(
          Math.pow(e.clientX - startPos.x, 2) + Math.pow(e.clientY - startPos.y, 2)
        );
        
        // Only set crosshair if it was a quick click with minimal movement
        if (timeDiff < CLICK_TIME_THRESHOLD && distance < CLICK_DISTANCE_THRESHOLD) {
          const chart = chartRef.current;
          if (chart) {
            const canvasRect = chart.canvas.getBoundingClientRect();
            const canvasX = e.clientX - canvasRect.left;
            const canvasY = e.clientY - canvasRect.top;
            
            // Check if click is within the actual chart plot area
            const xScale = chart.scales.x;
            const yScale = chart.scales.y;
            
            const plotArea = {
              left: xScale.left,
              right: xScale.right,
              top: yScale.top,
              bottom: yScale.bottom
            };
            
            const isWithinPlotArea = canvasX >= plotArea.left && canvasX <= plotArea.right && 
                                    canvasY >= plotArea.top && canvasY <= plotArea.bottom;
            
            if (isWithinPlotArea) {
              const dataX = xScale.getValueForPixel(canvasX);
              const dataY = yScale.getValueForPixel(canvasY);
              
              if (dataX !== null && dataY !== null && 
                  dataX >= LIMITS.FREQ_MIN && dataX <= LIMITS.FREQ_MAX &&
                  dataY >= LIMITS.DB_MIN && dataY <= LIMITS.DB_MAX) {
                setHasUserInteracted(true);
                setCrosshairPosition({ x: dataX, y: dataY });
              }
            }
          }
        }
        
        isLeftMouseDown = false;
      } else if (e.button === 2 && isRightMouseDown) { // Right click release - stop panning
        isRightMouseDown = false;
        setIsPanning(false);
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault(); // Prevent context menu on right-click
    };

    const container = chartContainerRef.current;
    if (container) {
      container.addEventListener('mousedown', handleMouseDown);
      container.addEventListener('contextmenu', handleContextMenu);
      document.addEventListener('mousemove', throttledMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        container.removeEventListener('mousedown', handleMouseDown);
        container.removeEventListener('contextmenu', handleContextMenu);
        document.removeEventListener('mousemove', throttledMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, []); // No dependencies to prevent constant recreation

  if (!response || response.length === 0) {
    return <div className="h-full w-full flex items-center justify-center text-gray-500">No data to display</div>;
  }
  
  return (
    <div className="h-full w-full relative bg-white"> {/* Removed border border-black */}
      <div ref={chartContainerRef} className="h-full w-full">
        <Line ref={chartRef} data={chartData} options={chartOptions} />
      </div>
      
      {/* Zoom Controls - Xerox Style */}
      <div className="absolute top-2 right-2 flex flex-col bg-white border border-black">
        <button
          onClick={() => crosshairPosition && handleZoom(true, crosshairPosition.x, crosshairPosition.y)}
          className={`px-3 py-2 text-sm font-bold border-b border-black bg-white text-black transition-colors ${
            crosshairPosition ? 'hover:bg-gray-200' : 'opacity-50 cursor-not-allowed'
          }`}
          title={crosshairPosition ? "Zoom In" : "Set crosshair first"}
          disabled={!crosshairPosition}
        >
          +
        </button>
        <button
          onClick={() => crosshairPosition && handleZoom(false, crosshairPosition.x, crosshairPosition.y)}
          className={`px-3 py-2 text-sm font-bold border-b border-black bg-white text-black transition-colors ${
            crosshairPosition ? 'hover:bg-gray-200' : 'opacity-50 cursor-not-allowed'
          }`}
          title={crosshairPosition ? "Zoom Out" : "Set crosshair first"}
          disabled={!crosshairPosition}
        >
          −
        </button>
        <button
          onClick={() => {
            setHasUserInteracted(false); // Reset interaction flag so auto-center can work again
            autoCenter(false); // Auto-center without marking as user interaction
          }}
          className="px-3 py-2 text-xs bg-white text-black hover:bg-gray-200 transition-colors"
          title="Auto-center on data"
        >
          ⌂
        </button>
      </div>
      
      {/* Help Icon with Tooltip - Xerox Style */}
      <div className="absolute top-2 left-2 group">
        <div className="p-2 bg-white hover:bg-gray-200 cursor-help transition-colors"> {/* Removed border border-black */}
          <HelpCircle size={16} className="text-black" />
        </div>
        {/* Xerox-style tooltip */}
        <div className="absolute top-10 left-0 bg-black text-white text-xs px-4 py-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 w-80 border border-black">
          <div className="space-y-1">
            <div className="font-medium">Chart Controls:</div>
            <div>• Left-click: Set crosshair</div>
            <div>• Scroll/+/-: Zoom at crosshair</div>
            <div>• Right-drag: Pan view</div>
            <div>• ⌂: Auto-center on data</div>
          </div>
        </div>
      </div>
      
      {/* Schroeder Frequency Label - Xerox Style */}
      {schroederFrequency && schroederFrequency > 0 && (
        <div 
          className="absolute bottom-14 group pointer-events-auto"
          style={{
            left: `${((Math.log10(schroederFrequency) - Math.log10(Math.max(LIMITS.FREQ_MIN, zoomState.xMin))) / 
                     (Math.log10(Math.min(LIMITS.FREQ_MAX, zoomState.xMax)) - Math.log10(Math.max(LIMITS.FREQ_MIN, zoomState.xMin)))) * 100}%`,
            transform: 'translateX(-50%)'
          }}
        >
          {/* Xerox-style label */}
          <div className="bg-white border border-black px-3 py-2 text-xs font-medium cursor-help hover:bg-gray-200 transition-colors">
            Schroeder: {schroederFrequency.toFixed(1)}Hz
          </div>
          {/* Xerox-style tooltip */}
          <div 
            className="absolute bottom-12 bg-black text-white text-xs px-4 py-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 w-96 text-center border border-black"
            style={{
              left: `${(() => {
                const labelPosition = ((Math.log10(schroederFrequency) - Math.log10(Math.max(LIMITS.FREQ_MIN, zoomState.xMin))) / 
                                     (Math.log10(Math.min(LIMITS.FREQ_MAX, zoomState.xMax)) - Math.log10(Math.max(LIMITS.FREQ_MIN, zoomState.xMin)))) * 100;
                
                // If label is in the right 30% of the chart, align tooltip to the right
                if (labelPosition > 70) {
                  return 'auto';
                }
                // If label is in the left 30% of the chart, align tooltip to the left  
                else if (labelPosition < 30) {
                  return '0px';
                }
                // Otherwise, center the tooltip
                else {
                  return '50%';
                }
              })()}`,
              right: `${(() => {
                const labelPosition = ((Math.log10(schroederFrequency) - Math.log10(Math.max(LIMITS.FREQ_MIN, zoomState.xMin))) / 
                                     (Math.log10(Math.min(LIMITS.FREQ_MAX, zoomState.xMax)) - Math.log10(Math.max(LIMITS.FREQ_MIN, zoomState.xMin)))) * 100;
                
                // If label is in the right 30% of the chart, align tooltip to the right
                if (labelPosition > 70) {
                  return '0px';
                }
                else {
                  return 'auto';
                }
              })()}`,
              transform: `${(() => {
                const labelPosition = ((Math.log10(schroederFrequency) - Math.log10(Math.max(LIMITS.FREQ_MIN, zoomState.xMin))) / 
                                     (Math.log10(Math.min(LIMITS.FREQ_MAX, zoomState.xMax)) - Math.log10(Math.max(LIMITS.FREQ_MIN, zoomState.xMin)))) * 100;
                
                // Only center transform when in the middle
                if (labelPosition > 30 && labelPosition <= 70) {
                  return 'translateX(-50%)';
                }
                else {
                  return 'none';
                }
              })()}`
            }}
          >
            <div className="font-medium mb-1">Schroeder Frequency</div>
            <div>Below this frequency: room modes dominate (correct these).</div>
            <div>Above: speaker response dominates (avoid over-correcting).</div>
          </div>
        </div>
      )}
    </div>
  );
}
