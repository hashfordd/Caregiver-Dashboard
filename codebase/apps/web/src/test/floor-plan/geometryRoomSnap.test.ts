import * as fabric from 'fabric';
import { describe, expect, it } from 'vitest';
import { orderedLoopVertices, snapToWall, type WallSegment } from '@/features/floor-plan/geometry';

function wall(x1: number, y1: number, x2: number, y2: number): fabric.Line {
  const line = new fabric.Line([x1, y1, x2, y2]);
  (line as unknown as { __fpKind?: string }).__fpKind = 'wall';
  return line;
}

describe('snapToWall', () => {
  const square: WallSegment[] = [
    { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
    { a: { x: 100, y: 0 }, b: { x: 100, y: 100 } },
    { a: { x: 100, y: 100 }, b: { x: 0, y: 100 } },
    { a: { x: 0, y: 100 }, b: { x: 0, y: 0 } },
  ];

  it('projects a near-wall point onto the wall', () => {
    const r = snapToWall({ x: 50, y: 6 }, square, 12);
    expect(r.snapped).toBe(true);
    expect(r.x).toBeCloseTo(50, 6);
    expect(r.y).toBeCloseTo(0, 6);
  });

  it('does not snap when no wall is within threshold', () => {
    const r = snapToWall({ x: 50, y: 40 }, square, 12);
    expect(r.snapped).toBe(false);
    expect(r).toMatchObject({ x: 50, y: 40 });
  });

  it('clamps the projection past a segment end to its nearer corner', () => {
    // A lone horizontal wall; a point beyond its right end clamps to (100, 0).
    const lone: WallSegment[] = [{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }];
    const r = snapToWall({ x: 130, y: 4 }, lone, 40);
    expect(r.snapped).toBe(true);
    expect(r.x).toBeCloseTo(100, 6);
    expect(r.y).toBeCloseTo(0, 6);
  });
});

describe('orderedLoopVertices', () => {
  it('orders a ring of four walls into a loop regardless of input order', () => {
    const lines = [
      wall(0, 100, 0, 0), // left
      wall(100, 0, 100, 100), // right
      wall(0, 0, 100, 0), // top
      wall(100, 100, 0, 100), // bottom
    ];
    const verts = orderedLoopVertices(lines);
    expect(verts).not.toBeNull();
    expect(verts).toHaveLength(4);
    // Every corner of the square appears exactly once.
    const corners = new Set(verts!.map((v) => `${Math.round(v.x)}:${Math.round(v.y)}`));
    expect(corners).toEqual(new Set(['0:0', '100:0', '100:100', '0:100']));
  });

  it('returns null for an open chain', () => {
    const lines = [wall(0, 0, 100, 0), wall(100, 0, 100, 100)];
    expect(orderedLoopVertices(lines)).toBeNull();
  });

  it('returns null for two disjoint triangles', () => {
    const tri = (ox: number) => [
      wall(ox + 0, 0, ox + 50, 0),
      wall(ox + 50, 0, ox + 25, 40),
      wall(ox + 25, 40, ox + 0, 0),
    ];
    expect(orderedLoopVertices([...tri(0), ...tri(500)])).toBeNull();
  });
});
