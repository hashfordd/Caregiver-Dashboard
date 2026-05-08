import {
  ChevronDown,
  Eraser,
  Eye,
  EyeOff,
  Lock,
  Maximize2,
  MoreHorizontal,
  MousePointer2,
  Pencil,
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
  X,
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
  showDimensions: boolean;
  editing: boolean;
  onModeChange: (mode: ToolMode) => void;
  onFurnitureKindChange: (kind: FurnitureKind) => void;
  onSetScale: () => void;
  onSetWallLength: () => void;
  onSave: () => void;
  onDelete: () => void;
  onReset: () => void;
  /** True when the canvas has at least one wall/room/furniture object —
   *  the Reset button is hidden until then so a fresh canvas isn't
   *  cluttered with a destructive action that does nothing. */
  canReset: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onFitToContent: () => void;
  onToggleDimensions: () => void;
  onEdit: () => void;
  onDiscard: () => void;
}

export function Toolbar({
  mode,
  furnitureKind,
  scaleLabel,
  scaleSet,
  selection,
  dirty,
  saving,
  showDimensions,
  editing,
  onModeChange,
  onFurnitureKindChange,
  onSetScale,
  onSetWallLength,
  onSave,
  onDelete,
  onReset,
  canReset,
  onUndo,
  onRedo,
  onFitToContent,
  onToggleDimensions,
  onEdit,
  onDiscard,
}: ToolbarProps) {
  const wallSelected = selection.kind === 'wall';
  const furnitureActive = mode === 'furniture';
  const FurnitureIcon = furnitureIcon(furnitureKind);
  // When the floor plan is locked the user can still pan / zoom / toggle
  // dimension labels, but every action that mutates geometry is disabled.
  const toolsDisabled = !editing;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
      <ModeButton
        active={mode === 'select'}
        onClick={() => onModeChange('select')}
        icon={MousePointer2}
        label="Select"
        disabled={toolsDisabled}
      />
      <ModeButton
        active={mode === 'wall'}
        onClick={() => onModeChange('wall')}
        icon={Slash}
        label="Wall"
        disabled={toolsDisabled}
      />
      <ModeButton
        active={mode === 'room'}
        onClick={() => onModeChange('room')}
        icon={Square}
        label="Room"
        disabled={toolsDisabled}
      />
      <ModeButton
        active={mode === 'polygon'}
        onClick={() => onModeChange('polygon')}
        icon={Pentagon}
        label="Polygon"
        disabled={toolsDisabled}
      />
      <div className="mx-1 h-6 w-px bg-border" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={furnitureActive ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={furnitureActive}
            className={cn('gap-1.5', furnitureActive && 'shadow-sm')}
            title={toolsDisabled ? 'Click Edit to enable' : 'Pick a furniture item to place'}
            disabled={toolsDisabled}
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
      {/* Secondary actions — visible inline on md+, collapsed into a
          "…" overflow dropdown under md so the toolbar fits on tablets. */}
      <div className="hidden items-center gap-2 md:flex">
        <Button
          variant="ghost"
          size="sm"
          onClick={onUndo}
          disabled={toolsDisabled}
          aria-label="Undo (Cmd+Z)"
          title="Undo (Cmd/Ctrl + Z)"
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRedo}
          disabled={toolsDisabled}
          aria-label="Redo (Cmd+Shift+Z)"
          title="Redo (Cmd/Ctrl + Shift + Z)"
        >
          <Redo2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={toolsDisabled}
          aria-label="Delete selected"
          title="Delete selected (Backspace)"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={toolsDisabled || !canReset}
          aria-label="Clear canvas"
          title="Clear every wall, room, and furniture (undoable)"
        >
          <Eraser className="h-4 w-4" />
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
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleDimensions}
          aria-pressed={!showDimensions}
          aria-label={showDimensions ? 'Hide dimensions' : 'Show dimensions'}
          title={showDimensions ? 'Hide dimension labels' : 'Show dimension labels'}
        >
          {showDimensions ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </Button>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="md:hidden"
            aria-label="More actions"
            title="More actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={onUndo} disabled={toolsDisabled}>
            <Undo2 className="mr-2 h-4 w-4" />
            Undo
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onRedo} disabled={toolsDisabled}>
            <Redo2 className="mr-2 h-4 w-4" />
            Redo
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onDelete} disabled={toolsDisabled}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete selected
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onReset} disabled={toolsDisabled || !canReset}>
            <Eraser className="mr-2 h-4 w-4" />
            Clear canvas
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onFitToContent}>
            <Maximize2 className="mr-2 h-4 w-4" />
            Fit to content
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggleDimensions}>
            {showDimensions ? (
              <Eye className="mr-2 h-4 w-4" />
            ) : (
              <EyeOff className="mr-2 h-4 w-4" />
            )}
            {showDimensions ? 'Hide dimensions' : 'Show dimensions'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="mx-1 h-6 w-px bg-border" />
      <Button
        variant="outline"
        size="sm"
        onClick={onSetScale}
        disabled={toolsDisabled || !wallSelected}
        title={wallSelected ? 'Anchor pixels to metres using this wall' : 'Select a wall first'}
      >
        <Ruler className="h-4 w-4" />
        Set scale
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onSetWallLength}
        disabled={toolsDisabled || !wallSelected || !scaleSet}
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
        {!editing && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" />
            Read-only
          </span>
        )}
        {editing && selection.kind === 'multi' && (
          <span className="text-xs text-muted-foreground">{selection.count} selected</span>
        )}
        {editing && dirty && <span className="text-xs text-muted-foreground">unsaved</span>}
        {!editing ? (
          <Button onClick={onEdit} size="sm">
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
        ) : (
          <>
            <Button
              onClick={onDiscard}
              variant="outline"
              size="sm"
              disabled={saving}
              title="Discard changes and revert to the last saved version"
            >
              <X className="h-4 w-4" />
              Discard
            </Button>
            <Button onClick={onSave} disabled={saving || !dirty} size="sm">
              <Save className="h-4 w-4" />
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

interface ModeButtonProps {
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
}

function ModeButton({ active, onClick, icon: Icon, label, disabled }: ModeButtonProps) {
  return (
    <Button
      variant={active ? 'secondary' : 'ghost'}
      size="sm"
      onClick={onClick}
      aria-pressed={active}
      disabled={disabled}
      className={cn('gap-1.5', active && 'shadow-sm')}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}

// Re-export for any caller that wants the icon without depending on lucide
export { Sofa };
