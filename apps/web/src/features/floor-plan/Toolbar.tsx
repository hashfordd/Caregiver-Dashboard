import {
  Armchair,
  Bed,
  Building2,
  Maximize2,
  MousePointer2,
  Redo2,
  Ruler,
  Save,
  Slash,
  Square,
  Trash2,
  Undo2,
  Utensils,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { FurnitureKind, ToolMode } from './types';

interface ToolbarProps {
  mode: ToolMode;
  furnitureKind: FurnitureKind;
  scaleLabel: string;
  dirty: boolean;
  saving: boolean;
  canSetScale: boolean;
  onModeChange: (mode: ToolMode) => void;
  onFurnitureKindChange: (kind: FurnitureKind) => void;
  onSetScale: () => void;
  onSave: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onFitToContent: () => void;
}

const FURNITURE_OPTIONS: { kind: FurnitureKind; icon: typeof Bed; label: string }[] = [
  { kind: 'bed', icon: Bed, label: 'Bed' },
  { kind: 'chair', icon: Armchair, label: 'Chair' },
  { kind: 'table', icon: Square, label: 'Table' },
  { kind: 'toilet', icon: Building2, label: 'Toilet' },
  { kind: 'kitchen', icon: Utensils, label: 'Kitchen' },
];

export function Toolbar({
  mode,
  furnitureKind,
  scaleLabel,
  dirty,
  saving,
  canSetScale,
  onModeChange,
  onFurnitureKindChange,
  onSetScale,
  onSave,
  onDelete,
  onUndo,
  onRedo,
  onFitToContent,
}: ToolbarProps) {
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
      <div className="mx-1 h-6 w-px bg-border" />
      {FURNITURE_OPTIONS.map((opt) => (
        <ModeButton
          key={opt.kind}
          active={mode === 'furniture' && furnitureKind === opt.kind}
          onClick={() => {
            onFurnitureKindChange(opt.kind);
            onModeChange('furniture');
          }}
          icon={opt.icon}
          label={opt.label}
        />
      ))}
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
      <Button variant="outline" size="sm" onClick={onSetScale} disabled={!canSetScale}>
        <Ruler className="h-4 w-4" />
        Set scale
      </Button>
      <span className="ml-1 text-xs text-muted-foreground">{scaleLabel}</span>

      <div className="ml-auto flex items-center gap-2">
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
  icon: typeof Bed;
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
