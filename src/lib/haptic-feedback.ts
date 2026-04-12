/**
 * Haptic Feedback — Tactile feedback for mobile operators
 *
 * Uses the Vibration API for tactile confirmation on mobile devices.
 * Falls back gracefully on devices without vibration support.
 *
 * Usage:
 *   hapticSuccess() — after successful report submit
 *   hapticClick() — on button press
 *   hapticError() — on error
 *
 * Patterns (from MDN):
 *   [50] — short pulse
 *   [30, 50, 30] — double pulse with gap
 *   [100, 50, 100, 50, 200] — success pattern
 */

export function vibrate(pattern: number | number[]): boolean {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    return navigator.vibrate(pattern);
  }
  return false;
}

export function hapticClick(): boolean {
  return vibrate(10); // Very short tap
}

export function hapticSuccess(): boolean {
  return vibrate([50, 30, 100]); // Short-gap-long = success feel
}

export function hapticError(): boolean {
  return vibrate([200, 50, 200]); // Long-gap-long = error feel
}

export function hapticSubmit(): boolean {
  return vibrate([100, 50, 100, 50, 200]); // Report submitted
}
