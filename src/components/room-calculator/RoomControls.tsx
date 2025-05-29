import { Slider } from '@/components/ui/slider';
import { RoomDimensions, SpeakerData } from '@/utils/roomModeCalculations';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

// Interface for items in the speaker manifest (can be moved to a shared types file)
interface SpeakerManifestItem {
  id: string;
  name: string;
  path: string;
}

interface RoomControlsProps {
  room: RoomDimensions;
  onRoomChange: (key: keyof RoomDimensions, value: number) => void;
  surfaceAbsorptions: {
    front: number;
    back: number;
    left: number;
    right: number;
    ceiling: number;
    floor: number;
  };
  onSurfaceAbsorptionChange: (surface: string, value: number) => void;
  applySurfaceAbsorption: boolean;
  onApplySurfaceAbsorptionChange: (value: boolean) => void;
  highlightedSurface: string | null;
  onHighlightedSurfaceChange: (surface: string | null) => void;
  masterAbsorptionAdjust: number;
  onMasterAbsorptionAdjustChange: (value: number) => void;
  furnitureFactor: number;
  onFurnitureFactorChange: (value: number) => void;
  airAbsorptionLevel: number;
  onAirAbsorptionLevelChange: (value: number) => void;
  applySpeakerSettings: boolean;
  onApplySpeakerSettingsChange: (value: boolean) => void;
  onRandomizeAbsorptions: () => void;
  onResetAbsorptions: () => void;
  // Removed spectral tilt props
  // Furniture Factor
  // Speaker Settings Props
  useLfCutoff: boolean;
  onUseLfCutoffChange: (value: boolean) => void;
  availableSpeakers: SpeakerManifestItem[];
  selectedSpeakerPath: string | null;
  onSelectedSpeakerPathChange: (value: string | null) => void;
  useAnechoicResponse: boolean;
  onUseAnechoicResponseChange: (value: boolean) => void;
  showListeningWindow: boolean;
  onShowListeningWindowChange: (value: boolean) => void;

  // Harman Curve Settings Props
  showHarmanFill: boolean;
  onShowHarmanFillChange: (value: boolean) => void;
  harmanCurveOffset: number;
  onHarmanCurveOffsetChange: (value: number) => void;
  harmanAutoBaseline: number;
  onHarmanAutoBaselineChange: (value: number) => void;
  harmanBassRolloffEnabled: boolean;
  onHarmanBassRolloffEnabledChange: (value: boolean) => void;
  harmanBassRolloffFreq: number;
  onHarmanBassRolloffFreqChange: (value: number) => void;
  harmanBassRolloffSlope: number;
  onHarmanBassRolloffSlopeChange: (value: number) => void;
  onAutoAlignHarman?: () => void;

  // EQ Settings Props
  eqEnabled: boolean;
  onEqEnabledChange: (value: boolean) => void;
  eqNumBands: number;
  onEqNumBandsChange: (value: number) => void;
  eqMaxBoost: number;
  onEqMaxBoostChange: (value: number) => void;
  eqMaxCut: number;
  onEqMaxCutChange: (value: number) => void;
  eqSmoothing: number;
  onEqSmoothingChange: (value: number) => void;
  showEQCurve: boolean;
  onShowEQCurveChange: (value: boolean) => void;
  eqBandCount: number;
  onGenerateEQ: () => void;
  onExportEQ: () => void;
  onAutoDetectBassRolloff?: () => void;
  speakerData?: SpeakerData | null;
}

