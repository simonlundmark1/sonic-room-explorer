import { Slider } from '@/components/ui/slider';
import { RoomDimensions, Point } from '@/utils/roomModeCalculations';
import { PositionControl2D } from './PositionControl2D';
import { SpeakerIcon, HeadphonesIcon, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface SliderConfig {
  readonly key: keyof Point;
  readonly label: string;
  readonly unit: string;
  readonly step: number;
  readonly decimals: number;
  readonly roomDimKey: keyof RoomDimensions;
}

interface PositionControlsProps {
  room: RoomDimensions;
  sub: Point;
  listener: Point;
  onSubChange: (key: keyof Point, value: number) => void;
  onListenerChange: (key: keyof Point, value: number) => void;
}

export function PositionControls({
  room,
  sub,
  listener,
  onSubChange,
  onListenerChange,
}: PositionControlsProps) {
  const [isDetailedSlidersExpanded, setIsDetailedSlidersExpanded] = useState(false);

  const positionAxes: SliderConfig[] = [
    { key: 'x', label: 'X Position (Length-wise)', unit: 'm', step: 0.01, decimals: 2, roomDimKey: 'L' },
    { key: 'y', label: 'Y Position (Width-wise)', unit: 'm', step: 0.01, decimals: 2, roomDimKey: 'W' },
    { key: 'z', label: 'Z Position (Height from floor)', unit: 'm', step: 0.01, decimals: 2, roomDimKey: 'H' },
  ];

  const renderIndividualSlider = (
    item: SliderConfig,
    data: Point,
    pointName: string,
    onChange: (key: keyof Point, value: number) => void,
    currentRoomDims: RoomDimensions
  ) => (
    <div key={`${pointName}-${item.key}-slider`} className="space-y-2 mt-3">
      <div className="flex justify-between items-center text-sm">
        <Label className="text-black">{item.label}</Label>
        <span className="font-mono text-sm text-black bg-white border border-black px-2 py-0.5">
          {data[item.key].toFixed(item.decimals)} {item.unit}
        </span>
      </div>
      <Slider
        min={0}
        max={currentRoomDims[item.roomDimKey]}
        step={item.step}
        value={[data[item.key]]}
        onValueChange={([v]) => onChange(item.key, v)}
      />
    </div>
  );

  const renderPointControls = (
    title: string,
    subData: Point, 
    listenerData: Point,
    onSubChangeCallback: (key: keyof Point, value: number) => void,
    onListenerChangeCallback: (key: keyof Point, value: number) => void,
    currentRoomDims: RoomDimensions
  ) => {
    const handleControlChange = (
      pointId: string, 
      changedValues: { val1: number; val2: number },
      pointKeyForControlDim1: keyof Point,
      pointKeyForControlDim2: keyof Point
    ) => {
      const callback = pointId === 'sub' ? onSubChangeCallback : onListenerChangeCallback;
      callback(pointKeyForControlDim1, changedValues.val1);
      callback(pointKeyForControlDim2, changedValues.val2);
    };

    const topViewPoints = [
      {
        id: 'sub',
        val1: subData.x,
        val2: subData.y,
        icon: <SpeakerIcon size={16} className="fill-black stroke-black" />,
      },
      {
        id: 'listener',
        val1: listenerData.x,
        val2: listenerData.y,
        icon: <HeadphonesIcon size={16} className="text-black" />,
      },
    ];

    const sideViewPoints = [
      {
        id: 'sub',
        val1: subData.x,
        val2: subData.z,
        icon: <SpeakerIcon size={16} className="fill-black stroke-black" />,
      },
      {
        id: 'listener',
        val1: listenerData.x,
        val2: listenerData.z,
        icon: <HeadphonesIcon size={16} className="text-black" />,
      },
    ];

    return (
      <div className="mb-4 p-4 border border-black rounded-none bg-white">
        <h3 className="text-lg font-semibold text-black">{title}</h3>
        <div className="flex flex-col items-center mt-4">
          <PositionControl2D
            label="Top View (X / Y Position)"
            dim1Max={currentRoomDims.L}
            dim2Max={currentRoomDims.W}
            points={topViewPoints}
            onPointChange={(id, values) => handleControlChange(id, values, 'x', 'y')}
            axisLabel1="X (Length)"
            axisLabel2="Y (Width)"
            controlWidth={150} controlHeight={150}
          />
          <PositionControl2D
            label="Side View (X / Z Position)"
            dim1Max={currentRoomDims.L}
            dim2Max={currentRoomDims.H}
            points={sideViewPoints}
            onPointChange={(id, values) => handleControlChange(id, values, 'x', 'z')}
            axisLabel1="X (Length)"
            axisLabel2="Z (Height)"
            controlWidth={150} controlHeight={150}
            invertDim2Axis={true}
          />
        </div>
        
        <div className="mt-4 pt-4 border-t border-black">
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-md font-medium text-black">Detailed Position Sliders</h4>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsDetailedSlidersExpanded(!isDetailedSlidersExpanded)}
              title={isDetailedSlidersExpanded ? "Collapse Detailed Sliders" : "Expand Detailed Sliders"}
            >
              {isDetailedSlidersExpanded ? <ChevronUp size={18} className="text-black" /> : <ChevronDown size={18} className="text-black" />}
            </Button>
          </div>

          <div className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out ${isDetailedSlidersExpanded ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0'}`}>
            <div className="pl-2 pr-1 pb-1">
              <div className="mt-3">
                <h5 className="text-sm font-semibold mb-2 text-black">Subwoofer Position</h5>
                {positionAxes.map(axis => renderIndividualSlider(axis, subData, 'sub', onSubChangeCallback, currentRoomDims))}
              </div>
              <div className="mt-5 pt-3 border-t border-black">
                <h5 className="text-sm font-semibold mb-2 text-black">Listener Position</h5>
                {positionAxes.map(axis => renderIndividualSlider(axis, listenerData, 'listener', onListenerChangeCallback, currentRoomDims))}
              </div>
               <div className="flex justify-end pt-3 mt-2 border-t border-black">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsDetailedSlidersExpanded(false)}
                  title="Collapse Detailed Sliders"
                >
                  <span className="text-xs">Collapse</span>
                  <ChevronUp size={16} className="text-black" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 p-4 !bg-transparent">
      {renderPointControls(
        'Subwoofer & Listener Positions',
        sub,
        listener,
        onSubChange,
        onListenerChange,
        room
      )}
    </div>
  );
} 