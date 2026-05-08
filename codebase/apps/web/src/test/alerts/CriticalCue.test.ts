import { describe, it, expect, vi, beforeEach } from 'vitest';

const PERMISSION_KEY = 'alzcare:notification_permission_prompted';

let permissionState: NotificationPermission = 'default';
const requestPermissionMock = vi.fn(async () => permissionState);

class FakeNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission = requestPermissionMock;
  title: string;
  body: string;
  tag?: string;
  onclick: (() => void) | null = null;
  constructor(title: string, opts?: NotificationOptions) {
    this.title = title;
    this.body = opts?.body ?? '';
    this.tag = opts?.tag;
    constructed.push(this);
  }
}

const constructed: FakeNotification[] = [];

beforeEach(() => {
  constructed.length = 0;
  permissionState = 'default';
  FakeNotification.permission = 'default';
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.stubGlobal('Notification', FakeNotification);
});

describe('CriticalCue.requestNotificationPermission', () => {
  it('prompts at-most-once per session', async () => {
    const { requestNotificationPermission } = await import('@/features/alerts/CriticalCue');
    permissionState = 'granted';
    await requestNotificationPermission();
    expect(requestPermissionMock).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(PERMISSION_KEY)).toBe('1');
    // Second call within the same session: still permission='default'
    // (we mocked it, but in reality the prompt would have set it).
    // Reset Notification.permission to default to simulate a denied
    // browser-side prompt; the guard should still suppress the second
    // requestPermission() call.
    FakeNotification.permission = 'default';
    await requestNotificationPermission();
    expect(requestPermissionMock).toHaveBeenCalledTimes(1);
  });

  it('skips the prompt entirely when the browser already granted permission', async () => {
    FakeNotification.permission = 'granted';
    const { requestNotificationPermission } = await import('@/features/alerts/CriticalCue');
    const result = await requestNotificationPermission();
    expect(result).toBe('granted');
    expect(requestPermissionMock).not.toHaveBeenCalled();
  });
});

describe('CriticalCue.showCriticalNotification', () => {
  it('does not fire when document is visible', async () => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    FakeNotification.permission = 'granted';
    const { showCriticalNotification } = await import('@/features/alerts/CriticalCue');
    const result = showCriticalNotification({ title: 'x', body: 'y' });
    expect(result).toBe(false);
    expect(constructed).toHaveLength(0);
  });

  it('fires when document is hidden and permission is granted', async () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    FakeNotification.permission = 'granted';
    const { showCriticalNotification } = await import('@/features/alerts/CriticalCue');
    const result = showCriticalNotification({ title: 'Critical', body: 'Patient X', tag: 'a-1' });
    expect(result).toBe(true);
    expect(constructed).toHaveLength(1);
    expect(constructed[0]?.title).toBe('Critical');
    expect(constructed[0]?.tag).toBe('a-1');
  });

  it('does not fire when permission is denied', async () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    FakeNotification.permission = 'denied';
    const { showCriticalNotification } = await import('@/features/alerts/CriticalCue');
    const result = showCriticalNotification({ title: 'x', body: 'y' });
    expect(result).toBe(false);
    expect(constructed).toHaveLength(0);
  });
});