export function RoomControls({
  room,
  onRoomChange,
  surfaceAbsorptions,
  onSurfaceAbsorptionChange,
  applySurfaceAbsorption,
  onApplySurfaceAbsorptionChange,
  highlightedSurface,
  onHighlightedSurfaceChange,
  masterAbsorptionAdjust,
  onMasterAbsorptionAdjustChange,
  furnitureFactor,
  onFurnitureFactorChange,
  airAbsorptionLevel,
  onAirAbsorptionLevelChange,
  applySpeakerSettings,
  onApplySpeakerSettingsChange,
  onRandomizeAbsorptions,
  onResetAbsorptions,
  // Furniture Factor
  // Speaker Settings
  useLfCutoff,
  onUseLfCutoffChange,
  // Speaker Settings
  availableSpeakers,
  selectedSpeakerPath,
  onSelectedSpeakerPathChange,
  useAnechoicResponse,
  onUseAnechoicResponseChange,
  showListeningWindow,
  onShowListeningWindowChange,
  // Harman Curve Settings
  showHarmanFill,
  onShowHarmanFillChange,
  harmanCurveOffset,
  onHarmanCurveOffsetChange,
  harmanAutoBaseline,
  onHarmanAutoBaselineChange,
  harmanBassRolloffEnabled,
  onHarmanBassRolloffEnabledChange,
  harmanBassRolloffFreq,
  onHarmanBassRolloffFreqChange,
  harmanBassRolloffSlope,
  onHarmanBassRolloffSlopeChange,
  onAutoAlignHarman,
  // EQ Settings
  eqEnabled,
  onEqEnabledChange,
  eqNumBands,
  onEqNumBandsChange,
  eqMaxBoost,
  onEqMaxBoostChange,
  eqMaxCut,
  onEqMaxCutChange,
  eqSmoothing,
  onEqSmoothingChange,
  showEQCurve,
  onShowEQCurveChange,
  eqBandCount,
  onGenerateEQ,
  onExportEQ,
  onAutoDetectBassRolloff,
  speakerData,
}: RoomControlsProps) {
  const [isRoomSettingsExpanded, setIsRoomSettingsExpanded] = useState(true);
  const [isAdvancedRoomSettingsExpanded, setIsAdvancedRoomSettingsExpanded] = useState(false);
  const [isSpeakerSettingsExpanded, setIsSpeakerSettingsExpanded] = useState(false);
  const [isEQSettingsExpanded, setIsEQSettingsExpanded] = useState(false);

  // Auto-enable EQ when section is expanded
  const handleEQExpansionChange = (expanded: boolean) => {
    setIsEQSettingsExpanded(expanded);
    onEqEnabledChange(expanded); // Automatically enable/disable EQ when expanding/collapsing
  };

  const roomDimensions = [
    { key: 'L' as const, label: 'Length (L)', unit: 'm', min: 2, max: 20, step: 0.1, decimals: 1 },
    { key: 'W' as const, label: 'Width (W)', unit: 'm', min: 2, max: 20, step: 0.1, decimals: 1 },
    { key: 'H' as const, label: 'Height (H)', unit: 'm', min: 1.5, max: 6, step: 0.1, decimals: 1 }
  ];
  


  return (
    <div className="space-y-6 py-4 px-1 !bg-transparent">
      {/* Room Settings Card */}
      <div className="mb-4 p-4 border border-black rounded-none bg-white">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold text-black">Room Settings</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsRoomSettingsExpanded(!isRoomSettingsExpanded)}
            title={isRoomSettingsExpanded ? "Collapse Room Settings" : "Expand Room Settings"}
            className="h-8 w-8 pr-2 -ml-8"
          >
            {isRoomSettingsExpanded ? <ChevronUp size={16} className="text-black" /> : <ChevronDown size={16} className="text-black" />}
          </Button>
        </div>

        {/* Collapsible Content for the entire Room Settings section */}
        <div className={`overflow-hidden transition-[max-height,opacity,padding-top] duration-300 ease-in-out ${isRoomSettingsExpanded ? 'max-h-[2000px] opacity-100 pt-4' : 'max-h-0 opacity-0 pt-0'}`}>
            {/* Room Dimensions - Always visible if main Room Settings is expanded */}
            <div className="space-y-4 mb-4">
              <h4 className="text-md font-medium text-black">Room Dimensions</h4>
              {roomDimensions.map((item) => (
                <div key={item.key} className="space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <Label className="text-black">{item.label}</Label>
                    <span className="font-mono text-sm text-black bg-white border border-black px-2 py-0.5">
                      {room[item.key].toFixed(item.decimals)} {item.unit}
                    </span>
                  </div>
                  <Slider
                    min={item.min}
                    max={item.max}
                    step={item.step}
                    value={[room[item.key]]}
                    onValueChange={([v]) => onRoomChange(item.key, v)}
                  />
                </div>
              ))}
            </div>

            {/* Divider and Advanced Settings Header with its own Chevron */}
            <div className="pt-4 border-t border-black">
              <div className="flex justify-between items-center mb-3">
                <h4 className="text-md font-medium text-black">Advanced Room Properties</h4>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsAdvancedRoomSettingsExpanded(!isAdvancedRoomSettingsExpanded)}
                  title={isAdvancedRoomSettingsExpanded ? "Collapse Advanced Properties" : "Expand Advanced Properties"}
                >
                  {isAdvancedRoomSettingsExpanded ? <ChevronUp size={18} className="text-black" /> : <ChevronDown size={18} className="text-black" />}
                </Button>
              </div>

              {/* Collapsible Content for Advanced Settings */}
              <div className={`px-2 pb-1 overflow-hidden transition-[max-height,opacity,padding-top] duration-300 ease-in-out ${isAdvancedRoomSettingsExpanded ? 'max-h-[1000px] opacity-100 pt-4' : 'max-h-0 opacity-0 pt-0'}`}>
                  {/* Surface Absorption Coefficients Section */}
                  <div className={`mb-6 ${!applySurfaceAbsorption ? 'opacity-70' : ''}`}>
                    <div className="flex justify-between items-center">
                      <h5 className="text-sm font-medium text-black">Surface Absorption (α)</h5>
                      <Label className="flex items-center space-x-2 cursor-pointer text-black">
                        <Checkbox 
                          checked={applySurfaceAbsorption} 
                          onCheckedChange={onApplySurfaceAbsorptionChange}
                          aria-label="Apply surface absorption"
                        />
                        <span className="text-xs">Apply</span>
                      </Label>
                    </div>

                    {/* Master Absorption Offset Slider */}
                    <div className={`space-y-2 mb-4 py-4 border-t border-b border-black ${!applySurfaceAbsorption ? 'pointer-events-none' : ''}`}>
                      <div className="flex justify-between items-center text-sm">
                        <Label className="text-black">Master Absorption Offset</Label>
                        <span className={`font-mono text-sm text-black bg-white border border-black px-2 py-0.5`}>
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
                      />
                      <p className="text-xs text-black mt-1">
                        Adjusts all surface absorptions globally. Individual values will be clamped to [0.01, 1.0].
                      </p>
                    </div>
                    
                    <div className="flex items-center space-x-2 mb-4">
                      <Button
                        variant="default"
                        onClick={onRandomizeAbsorptions}
                        disabled={!applySurfaceAbsorption}
                        title={!applySurfaceAbsorption ? "Enable 'Apply All' to randomize" : "Randomize absorption values"}
                        className="text-xs flex-1"
                      >
                        Randomize All
                      </Button>
                      <Button
                        variant="default"
                        onClick={onResetAbsorptions}
                        disabled={!applySurfaceAbsorption}
                        title={!applySurfaceAbsorption ? "Enable 'Apply All' to reset" : "Reset all absorptions to default (0.10)"}
                        className="text-xs flex-1"
                      >
                        Reset Defaults
                      </Button>
                    </div>

                    <div className={`grid grid-cols-2 gap-x-4 gap-y-3 ${!applySurfaceAbsorption ? 'pointer-events-none' : ''}`}>
                      {(['front', 'back', 'left', 'right', 'ceiling', 'floor'] as const).map((surface) => (
                        <div 
                          key={surface} 
                          className="space-y-1 cursor-grab"
                          onMouseEnter={() => applySurfaceAbsorption && onHighlightedSurfaceChange(surface)}
                          onMouseLeave={() => applySurfaceAbsorption && onHighlightedSurfaceChange(null)}
                          onMouseDown={() => applySurfaceAbsorption && onHighlightedSurfaceChange(surface)}
                          onMouseUp={() => applySurfaceAbsorption && onHighlightedSurfaceChange(null)}
                        >
                          <div className="flex justify-between items-center text-sm">
                            <Label className="text-black capitalize">{surface}</Label>
                            <span className="font-mono text-sm text-black bg-white border border-black px-2 py-0.5">
                              {surfaceAbsorptions[surface].toFixed(2)}
                            </span>
                          </div>
                          <Slider
                            min={0.01}
                            max={1.0}
                            step={0.01}
                            value={[surfaceAbsorptions[surface]]}
                            onValueChange={([v]) => {
                              onSurfaceAbsorptionChange(surface, v);
                            }}
                            disabled={!applySurfaceAbsorption}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Room Furnishing Level Section */}
                  <div className="mb-2">
                    <h5 className="text-sm font-medium mb-2 text-black">Room Furnishing Level</h5>
                    <div className="space-y-2 mt-1">
                      <div className="flex justify-between items-center text-sm">
                        <Label className="text-black">
                          Level: {furnitureFactor === 0 ? "Empty" : furnitureFactor === 1 ? "Heavily Furnished" : "Moderate"}
                        </Label>
                        <span className="font-mono text-sm text-black bg-white border border-black px-2 py-0.5">
                          {furnitureFactor.toFixed(2)}
                        </span>
                      </div>
                      <Slider
                        min={0}
                        max={1}
                        step={0.05}
                        value={[furnitureFactor]}
                        onValueChange={([v]) => onFurnitureFactorChange(v)}
                      />
                      <div className="flex justify-between text-xs text-black mt-1">
                        <span>Empty</span>
                        <span>Heavily Furnished</span>
                      </div>
                    </div>
                  </div>

                  {/* Bottom collapse button for Advanced Settings */}
                  <div className="flex justify-end pt-2 border-t border-black">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsAdvancedRoomSettingsExpanded(false)}
                      className="text-xs h-8 px-2 -mr-2"
                      title="Collapse Advanced Properties"
                    >
                      <span className="text-xs">Collapse</span>
                      <ChevronUp size={14} className="text-black ml-1" />
                    </Button>
                  </div>

                </div>
            </div>
        </div>
      </div>

      {/* Speaker & Simulation Settings Card - NEW CARD */}
      <div className={`p-4 border border-black rounded-none bg-white ${isSpeakerSettingsExpanded ? 'mb-8' : 'mb-4'}`}>
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold text-black">Speaker & Simulation</h3>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsSpeakerSettingsExpanded(!isSpeakerSettingsExpanded)}
            title={isSpeakerSettingsExpanded ? "Collapse Speaker Settings" : "Expand Speaker Settings"}
          >
            {isSpeakerSettingsExpanded ? <ChevronUp size={20} className="text-black" /> : <ChevronDown size={20} className="text-black" />}
          </Button>
        </div>
        <div className={`overflow-hidden transition-[max-height,opacity,padding-top] duration-300 ease-in-out ${isSpeakerSettingsExpanded ? 'max-h-[2000px] opacity-100 pt-4' : 'max-h-0 opacity-0 pt-0'}`}>
          <div className="px-2 pb-3 space-y-4">
            {/* Toggle for all speaker/simulation settings */}
            <div className="flex justify-between items-center">
              <Label htmlFor="applySpeakerSimSettings" className="text-sm text-black">Enable Speaker Simulation</Label>
              <Checkbox
                id="applySpeakerSimSettings"
                checked={applySpeakerSettings}
                onCheckedChange={onApplySpeakerSettingsChange}
                aria-label="Apply all speaker and simulation settings"
              />
            </div>
            
            {/* Speaker Selection */}
            <div className={`space-y-2 ${!applySpeakerSettings ? 'opacity-50 pointer-events-none' : ''}`}>
              <Label htmlFor="speakerSelect" className="text-sm text-black">Speaker Model</Label>
              <Select
                value={selectedSpeakerPath || ''}
                onValueChange={(value) => onSelectedSpeakerPathChange(value === '' ? null : value)}
                disabled={!applySpeakerSettings}
              >
                <SelectTrigger id="speakerSelect" className="w-full bg-white border-black text-black focus:ring-black">
                  <SelectValue placeholder="Select Speaker..." />
                </SelectTrigger>
                <SelectContent className="bg-white border-black text-black">
                  {availableSpeakers.map(speaker => (
                    <SelectItem key={speaker.id} value={speaker.path} className="hover:bg-gray-200 focus:bg-gray-300">
                      {speaker.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {/* Anechoic Response Toggle */}
            <div className={`flex justify-between items-center ${!applySpeakerSettings ? 'opacity-50 pointer-events-none' : ''}`}>
              <Label htmlFor="useAnechoicResponse" className="text-sm text-black">Use Speaker's Anechoic Data</Label>
              <Checkbox
                id="useAnechoicResponse"
                checked={useAnechoicResponse}
                onCheckedChange={onUseAnechoicResponseChange}
                disabled={!applySpeakerSettings || !selectedSpeakerPath}
                aria-label="Use speaker's anechoic frequency response data"
              />
            </div>
            
            {/* Listening Window Toggle */}
            <div className={`flex justify-between items-center ${!applySpeakerSettings || !useAnechoicResponse ? 'opacity-50 pointer-events-none' : ''}`}>
              <Label htmlFor="showListeningWindow" className="text-sm text-black">Show Listening Window Curve</Label>
              <Checkbox
                id="showListeningWindow"
                checked={showListeningWindow}
                onCheckedChange={onShowListeningWindowChange}
                disabled={!applySpeakerSettings || !useAnechoicResponse || !selectedSpeakerPath}
                aria-label="Show listening window curve on chart"
              />
            </div>
          </div>
        </div>
      </div>

      {/* EQ Settings Card */}
      <div className="p-4 border border-black rounded-none bg-white">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold text-black">EQ Generation</h3>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleEQExpansionChange(!isEQSettingsExpanded)}
            title={isEQSettingsExpanded ? "Collapse EQ Settings" : "Expand EQ Settings"}
          >
            {isEQSettingsExpanded ? <ChevronUp size={20} className="text-black" /> : <ChevronDown size={20} className="text-black" />}
          </Button>
        </div>

        <div className={`overflow-hidden transition-[max-height,opacity,padding-top] duration-300 ease-in-out ${isEQSettingsExpanded ? 'max-h-[2000px] opacity-100 pt-4' : 'max-h-0 opacity-0 pt-0'}`}>
          <div className="space-y-4">
            {/* Harman Target Curve Settings - MOVED HERE */}
            <div className="space-y-4 p-3 border border-black bg-gray-50">
              <h5 className="text-sm font-medium text-black">Harman Target Curve</h5>
              
              {/* Harman Fill Toggle */}
              <div className="flex justify-between items-center">
                <Label htmlFor="showHarmanFill" className="text-sm text-black">Show Color Fill</Label>
                <Checkbox
                  id="showHarmanFill"
                  checked={showHarmanFill}
                  onCheckedChange={onShowHarmanFillChange}
                  aria-label="Show red/blue fill above/below Harman curve"
                />
              </div>
              
              {/* Harman Curve Offset */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <Label className="text-black">Harman Curve Offset (dB)</Label>
                  <div className="flex items-center space-x-2">
                    {onAutoAlignHarman && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={onAutoAlignHarman}
                        className="text-xs h-6 px-2 border-black"
                        title="Auto-align Harman curve to room response"
                      >
                        Auto
                      </Button>
                    )}
                    <span className="font-mono text-sm text-black bg-white border border-black px-2 py-0.5">
                      {harmanCurveOffset > 0 ? '+' : ''}{harmanCurveOffset.toFixed(1)} dB
                    </span>
                  </div>
                </div>
                {harmanAutoBaseline !== 0 && (
                  <div className="text-xs text-gray-600 mb-2">
                    Auto baseline: {harmanAutoBaseline > 0 ? '+' : ''}{harmanAutoBaseline.toFixed(1)} dB
                    {' | '}Total: {(harmanAutoBaseline + harmanCurveOffset) > 0 ? '+' : ''}{(harmanAutoBaseline + harmanCurveOffset).toFixed(1)} dB
                  </div>
                )}
                <Slider
                  min={-20}
                  max={20}
                  step={0.5}
                  value={[harmanCurveOffset]}
                  onValueChange={([v]) => onHarmanCurveOffsetChange(v)}
                />
                <div className="flex justify-between text-xs text-gray-600">
                  <span>-20dB</span>
                  <span>+20dB</span>
                </div>
              </div>

              {/* Harman Bass Rolloff */}
              <div className="pt-3 border-t border-black space-y-4">
                <div className="flex justify-between items-center">
                  <Label htmlFor="harmanBassRolloff" className="text-sm text-black">Apply Bass Rolloff to Target</Label>
                  <Checkbox
                    id="harmanBassRolloff"
                    checked={harmanBassRolloffEnabled}
                    onCheckedChange={onHarmanBassRolloffEnabledChange}
                    aria-label="Apply bass rolloff to Harman target curve"
                  />
                </div>
                
                <div className={`space-y-4 pl-2 ${!harmanBassRolloffEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
                  <div className="text-xs text-gray-600">
                    Applies bass rolloff to the Harman target curve itself
                  </div>
                  
                  {/* Harman Bass Rolloff Frequency */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-sm">
                      <Label className="text-black">Target Rolloff Frequency (Hz)</Label>
                      <span className="font-mono text-sm text-black bg-white border border-black px-2 py-0.5">
                        {harmanBassRolloffFreq} Hz
                      </span>
                    </div>
                    <Slider
                      min={20}
                      max={120}
                      step={1}
                      value={[harmanBassRolloffFreq]}
                      onValueChange={([v]) => onHarmanBassRolloffFreqChange(v)}
                      disabled={!harmanBassRolloffEnabled}
                    />
                    <div className="flex justify-between text-xs text-gray-600">
                      <span>20Hz</span>
                      <span>120Hz</span>
                    </div>
                  </div>

                  {/* Harman Bass Rolloff Slope */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-sm">
                      <Label className="text-black">Target Rolloff Slope (dB/octave)</Label>
                      <span className="font-mono text-sm text-black bg-white border border-black px-2 py-0.5">
                        {harmanBassRolloffSlope} dB/oct
                      </span>
                    </div>
                    <Slider
                      min={6}
                      max={48}
                      step={6}
                      value={[harmanBassRolloffSlope]}
                      onValueChange={([v]) => onHarmanBassRolloffSlopeChange(v)}
                      disabled={!harmanBassRolloffEnabled}
                    />
                    <div className="flex justify-between text-xs text-gray-600">
                      <span>6 dB/oct (Gentle)</span>
                      <span>48 dB/oct (Steep)</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* EQ Status */}
            <div className="text-sm text-black bg-gray-50 border border-black p-2">
              <div className="flex justify-between">
                <span>Generated Bands:</span>
                <span className="font-mono">{eqBandCount}</span>
              </div>
              <div className="text-xs text-gray-600 mt-1">
                Direct target matching with smart peak detection and high-precision corrections
              </div>
            </div>

            {/* EQ Parameters */}
            <div className="space-y-4">
              {/* Number of Bands */}
              <div className="space-y-2">
                <Label className="text-sm text-black">Number of EQ Bands</Label>
                <Select
                  value={eqNumBands.toString()}
                  onValueChange={(value) => onEqNumBandsChange(parseInt(value))}
                >
                  <SelectTrigger className="w-full border-black">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="8">8 Bands</SelectItem>
                    <SelectItem value="16">16 Bands</SelectItem>
                    <SelectItem value="20">20 Bands</SelectItem>
                    <SelectItem value="25">25 Bands (Default)</SelectItem>
                    <SelectItem value="32">32 Bands</SelectItem>
                    <SelectItem value="64">64 Bands</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Max Boost */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <Label className="text-black">Max Boost (dB)</Label>
                  <span className="font-mono text-sm text-black bg-white border border-black px-2 py-0.5">
                    {eqMaxBoost.toFixed(1)} dB
                  </span>
                </div>
                <Slider
                  min={0}
                  max={12}
                  step={0.1}
                  value={[eqMaxBoost]}
                  onValueChange={([v]) => onEqMaxBoostChange(v)}
                />
                <div className="flex justify-between text-xs text-gray-600">
                  <span>0dB</span>
                  <span>12dB</span>
                </div>
              </div>

              {/* Max Cut */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <Label className="text-black">Max Cut (dB)</Label>
                  <span className="font-mono text-sm text-black bg-white border border-black px-2 py-0.5">
                    {eqMaxCut.toFixed(1)} dB
                  </span>
                </div>
                <Slider
                  min={3}
                  max={30}
                  step={0.5}
                  value={[eqMaxCut]}
                  onValueChange={([v]) => onEqMaxCutChange(v)}
                />
                <div className="flex justify-between text-xs text-gray-600">
                  <span>3dB</span>
                  <span>30dB</span>
                </div>
              </div>

              {/* Smoothing */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <Label className="text-black">Smoothing</Label>
                  <span className="font-mono text-sm text-black bg-white border border-black px-2 py-0.5">
                    {(eqSmoothing * 100).toFixed(0)}%
                  </span>
                </div>
                <Slider
                  min={0}
                  max={0.8}
                  step={0.05}
                  value={[eqSmoothing]}
                  onValueChange={([v]) => onEqSmoothingChange(v)}
                />
              </div>
            </div>

            {/* Display Options */}
            <div className="pt-3 border-t border-black space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="showEQCurve" className="text-sm text-black">Show EQ Curve</Label>
                <Checkbox
                  id="showEQCurve"
                  checked={showEQCurve}
                  onCheckedChange={onShowEQCurveChange}
                  aria-label="Show EQ curve on chart"
                />
              </div>
            </div>

            {/* Generate and Export Buttons */}
            <div className="pt-3 border-t border-black space-y-3">
              {/* Generate EQ Button */}
              <Button
                onClick={onGenerateEQ}
                className="w-full bg-black text-white hover:bg-gray-800 border-black"
              >
               Generate EQ
              </Button>
              
              {/* Export Button */}
              <Button
                onClick={onExportEQ}
                disabled={eqBandCount === 0}
                className="w-full bg-black text-white hover:bg-gray-800 border-black"
              >
                Export Standard EQ Settings
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}