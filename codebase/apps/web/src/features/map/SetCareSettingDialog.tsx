import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Map, { Marker } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Crosshair, Home, Navigation, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { hasMapboxToken, mapboxToken } from '@/lib/env';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { PositionEstimateRow } from '@/lib/usePatientStream';

interface SetCareSettingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  /** Existing values from the patient row, if any. */
  initialLat: number | null;
  initialLng: number | null;
  initialLabel: string | null;
  /** Latest live outdoor fix — used by the "Autofill" button so the
   *  caregiver doesn't have to copy/paste coords. */
  latestEstimate?: PositionEstimateRow;
}

const FALLBACK_CENTER = { latitude: -37.8136, longitude: 144.9631 }; // Melbourne CBD

export function SetCareSettingDialog({
  open,
  onOpenChange,
  patientId,
  initialLat,
  initialLng,
  initialLabel,
  latestEstimate,
}: SetCareSettingDialogProps) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(initialLabel ?? '');
  const [lat, setLat] = useState<number | null>(initialLat);
  const [lng, setLng] = useState<number | null>(initialLng);
  const [error, setError] = useState<string | null>(null);

  // Reset form when the dialog opens for a (potentially different)
  // patient so a previous edit's draft doesn't leak across.
  useEffect(() => {
    if (open) {
      setLabel(initialLabel ?? '');
      setLat(initialLat);
      setLng(initialLng);
      setError(null);
    }
  }, [open, initialLabel, initialLat, initialLng]);

  const mutation = useMutation({
    mutationFn: async (values: {
      lat: number | null;
      lng: number | null;
      label: string | null;
    }) => {
      const { error: updateError } = await supabase
        .from('patients')
        .update({
          care_setting_lat: values.lat,
          care_setting_lng: values.lng,
          care_setting_label: values.label,
        })
        .eq('id', patientId);
      if (updateError) throw updateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patients', 'detail', patientId] });
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  function handleSave() {
    setError(null);
    const bothNull = lat == null && lng == null;
    const bothSet = lat != null && lng != null;
    if (!bothNull && !bothSet) {
      setError('Latitude and longitude must both be set or both be cleared.');
      return;
    }
    if (lat != null && (lat < -90 || lat > 90)) {
      setError('Latitude must be between −90 and 90.');
      return;
    }
    if (lng != null && (lng < -180 || lng > 180)) {
      setError('Longitude must be between −180 and 180.');
      return;
    }
    const trimmedLabel = label.trim();
    if (trimmedLabel.length > 120) {
      setError('Label must be 120 characters or fewer.');
      return;
    }
    mutation.mutate({
      lat,
      lng,
      label: trimmedLabel ? trimmedLabel : null,
    });
  }

  function handleClear() {
    mutation.mutate({ lat: null, lng: null, label: null });
  }

  function handleAutofill() {
    if (!latestEstimate?.lat || !latestEstimate?.lng) return;
    setLat(latestEstimate.lat);
    setLng(latestEstimate.lng);
  }

  // One-shot getCurrentPosition rather than the watch-based hook used
  // elsewhere — we only need a single fix to anchor the care setting.
  // The browser permission prompt fires here on first use.
  const [locating, setLocating] = useState(false);
  function handleUseMyLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Geolocation is not available in this browser.');
      return;
    }
    setError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(Number(pos.coords.latitude.toFixed(6)));
        setLng(Number(pos.coords.longitude.toFixed(6)));
        setLocating(false);
      },
      (err) => {
        const reason =
          err.code === 1
            ? 'Location permission was denied. Update browser site settings to enable it.'
            : `Couldn't read your location: ${err.message}`;
        setError(reason);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  const canAutofill =
    latestEstimate?.lat != null && latestEstimate?.lng != null && latestEstimate.mode === 'outdoor';
  const hasExistingSetting = initialLat != null && initialLng != null;
  const mapCenter =
    lat != null && lng != null
      ? { latitude: lat, longitude: lng }
      : initialLat != null && initialLng != null
        ? { latitude: initialLat, longitude: initialLng }
        : latestEstimate?.lat != null && latestEstimate?.lng != null
          ? { latitude: latestEstimate.lat, longitude: latestEstimate.lng }
          : FALLBACK_CENTER;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Home className="h-4 w-4" /> Set care setting location
          </DialogTitle>
          <DialogDescription>
            Mark the patient's home base. Click the map to drop a pin, type the coordinates
            manually, or autofill from the latest live GPS fix.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2">
            <Label htmlFor="care-setting-label">Label</Label>
            <Input
              id="care-setting-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Home"
              maxLength={120}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              <Label htmlFor="care-setting-lat">Latitude</Label>
              <Input
                id="care-setting-lat"
                type="number"
                step="any"
                inputMode="decimal"
                value={lat ?? ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  setLat(raw === '' ? null : Number.parseFloat(raw));
                }}
                placeholder="-37.8136"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="care-setting-lng">Longitude</Label>
              <Input
                id="care-setting-lng"
                type="number"
                step="any"
                inputMode="decimal"
                value={lng ?? ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  setLng(raw === '' ? null : Number.parseFloat(raw));
                }}
                placeholder="144.9631"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleUseMyLocation}
              disabled={locating}
            >
              <Navigation className="mr-1 h-4 w-4" />
              {locating ? 'Locating…' : 'Use my location'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleAutofill}
              disabled={!canAutofill}
            >
              <Crosshair className="mr-1 h-4 w-4" />
              {canAutofill ? "Use patient's last GPS fix" : 'No live patient fix'}
            </Button>
          </div>
          {hasMapboxToken() ? (
            <div className="aspect-[4/3] max-h-[320px] w-full overflow-hidden rounded-md border border-border">
              <Map
                mapboxAccessToken={mapboxToken}
                initialViewState={{
                  latitude: mapCenter.latitude,
                  longitude: mapCenter.longitude,
                  zoom: 14,
                }}
                mapStyle="mapbox://styles/mapbox/streets-v12"
                style={{ width: '100%', height: '100%' }}
                onClick={(e) => {
                  setLat(Number(e.lngLat.lat.toFixed(6)));
                  setLng(Number(e.lngLat.lng.toFixed(6)));
                }}
              >
                {lat != null && lng != null && (
                  <Marker latitude={lat} longitude={lng} anchor="bottom">
                    <div className="rounded-full bg-amber-600 p-1.5 text-white shadow-[0_0_0_3px_rgba(255,255,255,0.85)]">
                      <Home className="h-4 w-4" />
                    </div>
                  </Marker>
                )}
              </Map>
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              Map preview hidden because VITE_MAPBOX_TOKEN isn't set. Coordinates can still be
              entered manually above.
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter className="flex flex-row flex-wrap items-center justify-between gap-2 sm:justify-between">
          <div>
            {hasExistingSetting && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClear}
                disabled={mutation.isPending}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="mr-1 h-4 w-4" /> Clear
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
