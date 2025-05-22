import { Slider } from '@/components/ui/slider';
import { RoomDimensions, Point } from '@/utils/roomModeCalculations';
import { PositionControl2D } from './PositionControl2D';
import { SpeakerIcon, HeadphonesIcon } from 'lucide-react';

// Interface for items in the speaker manifest (can be moved to a shared types file)
interface SpeakerManifestItem {
  id: string;
  name: string;
  path: string;
}

interface ZHeightSliderConfig {
  readonly key: 'z';
  readonly label: string;
  readonly unit: string;
  readonly step: number;
  readonly decimals: number;
  readonly roomDimKey: 'H';
}

interface RoomControlsProps {
  room: RoomDimensions;
  sub: Point;
  listener: Point;
  onRoomChange: (key: keyof RoomDimensions, value: number) => void;
  onSubChange: (key: keyof Point, value: number) => void;
  onListenerChange: (key: keyof Point, value: number) => void;
  lfCutoff: number;
  onLfCutoffChange: (value: number) => void;
  airAbsorption: number;
  onAirAbsorptionChange: (value: number) => void;
  surfaceAbsorptions: {
    front: number;
    back: number;
    left: number;
    right: number;
    ceiling: number;
    floor: number;
  };
  onSurfaceAbsorptionChange: (absorptions: {
    front: number;
    back: number;
    left: number;
    right: number;
    ceiling: number;
    floor: number;
  }) => void;
  applySpeakerSettings: boolean;
  onApplySpeakerSettingsChange: (value: boolean) => void;
  applySurfaceAbsorption: boolean;
  onApplySurfaceAbsorptionChange: (value: boolean) => void;
  highlightedSurface: string | null;
  onHighlightSurface: (surface: string | null) => void;
  spectralTilt: number;
  onSpectralTiltChange: (value: number) => void;
  onRandomizeAbsorptions: () => void;
  onResetAbsorptions: () => void;
  masterAbsorptionAdjust: number;
  onMasterAbsorptionAdjustChange: (value: number) => void;
  useAnechoicResponse: boolean;
  onUseAnechoicResponseChange: (value: boolean) => void;
  showListeningWindow: boolean;
  onShowListeningWindowChange: (value: boolean) => void;
  // Speaker selection props
  availableSpeakers: SpeakerManifestItem[];
  selectedSpeakerPath: string | null;
  onSelectedSpeakerPathChange: (path: string | null) => void;
  // Furniture Factor
  furnitureFactor: number;
  onFurnitureFactorChange: (value: number) => void;
}

