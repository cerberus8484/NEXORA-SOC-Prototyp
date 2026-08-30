/**
 * Tests for useFocusTrap hook.
 * Uses jsdom (vitest environment). No Buffer/Node APIs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFocusTrap } from './useFocusTrap';

// Helper: create a minimal focusable DOM structure.
function makeFocusableContainer() {
  const container = document.createElement('div');
  const btn1 = document.createElement('button');
  btn1.textContent = 'First';
  const btn2 = document.createElement('button');
  btn2.textContent = 'Second';
  const btn3 = document.createElement('button');
  btn3.textContent = 'Close';
  container.appendChild(btn1);
  container.appendChild(btn2);
  container.appendChild(btn3);
  document.body.appendChild(container);
  return { container, btn1, btn2, btn3 };
}

function cleanup(container: HTMLElement) {
  document.body.removeChild(container);
}

describe('useFocusTrap', () => {
  beforeEach(() => {
    // Clear body between tests
    document.body.innerHTML = '';
  });

  it('does nothing when isOpen is false', () => {
    const { container } = makeFocusableContainer();
    const ref = { current: container };
    const onClose = vi.fn();

    renderHook(() => useFocusTrap(ref, false, onClose));

    // No focus trap installed: no errors, onClose not called
    expect(onClose).not.toHaveBeenCalled();
    cleanup(container);
  });

  it('calls onClose when Escape is pressed and isOpen is true', () => {
    const { container } = makeFocusableContainer();
    const ref = { current: container };
    const onClose = vi.fn();

    renderHook(() => useFocusTrap(ref, true, onClose));

    act(() => {
      const evt = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(evt);
    });

    expect(onClose).toHaveBeenCalledOnce();
    cleanup(container);
  });

  it('does not call onClose for non-Escape keys', () => {
    const { container } = makeFocusableContainer();
    const ref = { current: container };
    const onClose = vi.fn();

    renderHook(() => useFocusTrap(ref, true, onClose));

    act(() => {
      const evt = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      document.dispatchEvent(evt);
    });

    expect(onClose).not.toHaveBeenCalled();
    cleanup(container);
  });

  it('cleans up listener when isOpen becomes false', () => {
    const { container } = makeFocusableContainer();
    const ref = { current: container };
    const onClose = vi.fn();

    const { rerender } = renderHook(
      ({ open }: { open: boolean }) => useFocusTrap(ref, open, onClose),
      { initialProps: { open: true } },
    );

    // Close the modal
    rerender({ open: false });

    // Escape should no longer fire onClose
    act(() => {
      const evt = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(evt);
    });

    expect(onClose).not.toHaveBeenCalled();
    cleanup(container);
  });
});

describe('useReturnFocus', () => {
  it('is exported from useFocusTrap module', async () => {
    const mod = await import('./useFocusTrap');
    expect(typeof mod.useReturnFocus).toBe('function');
  });
});
