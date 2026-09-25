// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchTopWebOverlayKeyDown, useWebOverlayRegistration } from "./overlay-root";

describe("useWebOverlayRegistration", () => {
  let opener: HTMLButtonElement;
  let input: HTMLInputElement;
  let scope: HTMLDivElement;

  beforeEach(() => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    opener = document.createElement("button");
    input = document.createElement("input");
    scope = document.createElement("div");
    scope.tabIndex = -1;
    scope.append(input);
    document.body.append(opener, scope);
    opener.focus();
    expect(document.activeElement).toBe(opener);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("does not restore opener focus when an active overlay scope detaches", () => {
    const { result, unmount } = renderHook(() =>
      useWebOverlayRegistration({ active: true, layer: 20, onKeyDown: () => false }),
    );

    act(() => result.current(scope));
    const openerFocus = vi.spyOn(opener, "focus");
    input.focus();
    expect(document.activeElement).toBe(input);

    act(() => result.current(null));

    expect(openerFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    unmount();
  });

  it("restores opener focus after the closing commit", async () => {
    const { result, rerender, unmount } = renderHook(
      ({ active }: { active: boolean }) =>
        useWebOverlayRegistration({ active, layer: 20, onKeyDown: () => false }),
      { initialProps: { active: true } },
    );

    act(() => result.current(scope));
    const openerFocus = vi.spyOn(opener, "focus");
    input.focus();
    expect(document.activeElement).toBe(input);

    act(() => rerender({ active: false }));
    // React may restore the previously focused node during its mutation phase.
    input.focus();
    await act(async () => {});

    expect(document.activeElement).toBe(opener);
    expect(openerFocus).toHaveBeenCalled();
    unmount();
  });

  it("restores opener focus when an active overlay unmounts after its scope detaches", async () => {
    const { result, unmount } = renderHook(() =>
      useWebOverlayRegistration({ active: true, layer: 20, onKeyDown: () => false }),
    );

    act(() => result.current(scope));
    const openerFocus = vi.spyOn(opener, "focus");
    input.focus();
    expect(document.activeElement).toBe(input);

    act(() => result.current(null));
    expect(openerFocus).not.toHaveBeenCalled();

    unmount();
    await act(async () => {});

    expect(openerFocus).toHaveBeenCalled();
  });

  it("does not restore into an overlay covered by a newly opened overlay", async () => {
    const first = renderHook(
      ({ active }: { active: boolean }) =>
        useWebOverlayRegistration({ active, layer: 20, onKeyDown: () => false }),
      { initialProps: { active: true } },
    );
    act(() => first.result.current(scope));
    input.focus();
    act(() => first.rerender({ active: false }));

    const nextScope = document.createElement("div");
    const nextInput = document.createElement("input");
    nextScope.append(nextInput);
    document.body.append(nextScope);
    const next = renderHook(() =>
      useWebOverlayRegistration({ active: true, layer: 30, onKeyDown: () => false }),
    );
    act(() => next.result.current(nextScope));
    nextInput.focus();
    await act(async () => {});

    expect(document.activeElement).toBe(nextInput);
    next.unmount();
    first.unmount();
    await act(async () => {});
  });

  it("leaves IME composition keys with the focused editor", () => {
    const event = new KeyboardEvent("keydown", { key: "Process", bubbles: true });
    expect(dispatchTopWebOverlayKeyDown(event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });
});
