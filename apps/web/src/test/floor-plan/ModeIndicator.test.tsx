import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModeIndicator } from '@/features/floor-plan/ModeIndicator';
import type { PositionEstimateRow } from '@/lib/usePatientStream';

function row(overrides: Partial<PositionEstimateRow>): PositionEstimateRow {
  return {
    id: 'pe-1',
    patient_id: 'p-1',
    recorded_at: '2026-05-05T12:00:00Z',
    mode: 'indoor',
    x_canvas: 100,
    y_canvas: 200,
    lat: null,
    lng: null,
    confidence: 0.8,
    created_at: '2026-05-05T12:00:00Z',
    ...overrides,
  };
}

describe('ModeIndicator', () => {
  it('renders "No fix" when no estimate is supplied', () => {
    render(<ModeIndicator estimate={undefined} />);
    expect(screen.getByText(/no fix/i)).toBeTruthy();
  });

  it('renders "Indoor" when the estimate is in indoor mode', () => {
    render(<ModeIndicator estimate={row({ mode: 'indoor' })} />);
    expect(screen.getByText(/indoor/i)).toBeTruthy();
    expect(screen.queryByText(/outdoor/i)).toBeNull();
  });

  it('renders "Outdoor" when the estimate is in outdoor mode', () => {
    render(<ModeIndicator estimate={row({ mode: 'outdoor', x_canvas: null, y_canvas: null })} />);
    expect(screen.getByText(/outdoor/i)).toBeTruthy();
    expect(screen.queryByText(/^indoor$/i)).toBeNull();
  });
});
