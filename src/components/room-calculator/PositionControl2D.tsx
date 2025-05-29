import React, { useRef, useState, useEffect, useCallback } from 'react';

interface PointData {
  id: string; // e.g., 'sub' or 'listener'
  val1: number;
  val2: number;
  // color: string; // No longer used for handle background, background is now always white
  icon?: React.ReactNode; // Optional icon component
}

interface PositionControl2DProps {
  label: string;
  dim1Max: number; // Max value for the first dimension (e.g., room.L for X)
  dim2Max: number; // Max value for the second dimension (e.g., room.W for Y)
  points: PointData[]; // Array of points to control (max 2 for now)
  onPointChange: (id: string, newValues: { val1: number; val2: number }) => void;
  axisLabel1?: string; // e.g., "X"
  axisLabel2?: string; // e.g., "Y"
  controlWidth?: number; // px
  controlHeight?: number; // px
  invertDim2Axis?: boolean; // New prop
}

const HANDLE_SIZE = 20; // Increased handle size (was 12)
const CLICK_RADIUS = 15; // px, for detecting clicks near a handle
const GRID_CELL_SIZE = 25; // px, for square grid cells

export const PositionControl2D: React.FC<PositionControl2DProps> = ({
  label,
  dim1Max,
  dim2Max,
  points,
  onPointChange,
  axisLabel1 = "Dim 1",
  axisLabel2 = "Dim 2",
  controlWidth = 200,
  controlHeight = 150,
  invertDim2Axis = false, // Default to false
}) => {
  const controlRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [activePointId, setActivePointId] = useState<string | null>(null);

  // Calculate number of grid lines based on control dimensions and cell size
  const numHorizontalLines = Math.max(0, Math.floor(controlHeight / GRID_CELL_SIZE) -1);
  const numVerticalLines = Math.max(0, Math.floor(controlWidth / GRID_CELL_SIZE) - 1);

  const getScaledCoords = (val1: number, val2: number) => {
    let screenY = (val2 / dim2Max) * controlHeight;
    if (invertDim2Axis) {
      screenY = controlHeight - (val2 / dim2Max) * controlHeight;
    }
    return {
      x: (val1 / dim1Max) * controlWidth,
      y: screenY,
    };
  };

  const getValueCoords = useCallback((screenX: number, screenY: number) => {
    const val1 = (screenX / controlWidth) * dim1Max;
    let val2 = (screenY / controlHeight) * dim2Max;
    if (invertDim2Axis) {
      val2 = ((controlHeight - screenY) / controlHeight) * dim2Max;
    }
    return { val1, val2 };
  }, [controlWidth, controlHeight, dim1Max, dim2Max, invertDim2Axis]);

  const calculatePositionFromEvent = useCallback((event: MouseEvent | React.MouseEvent<HTMLDivElement>) => {
    if (!controlRef.current) return null;
    const rect = controlRef.current.getBoundingClientRect();
    let x = event.clientX - rect.left;
    let y = event.clientY - rect.top;

    x = Math.max(0, Math.min(x, controlWidth));
    y = Math.max(0, Math.min(y, controlHeight));
    return { screenX: x, screenY: y };
  }, [controlWidth, controlHeight]);

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const clickPos = calculatePositionFromEvent(event);
    if (!clickPos) return;

    let clickedPointId: string | null = null;

    // Check if click is near any point
    for (const point of points) {
      const pointScreenPos = getScaledCoords(point.val1, point.val2);
      const distance = Math.sqrt(
        (clickPos.screenX - pointScreenPos.x) ** 2 +
        (clickPos.screenY - pointScreenPos.y) ** 2
      );
      if (distance < CLICK_RADIUS) {
        clickedPointId = point.id;
        break;
      }
    }

    if (clickedPointId) {
      setIsDragging(true);
      setActivePointId(clickedPointId);
      const newValues = getValueCoords(clickPos.screenX, clickPos.screenY);
      onPointChange(clickedPointId, newValues);
    }
  };

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!isDragging || !activePointId || !controlRef.current) return;
    const currentScreenPos = calculatePositionFromEvent(event);
    if (currentScreenPos) {
      const newValues = getValueCoords(currentScreenPos.screenX, currentScreenPos.screenY);
      onPointChange(activePointId, newValues);
    }
  }, [isDragging, activePointId, calculatePositionFromEvent, onPointChange, getValueCoords]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    // setActivePointId(null); // Optional: deselect point on mouse up
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-black mb-1 text-center">{label}</label>
      <div className="flex items-center space-x-2 justify-center">
        <span className="text-xs text-black w-10 text-right select-none">{axisLabel2}</span>
        <div
          ref={controlRef}
          className="relative bg-white border border-black rounded-none cursor-pointer select-none box-border"
          style={{ width: controlWidth, height: controlHeight }}
          onMouseDown={handleMouseDown}
        >
          {/* Grid lines - Xerox style: square cells */}
          {[...Array(numHorizontalLines)].map((_, i) => (
            <div key={`h-${i}`} className="absolute w-full h-px bg-black pointer-events-none" style={{ top: `${(i + 1) * GRID_CELL_SIZE}px` }} />
          ))}
          {[...Array(numVerticalLines)].map((_, i) => (
            <div key={`v-${i}`} className="absolute h-full w-px bg-black pointer-events-none" style={{ left: `${(i + 1) * GRID_CELL_SIZE}px` }} />
          ))}
          
          {/* Draggable Handles */}
          {points.map((point) => {
            const scaled = getScaledCoords(point.val1, point.val2);
            return (
              <div
                key={point.id}
                className={`absolute bg-white border-2 border-black rounded-full shadow-md flex items-center justify-center`}
                style={{
                  left: scaled.x - HANDLE_SIZE / 2,
                  top: scaled.y - HANDLE_SIZE / 2,
                  width: HANDLE_SIZE,
                  height: HANDLE_SIZE,
                  cursor: 'pointer',
                  boxSizing: 'border-box',
                  zIndex: activePointId === point.id ? 10 : 1,
                }}
                title={`${point.id}: ${point.val1.toFixed(2)}, ${point.val2.toFixed(2)}`}
              >
                {/* Icon color will be set by className on the icon component itself */}
                {point.icon ? point.icon : <span className="text-xs font-bold text-black select-none">{point.id.substring(0,1).toUpperCase()}</span>}
              </div>
            );
          })}

          {/* Optional: Display values of the active point or all points */}
           {activePointId && points.find(p => p.id === activePointId) && (
             <div className="absolute bottom-1 right-1 text-xs bg-white/80 px-1 py-0.5 rounded pointer-events-none select-none text-black border border-black">
                {points.find(p=>p.id === activePointId)!.val1.toFixed(2)}, {points.find(p=>p.id === activePointId)!.val2.toFixed(2)}
            </div>
           )}
        </div>
        <span className="w-10"></span> {/* Spacer for symmetry */}
      </div>
      <div className="ml-12 text-xs text-black mt-1 text-center select-none" style={{width: controlWidth}}>{axisLabel1}</div>
    </div>
  );
}; 