export function RoomControls({
  room,
  sub,
  listener,
  onRoomChange,
  onSubChange,
  onListenerChange,
  lfCutoff,
  onLfCutoffChange,
  airAbsorption,
  onAirAbsorptionChange,
  surfaceAbsorptions,
  onSurfaceAbsorptionChange,
  applySpeakerSettings,
  onApplySpeakerSettingsChange,
  applySurfaceAbsorption,
  onApplySurfaceAbsorptionChange,
  highlightedSurface,
  onHighlightSurface,
  spectralTilt,
  onSpectralTiltChange,
  onRandomizeAbsorptions,
  onResetAbsorptions,
  masterAbsorptionAdjust,
  onMasterAbsorptionAdjustChange,
  useAnechoicResponse,
  onUseAnechoicResponseChange,
  showListeningWindow,
  onShowListeningWindowChange,
  // Destructure speaker selection props
  availableSpeakers,
  selectedSpeakerPath,
  onSelectedSpeakerPathChange,
  // Furniture Factor
  furnitureFactor,
  onFurnitureFactorChange
}: RoomControlsProps) {
  const roomDimensions = [
    { key: 'L' as const, label: 'Length (L)', unit: 'm', min: 2, max: 20, step: 0.1, decimals: 1 },
    { key: 'W' as const, label: 'Width (W)', unit: 'm', min: 2, max: 20, step: 0.1, decimals: 1 },
    { key: 'H' as const, label: 'Height (H)', unit: 'm', min: 1.5, max: 6, step: 0.1, decimals: 1 }
  ];
  
  const zAxis = [
    { key: 'z' as const, label: 'Z Position (Height from floor)', unit: 'm', step: 0.01, decimals: 2, roomDimKey: 'H' as const }
  ];

  const renderIndividualSlider = (
    item: ZHeightSliderConfig,
    data: Point,
    onChange: (key: keyof Point, value: number) => void,
    currentRoomDims: RoomDimensions
  ) => (
    <div key={`${item.key}-slider`} className="space-y-2 mt-3">
      <div className="flex justify-between items-center text-sm">
        <span className="text-gray-600">{item.label}</span>
        <span className="font-mono text-sm text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
          {data[item.key].toFixed(item.decimals)} {item.unit}
        </span>
      </div>
      <Slider
        min={0}
        max={currentRoomDims[item.roomDimKey]}
        step={item.step}
        value={[data[item.key]]}
        onValueChange={([v]) => onChange(item.key, v)}
        className="[&>span:first-child]:h-2 [&>span:first-child>span]:h-2 [&>span:first-child>span]:bg-blue-500 [&>span:first-child]:bg-blue-100"
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
        icon: <SpeakerIcon size={16} className="fill-red-500 stroke-red-700" />,
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
        icon: <SpeakerIcon size={16} className="fill-red-500 stroke-red-700" />,
      },
      {
        id: 'listener',
        val1: listenerData.x,
        val2: listenerData.z,
        icon: <HeadphonesIcon size={16} className="text-black" />,
      },
    ];

    return (
      <div className="mb-8 p-4 border border-gray-200 rounded-lg shadow-sm bg-white">
        <h3 className="text-lg font-semibold mb-4 text-gray-700">{title}</h3>
        <PositionControl2D
          label="Top View (X / Y Position)"
          dim1Max={currentRoomDims.L}
          dim2Max={currentRoomDims.W}
          points={topViewPoints}
          onPointChange={(id, values) => handleControlChange(id, values, 'x', 'y')}
          axisLabel1="X (Length)"
          axisLabel2="Y (Width)"
          controlWidth={180} controlHeight={120}
        />
        <PositionControl2D
          label="Side View (X / Z Position)"
          dim1Max={currentRoomDims.L}
          dim2Max={currentRoomDims.H}
          points={sideViewPoints}
          onPointChange={(id, values) => handleControlChange(id, values, 'x', 'z')}
          axisLabel1="X (Length)"
          axisLabel2="Z (Height)"
          controlWidth={180} controlHeight={120}
          invertDim2Axis={true}
        />
        <div className="mt-4 pt-4 border-t">
          <h4 className="text-sm font-semibold mb-2 text-gray-600">Subwoofer Height (Z)</h4>
          {renderIndividualSlider(zAxis[0], subData, onSubChangeCallback, currentRoomDims)}
        </div>
        <div className="mt-3">
          <h4 className="text-sm font-semibold mb-2 text-gray-600">Listener Height (Z)</h4>
          {renderIndividualSlider(zAxis[0], listenerData, onListenerChangeCallback, currentRoomDims)}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 pt-4 bg-gray-50 p-4 rounded-lg">
      <div className="mb-8 p-4 border border-gray-200 rounded-lg shadow-sm bg-white">
        <h3 className="text-lg font-semibold mb-4 text-gray-700">Room Dimensions</h3>
        <div className="space-y-4">
          {roomDimensions.map((item) => (
            <div key={item.key} className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">{item.label}</span>
                <span className="font-mono text-sm text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                  {room[item.key].toFixed(item.decimals)} {item.unit}
                </span>
              </div>
              <Slider
                min={item.min}
                max={item.max}
                step={item.step}
                value={[room[item.key]]}
                onValueChange={([v]) => onRoomChange(item.key, v)}
                className="[&>span:first-child]:h-2 [&>span:first-child>span]:h-2 [&>span:first-child>span]:bg-blue-500 [&>span:first-child]:bg-blue-100"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Speaker Settings Card */}
      <div className={`mb-8 p-4 border border-gray-200 rounded-lg shadow-sm bg-white ${!applySpeakerSettings ? 'opacity-70' : ''}`}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-700">Speaker Settings</h3>
          <label className="flex items-center space-x-2 cursor-pointer">
            <input 
              type="checkbox" 
              checked={applySpeakerSettings} 
              onChange={(e) => onApplySpeakerSettingsChange(e.target.checked)}
              className="form-checkbox h-5 w-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-600">Apply All</span>
          </label>
        </div>
        <div className={`space-y-2 ${!applySpeakerSettings ? 'pointer-events-none' : ''}`}>
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-600">LF Cutoff Frequency (-3dB)</span>
            <span className="font-mono text-sm text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
              {lfCutoff.toFixed(0)} Hz
            </span>
          </div>
          <Slider
            min={10}
            max={200}
            step={1}
            value={[lfCutoff]}
            onValueChange={([v]) => onLfCutoffChange(v)}
            disabled={!applySpeakerSettings}
            className="[&>span:first-child]:h-2 [&>span:first-child>span]:h-2 [&>span:first-child>span]:bg-blue-500 [&>span:first-child]:bg-blue-100"
          />
        </div>
        {/* Air Absorption Slider */}
        <div className={`space-y-2 mt-4 pt-4 border-t border-gray-100 ${!applySpeakerSettings ? 'pointer-events-none' : ''}`}>
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-600">Air Absorption Level</span>
            <span className="font-mono text-sm text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
              {airAbsorption.toFixed(1)}
            </span>
          </div>
          <Slider
            min={0}
            max={10} 
            step={0.1}
            value={[airAbsorption]}
            onValueChange={([v]) => onAirAbsorptionChange(v)}
            disabled={!applySpeakerSettings}
            className="[&>span:first-child]:h-2 [&>span:first-child>span]:h-2 [&>span:first-child>span]:bg-blue-500 [&>span:first-child]:bg-blue-100"
          />
        </div>
        {/* Speaker Selector Dropdown */}
        <div className={`mt-4 pt-4 border-t border-gray-100 ${!applySpeakerSettings ? 'pointer-events-none opacity-50' : ''}`}>
          <label htmlFor="speaker-selector" className="text-sm text-gray-600 block mb-1">
            Select Speaker Model
          </label>
          <select 
            id="speaker-selector"
            value={selectedSpeakerPath || ''}
            onChange={(e) => onSelectedSpeakerPathChange(e.target.value || null)}
            disabled={!applySpeakerSettings || availableSpeakers.length === 0}
            className="block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm bg-white disabled:bg-gray-100"
          >
            {availableSpeakers.length === 0 && <option value="" disabled>Loading speakers...</option>}
            {availableSpeakers.map(speaker => (
              <option key={speaker.id} value={speaker.path}>
                {speaker.name}
              </option>
            ))}
          </select>
          {selectedSpeakerPath && availableSpeakers.find(s => s.path === selectedSpeakerPath) && (
             <p className="text-xs text-gray-400 mt-1">Currently selected: {availableSpeakers.find(s => s.path === selectedSpeakerPath)?.name}</p>
          )}
        </div>
        {/* Anechoic Response Toggle (Formerly JBL Directivity) */}
        <div className={`flex items-center justify-between mt-4 pt-4 border-t border-gray-100 ${!applySpeakerSettings ? 'pointer-events-none opacity-50' : ''}`}>
          <label htmlFor="anechoic-response-toggle" className="text-sm text-gray-600 flex-grow">
            Use anechoic frequency response
            <p className="text-xs text-gray-400">Applies the 'Listening Window' curve from the selected speaker's anechoic data.</p>
          </label>
          <input 
            type="checkbox"
            id="anechoic-response-toggle"
            checked={useAnechoicResponse}
            onChange={(e) => onUseAnechoicResponseChange(e.target.checked)}
            disabled={!applySpeakerSettings}
            className="form-checkbox h-5 w-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
          />
        </div>
        {/* Show Listening Window Toggle */}
        <div className={`flex items-center justify-between mt-4 pt-4 border-t border-gray-100 ${!applySpeakerSettings ? 'pointer-events-none opacity-50' : ''}`}>
          <label htmlFor="listening-window-toggle" className="text-sm text-gray-600 flex-grow">
            Show Listening Window Curve
            <p className="text-xs text-gray-400">Displays the speaker's Listening Window response on the chart.</p>
          </label>
          <input 
            type="checkbox"
            id="listening-window-toggle"
            checked={showListeningWindow}
            onChange={(e) => onShowListeningWindowChange(e.target.checked)}
            disabled={!applySpeakerSettings} // Can be independent or linked to applySpeakerSettings
            className="form-checkbox h-5 w-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
          />
        </div>
      </div>

      {/* General Simulation Settings Card (New for Spectral Tilt) */}
      <div className="mb-8 p-4 border border-gray-200 rounded-lg shadow-sm bg-white">
        <h3 className="text-lg font-semibold text-gray-700 mb-4">Simulation Settings</h3>
        {/* Spectral Tilt Slider */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-600">Response Spectral Tilt</span>
            <span className="font-mono text-sm text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
              {spectralTilt.toFixed(1)} dB/octave
            </span>
          </div>
          <Slider
            min={-24}
            max={3}
            step={0.1}
            value={[spectralTilt]}
            onValueChange={([v]) => onSpectralTiltChange(v)}
            className="[&>span:first-child]:h-2 [&>span:first-child>span]:h-2 [&>span:first-child>span]:bg-blue-500 [&>span:first-child]:bg-blue-100"
          />
           <p className="text-xs text-gray-500 mt-1">
            Adjusts the overall frequency balance of the raw simulation. -3dB/octave is a common starting point.
          </p>
        </div>
      </div>

      {/* Surface Absorption Settings Card */}
      <div className={`mb-8 p-4 border border-gray-200 rounded-lg shadow-sm bg-white ${!applySurfaceAbsorption ? 'opacity-70' : ''}`}>
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-lg font-semibold text-gray-700">Surface Absorption Coefficients (α)</h3>
          <label className="flex items-center space-x-2 cursor-pointer">
            <input 
              type="checkbox" 
              checked={applySurfaceAbsorption} 
              onChange={(e) => onApplySurfaceAbsorptionChange(e.target.checked)}
              className="form-checkbox h-5 w-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-600">Apply All</span>
          </label>
        </div>

        {/* Master Absorption Offset Slider */}
        <div className={`space-y-2 mb-4 pt-3 border-t border-b border-gray-100 pb-4 ${!applySurfaceAbsorption ? 'pointer-events-none' : ''}`}>
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-600">Master Absorption Offset</span>
            <span className={`font-mono text-sm px-2 py-0.5 rounded ${masterAbsorptionAdjust >= 0 ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'}`}>
              {masterAbsorptionAdjust.toFixed(2)}
            </span>
          </div>
          <Slider
            min={-0.3} 
            max={0.3}
            step={0.01}
            value={[masterAbsorptionAdjust]}
            onValueChange={([v]) => onMasterAbsorptionAdjustChange(v)}
            disabled={!applySurfaceAbsorption}
            className="[&>span:first-child]:h-2 [&>span:first-child>span]:h-2 [&>span:first-child>span]:bg-purple-500 [&>span:first-child]:bg-purple-100"
          />
          <p className="text-xs text-gray-500 mt-1">
            Adjusts all surface absorptions globally. Individual values will be clamped to [0.01, 1.0].
          </p>
        </div>
        
        <div className="flex items-center space-x-2 mb-4">
          <button
            onClick={onRandomizeAbsorptions}
            disabled={!applySurfaceAbsorption}
            title={!applySurfaceAbsorption ? "Enable 'Apply All' to randomize" : "Randomize absorption values"}
            className={`text-xs font-medium py-1.5 px-3 rounded-md transition-colors duration-150 flex-1 ${
              applySurfaceAbsorption 
              ? 'bg-blue-500 hover:bg-blue-600 text-white' 
              : 'bg-gray-200 text-gray-500 cursor-not-allowed'
            }`}
          >
            Randomize All
          </button>
          <button
            onClick={onResetAbsorptions}
            disabled={!applySurfaceAbsorption}
            title={!applySurfaceAbsorption ? "Enable 'Apply All' to reset" : "Reset all absorptions to default (0.10)"}
            className={`text-xs font-medium py-1.5 px-3 rounded-md transition-colors duration-150 flex-1 ${
              applySurfaceAbsorption
              ? 'bg-gray-500 hover:bg-gray-600 text-white'
              : 'bg-gray-200 text-gray-500 cursor-not-allowed'
            }`}
          >
            Reset Defaults
          </button>
        </div>

        <div className={`grid grid-cols-2 gap-x-4 gap-y-3 ${!applySurfaceAbsorption ? 'pointer-events-none' : ''}`}>
          {(['front', 'back', 'left', 'right', 'ceiling', 'floor'] as const).map((surface) => (
            <div 
              key={surface} 
              className="space-y-1 cursor-grab"
              onMouseEnter={() => applySurfaceAbsorption && onHighlightSurface(surface)}
              onMouseLeave={() => applySurfaceAbsorption && onHighlightSurface(null)}
              onMouseDown={() => applySurfaceAbsorption && onHighlightSurface(surface)}
              onMouseUp={() => applySurfaceAbsorption && onHighlightSurface(null)}
            >
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600 capitalize">{surface}</span>
                <span className="font-mono text-sm text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                  {surfaceAbsorptions[surface].toFixed(2)}
                </span>
              </div>
              <Slider
                min={0.01}
                max={1.0}
                step={0.01}
                value={[surfaceAbsorptions[surface]]}
                onValueChange={([v]) => {
                  onSurfaceAbsorptionChange({
                    ...surfaceAbsorptions,
                    [surface]: v,
                  });
                }}
                disabled={!applySurfaceAbsorption}
                className="[&>span:first-child]:h-2 [&>span:first-child>span]:h-2 [&>span:first-child>span]:bg-blue-500 [&>span:first-child]:bg-blue-100"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Furniture Factor Card */}
      <div className="mb-8 p-4 border border-gray-200 rounded-lg shadow-sm bg-white">
        <h3 className="text-lg font-semibold mb-4 text-gray-700">Room Furnishing Level</h3>
        <div className="space-y-2 mt-3">
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-600">
              Level: {furnitureFactor === 0 ? "Empty" : furnitureFactor === 1 ? "Heavily Furnished" : "Moderate"}
            </span>
            <span className="font-mono text-sm text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
              {furnitureFactor.toFixed(2)}
            </span>
          </div>
          <Slider
            min={0}
            max={1}
            step={0.05}
            value={[furnitureFactor]}
            onValueChange={([v]) => onFurnitureFactorChange(v)}
            className="[&>span:first-child]:h-2 [&>span:first-child>span]:h-2 [&>span:first-child>span]:bg-blue-500 [&>span:first-child]:bg-blue-100"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>Empty</span>
            <span>Heavily Furnished</span>
          </div>
        </div>
      </div>

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
