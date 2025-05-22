import { useMemo, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import { ModeResponse } from '@/utils/roomModeCalculations';
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
// import Annotation from 'chartjs-plugin-annotation'; // For explicit 0dB line if needed

// Register necessary Chart.js components
ChartJS.register(
  LinearScale,
  LogarithmicScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler // Register Filler plugin
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
}

export function ResponseChart({ response, harmanTarget, listeningWindowResponse, selectedSpeakerName }: ResponseChartProps) {
  const chartRef = useRef<ChartJS<"line", (number | ChartPoint | null)[], number> | null>(null); // Update TData type
  // const chartCanvasRef = useRef<HTMLDivElement>(null); // Not used in this simplified version for zoom

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
      borderColor: 'rgb(75, 192, 192)', // Fallback/default border
      tension: 0.1,
      pointRadius: 1,
      // fill and segment.backgroundColor will be set conditionally below
    };

    const labels = response.map(r => r.freq);

    if (harmanDbMap) {
      simulatedResponseDataset.fill = 1; // Fill towards the next dataset (Harman Target at index 1)
      simulatedResponseDataset.segment = {
        borderColor: (ctx: ScriptableLineSegmentContext): Color | undefined => {
          if (!ctx.p1 || harmanDbMap === undefined) { 
            return 'rgb(75, 192, 192)'; 
          }
          const simulatedDb = ctx.p1.parsed.y;
          const freq = ctx.p1.parsed.x;
          if (freq === undefined || simulatedDb === undefined) {
            return 'rgb(75, 192, 192)';
          }
          const targetDb = harmanDbMap.get(freq);
          if (targetDb === undefined) {
            return 'rgb(75, 192, 192)';
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
            return 'rgba(75, 192, 192, 0.2)'; 
          }
          const simulatedDb = ctx.p1.parsed.y;
          const freq = ctx.p1.parsed.x;
          if (freq === undefined || simulatedDb === undefined) {
            return 'rgba(75, 192, 192, 0.2)';
          }
          const targetDb = harmanDbMap.get(freq);
          if (targetDb === undefined) {
            return 'rgba(75, 192, 192, 0.2)';
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
      // If no Harman target, fill towards origin with a default color
      simulatedResponseDataset.fill = 'origin';
      simulatedResponseDataset.backgroundColor = 'rgba(75, 192, 192, 0.2)';
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
        tension: 0.1,
        pointRadius: 1,
        borderDash: [5, 5],
      } as ChartDataset<'line', (ChartPoint | null)[]>);
    }

    if (listeningWindowResponse && listeningWindowResponse.length > 0) { // Add Listening Window dataset
      datasets.push({
        label: selectedSpeakerName ? `${selectedSpeakerName} (dB)` : 'Listening Window (dB)', // Dynamic label
        data: listeningWindowResponse.map(r => ({ x: r.freq, y: r.db })), // Use {x,y} pairs
        borderColor: 'rgb(255, 159, 64)', // Orange color for Listening Window
        fill: false,
        tension: 0.1,
        pointRadius: 1,
      } as ChartDataset<'line', (ChartPoint | null)[]>);
    }

    return {
      labels: labels, // Keep labels for now, Chart.js might use them for tick generation or fallbacks
      datasets: datasets,
    };
    // console.log('ResponseChart finalChartData (simplified):', finalChartData);
  }, [response, harmanTarget, listeningWindowResponse, selectedSpeakerName]); // Added selectedSpeakerName to dependencies
  
  const chartOptions: ChartOptions<'line'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        type: 'logarithmic' as const, // Explicitly set type
        title: {
          display: true,
          text: 'Frequency (Hz) - Logarithmic Scale',
        },
        min: 20,
        max: 300, // Changed from 500
        ticks: {
          // callback: function(value: number, index: any, values: any) { // Adjusted for new max
          //   if (value === 20 || value === 50 || value === 100 || value === 200 || value === 300) {
          //     return value.toString();
          //   }
          // }
        }
      },
      y: {
        type: 'linear' as const, // Explicitly set type
        title: {
          display: true,
          text: 'Level (dB)',
        },
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
      }
    },
  }), []);

  // console.log('ResponseChart initialChartOptions:', chartOptions);

  // REMOVED zoom useEffect for simplicity
  // useEffect(() => { ... handleWheel logic ... }, [response]);

  if (!response || response.length === 0) {
    return <div className="h-full w-full flex items-center justify-center text-gray-500">No data to display</div>;
  }
  
  return (
    // <div ref={chartCanvasRef} className="h-full w-full"> // chartCanvasRef not needed for basic version
    <div className="h-full w-full"> {/* Ensure container has dimensions */} 
        <Line ref={chartRef} data={chartData} options={chartOptions} />
    </div>
  );
}
