import {
  ChevronDown,
  Maximize2,
  MousePointer2,
  Pentagon,
  Redo2,
  Ruler,
  Save,
  Slash,
  Sofa,
  Square,
  StretchHorizontal,
  Trash2,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { FURNITURE_KINDS, furnitureIcon, furnitureLabel } from './furniture';
import type { FurnitureKind, SelectionDescriptor, ToolMode } from './types';

interface ToolbarProps {
  mode: ToolMode;
  furnitureKind: FurnitureKind;
  scaleLabel: string;
  scaleSet: boolean;
  selection: SelectionDescriptor;
  dirty: boolean;
  saving: boolean;
  onModeChange: (mode: ToolMode) => void;
  onFurnitureKindChange: (kind: FurnitureKind) => void;
  onSetScale: () => void;
  onSetWallLength: () => void;
  onSave: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onFitToContent: () => void;
}

export function Toolbar({
  mode,
  furnitureKind,
  scaleLabel,
  scaleSet,
  selection,
  dirty,
  saving,
  onModeChange,
  onFurnitureKindChange,
  onSetScale,
  onSetWallLength,
  onSave,
  onDelete,
  onUndo,
  onRedo,
  onFitToContent,
}: ToolbarProps) {
  const wallSelected = selection.kind === 'wall';
  const furnitureActive = mode === 'furniture';
  const FurnitureIcon = furnitureIcon(furnitureKind);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
      <ModeButton
        active={mode === 'select'}
        onClick={() => onModeChange('select')}
        icon={MousePointer2}
        label="Select"
      />
      <ModeButton
        active={mode === 'wall'}
        onClick={() => onModeChange('wall')}
        icon={Slash}
        label="Wall"
      />
      <ModeButton
        active={mode === 'room'}
        onClick={() => onModeChange('room')}
        icon={Square}
        label="Room"
      />
      <ModeButton
        active={mode === 'polygon'}
        onClick={() => onModeChange('polygon')}
        icon={Pentagon}
        label="Polygon"
      />
      <div className="mx-1 h-6 w-px bg-border" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={furnitureActive ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={furnitureActive}
            className={cn('gap-1.5', furnitureActive && 'shadow-sm')}
            title="Pick a furniture item to place"
          >
            <FurnitureIcon className="h-4 w-4" />
            <span className="hidden sm:inline">{furnitureLabel(furnitureKind)}</span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[60vh] overflow-y-auto">
          {FURNITURE_KINDS.map((kind) => {
            const Icon = furnitureIcon(kind);
            return (
              <DropdownMenuItem
                key={kind}
                onSelect={() => {
                  onFurnitureKindChange(kind);
                  onModeChange('furniture');
                }}
              >
                <Icon className="mr-2 h-4 w-4" />
                <span>{furnitureLabel(kind)}</span>
                {kind === furnitureKind && <span className="ml-auto text-xs">·</span>}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="mx-1 h-6 w-px bg-border" />
      <Button
        variant="ghost"
        size="sm"
        onClick={onUndo}
        aria-label="Undo (Cmd+Z)"
        title="Undo (Cmd/Ctrl + Z)"
      >
        <Undo2 className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRedo}
        aria-label="Redo (Cmd+Shift+Z)"
        title="Redo (Cmd/Ctrl + Shift + Z)"
      >
        <Redo2 className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onDelete}
        aria-label="Delete selected"
        title="Delete selected (Backspace)"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onFitToContent}
        aria-label="Fit to content"
        title="Fit drawing to view"
      >
        <Maximize2 className="h-4 w-4" />
      </Button>
      <div className="mx-1 h-6 w-px bg-border" />
      <Button
        variant="outline"
        size="sm"
        onClick={onSetScale}
        disabled={!wallSelected}
        title={wallSelected ? 'Anchor pixels to metres using this wall' : 'Select a wall first'}
      >
        <Ruler className="h-4 w-4" />
        Set scale
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onSetWallLength}
        disabled={!wallSelected || !scaleSet}
        title={
          !wallSelected
            ? 'Select a wall first'
            : !scaleSet
              ? 'Set scale first'
              : 'Set this wall’s length in metres'
        }
      >
        <StretchHorizontal className="h-4 w-4" />
        Set length
      </Button>
      <span className="ml-1 text-xs text-muted-foreground">{scaleLabel}</span>

      <div className="ml-auto flex items-center gap-2">
        {selection.kind === 'multi' && (
          <span className="text-xs text-muted-foreground">{selection.count} selected</span>
        )}
        {dirty && <span className="text-xs text-muted-foreground">unsaved</span>}
        <Button onClick={onSave} disabled={saving || !dirty} size="sm">
          <Save className="h-4 w-4" />
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

interface ModeButtonProps {
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
  label: string;
}

function ModeButton({ active, onClick, icon: Icon, label }: ModeButtonProps) {
  return (
    <Button
      variant={active ? 'secondary' : 'ghost'}
      size="sm"
      onClick={onClick}
      aria-pressed={active}
      className={cn('gap-1.5', active && 'shadow-sm')}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}

// Re-export for any caller that wants the icon without depending on lucide
export { Sofa };
