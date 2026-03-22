import { inject, Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { ReaderAnnotationService } from '../features/annotations/annotation-renderer.service';

export interface ViewEvent {
  type: 'load' | 'relocate' | 'error' | 'middle-single-tap' | 'draw-annotation' | 'show-annotation' | 'text-selected';
  detail?: any;
  popupPosition?: { x: number; y: number; showBelow?: boolean };
}

export interface TextSelection {
  text: string;
  cfi: string;
  range: Range;
  index: number;
}

interface ViewCallbacks {
  prev: () => void;
  next: () => void;
  getCFI: (index: number, range: Range) => string | null;
  getContents: () => Array<{ index: number; doc: Document }> | null;
}

@Injectable({
  providedIn: 'root'
})
export class ReaderEventService {
  private readonly DOUBLE_CLICK_INTERVAL_MS = 300;
  private readonly LONG_HOLD_THRESHOLD_MS = 500;
  private readonly LEFT_ZONE_PERCENT = 0.3;
  private readonly RIGHT_ZONE_PERCENT = 0.7;
  private readonly SWIPE_THRESHOLD_PX = 50;

  private annotationService = inject(ReaderAnnotationService);

  private view: any;
  private viewCallbacks: ViewCallbacks | null = null;
  private isNavigating = false;
  private lastClickTime = 0;
  private lastClickZone: 'left' | 'middle' | 'right' | null = null;
  private longHoldTimeout: ReturnType<typeof setTimeout> | null = null;
  private keydownHandler?: (event: KeyboardEvent) => void;
  private clickedDocs = new WeakSet<Document>();

  private touchStartX = 0;
  private touchStartY = 0;
  private touchStartTime = 0;
  private selectionChangeTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastTouchTime = 0;
  private hadSelectionOnTouchStart = false;
  private isTouchActive = false;
  private isBlinking = false;

  private eventSubject = new Subject<ViewEvent>();
  public events$ = this.eventSubject.asObservable();

  initialize(view: any, callbacks: ViewCallbacks): void {
    this.view = view;
    this.viewCallbacks = callbacks;
    this.attachViewEventListeners();
    this.attachKeyboardHandler();
    this.attachWindowMessageHandler();
  }

  destroy(): void {
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = undefined;
    }
    this.view = null;
    this.viewCallbacks = null;
    this.clickedDocs = new WeakSet<Document>();
  }

  emit(event: ViewEvent): void {
    this.eventSubject.next(event);
  }

  private attachViewEventListeners(): void {
    if (!this.view) return;

    this.view.addEventListener('load', (e: any) => {
      this.eventSubject.next({ type: 'load', detail: e.detail });
      if (e.detail?.doc) {
        if (this.keydownHandler) {
          e.detail.doc.addEventListener('keydown', this.keydownHandler);
        }
        this.attachIframeEventHandlers(e.detail.doc);
      }

      const allAnnotations = this.annotationService.getAllAnnotations();
      if (allAnnotations.length > 0 && this.view) {
        setTimeout(() => {
          allAnnotations.forEach(annotation => {
            this.view?.addAnnotation({ value: annotation.value });
          });
        }, 100);
      }
    });

    this.view.addEventListener('relocate', (e: any) => {
      this.eventSubject.next({ type: 'relocate', detail: e.detail });
    });

    this.view.addEventListener('error', (e: any) => {
      this.eventSubject.next({ type: 'error', detail: e.detail });
    });

    this.view.addEventListener('draw-annotation', (e: any) => {
      const { draw, annotation, doc, range } = e.detail;
      const storedStyle = this.annotationService.getAnnotationStyle(annotation.value);
      if (storedStyle) {
        const overlayerStyle = this.annotationService.getOverlayerDrawFunction(storedStyle.style);
        draw(overlayerStyle, { color: storedStyle.color });
      }
      this.eventSubject.next({ type: 'draw-annotation', detail: { annotation, doc, range } });
    });

    this.view.addEventListener('show-annotation', (e: any) => {
      this.eventSubject.next({ type: 'show-annotation', detail: e.detail });
    });
  }

  private attachKeyboardHandler(): void {
    this.keydownHandler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) {
        return;
      }
      const k = event.key;
      if (k === 'ArrowLeft' || k === 'h' || k === 'PageUp') {
        this.viewCallbacks?.prev();
        event.preventDefault();
      } else if (k === 'ArrowRight' || k === 'l' || k === 'PageDown') {
        this.viewCallbacks?.next();
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', this.keydownHandler);
  }

  private attachWindowMessageHandler(): void {
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'iframe-click') {
        this.handleIframeClickMessage(event.data);
      }
    });
  }

  private attachIframeEventHandlers(doc: Document): void {
    if (this.clickedDocs.has(doc)) {
      return;
    }
    this.clickedDocs.add(doc);

    doc.addEventListener('mousedown', () => {
      this.longHoldTimeout = setTimeout(() => {
        this.longHoldTimeout = null;
      }, this.LONG_HOLD_THRESHOLD_MS);
    }, true);

    doc.addEventListener('mouseup', () => {
      this.handleSelectionEnd(doc);
    });

    doc.addEventListener('click', (event: MouseEvent) => {
      // Ignore synthesized mouse events that follow touch events
      if (Date.now() - this.lastTouchTime < 500) {
        return;
      }

      const iframe = doc.defaultView?.frameElement as HTMLIFrameElement | null;
      if (!iframe) return;

      const iframeRect = iframe.getBoundingClientRect();
      const viewportX = iframeRect.left + event.clientX;
      const viewportY = iframeRect.top + event.clientY;

      window.postMessage({
        type: 'iframe-click',
        clientX: viewportX,
        clientY: viewportY,
        iframeLeft: iframeRect.left,
        iframeWidth: iframeRect.width,
        eventClientX: event.clientX,
        target: (event.target as HTMLElement)?.tagName
      }, '*');
    }, true);

    doc.addEventListener('touchstart', (event: TouchEvent) => {
      this.handleTouchStart(event, doc);
    }, { passive: true });

    doc.addEventListener('touchmove', (event: TouchEvent) => {
      this.handleTouchMove(event, doc);
    }, { passive: false });

    doc.addEventListener('touchend', (event: TouchEvent) => {
      this.handleTouchEnd(event, doc);
    }, { passive: false });

    doc.addEventListener('touchcancel', (event: TouchEvent) => {
      this.handleTouchCancel(event);
    }, { passive: false });

    doc.addEventListener('contextmenu', (event: MouseEvent) => {
      // On touch devices, always prevent native context menu to suppress iOS Copy/Define popup
      if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      // On desktop, only prevent if there's a selection
      const selection = doc.defaultView?.getSelection();
      if (selection && !selection.isCollapsed) {
        event.preventDefault();
      }
    }, { capture: true });

    doc.addEventListener('selectionchange', () => {
      this.handleSelectionChange(doc);
    });

    this.injectMobileSelectionStyles(doc);
  }

  private handleSelectionChange(doc: Document): void {
    if (this.selectionChangeTimeout) {
      clearTimeout(this.selectionChangeTimeout);
    }

    // Don't process (and Blink) while user is touching/dragging
    if (this.isTouchActive || this.isBlinking) return;

    // Debounce selection changes (200ms) to detect "pause" in selection if no touch involved
    this.selectionChangeTimeout = setTimeout(() => {
      const selection = doc.defaultView?.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        return;
      }

      const range = selection.getRangeAt(0);
      const text = range.toString().trim();
      if (!text) return;

      if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        this.handleSelectionEnd(doc);
      }
    }, 200);
  }

  private injectMobileSelectionStyles(doc: Document): void {
    // Iframe: force selection allowed + suppress callout
    this.applySelectionStyles(doc, true);
    // Main doc: suppress callout only (don't force selection on UI)
    this.applySelectionStyles(document, false);
  }

  private applySelectionStyles(targetDoc: Document, forceTextSelect: boolean): void {
    const styleId = 'booklore-mobile-selection-styles';
    if (targetDoc.getElementById(styleId)) return;

    const style = targetDoc.createElement('style');
    style.id = styleId;

    // Base styles: suppress callout (menu) on everything, remove tap highlight
    let css = `
      * {
        -webkit-touch-callout: none !important;
        -webkit-tap-highlight-color: transparent !important;
      }
    `;

    // For book content (iframe), we MUST ensure text is selectable
    if (forceTextSelect) {
      css += `
        * {
          -webkit-user-select: text !important;
          user-select: text !important;
        }
        *::selection {
          background-color: rgba(0, 122, 255, 0.3) !important;
        }
      `;
    }

    style.textContent = css;
    targetDoc.head.appendChild(style);
  }

  private handleTouchStart(event: TouchEvent, doc: Document): void {
    if (event.touches.length !== 1) return;

    this.isTouchActive = true;
    const touch = event.touches[0];
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
    this.touchStartTime = Date.now();

    // Remember if there was already a selection when touch started
    const selection = doc.defaultView?.getSelection();
    this.hadSelectionOnTouchStart = !!(selection && !selection.isCollapsed && selection.rangeCount > 0);
  }

  private handleTouchCancel(_event: TouchEvent): void {
    this.isTouchActive = false;
    this.isBlinking = false; // Safety reset
  }

  private handleTouchMove(_event: TouchEvent, _doc: Document): void {
    // Let paginator.js handle swipe vs selection detection
    // We only care about selection results after touchend
  }

  private handleTouchEnd(event: TouchEvent, doc: Document): void {
    this.lastTouchTime = Date.now();
    this.isTouchActive = false;
    const touchDuration = Date.now() - this.touchStartTime;

    if (event.changedTouches.length !== 1) return;

    const touch = event.changedTouches[0];
    const deltaX = Math.abs(touch.clientX - this.touchStartX);
    const deltaY = Math.abs(touch.clientY - this.touchStartY);
    const isQuickTap = touchDuration < 200 && deltaX < 10 && deltaY < 10;

    const selection = doc.defaultView?.getSelection();
    const hasSelection = selection && !selection.isCollapsed && selection.rangeCount > 0;

    // If there's ANY selection (new or extended), show our popup
    // We trigger this ON TOUCH END to ensure we capture the final state
    if (hasSelection) {
      setTimeout(() => {
        this.handleSelectionEnd(doc);
      }, 100); // Standard delay for reliability
      return;
    }

    // Quick tap with NO selection - handle as tap action
    if (isQuickTap) {
      // If there was a selection before but now there isn't, user cleared it via native UI
      if (this.hadSelectionOnTouchStart) {
        this.eventSubject.next({ type: 'text-selected', detail: null });
        return;
      }

      // Tap in middle zone for menu toggle
      const iframe = doc.defaultView?.frameElement as HTMLIFrameElement | null;
      if (!iframe) return;

      const iframeRect = iframe.getBoundingClientRect();
      const viewportX = iframeRect.left + touch.clientX;

      window.postMessage({
        type: 'iframe-click',
        clientX: viewportX,
        clientY: iframeRect.top + touch.clientY,
        iframeLeft: iframeRect.left,
        iframeWidth: iframeRect.width,
        eventClientX: touch.clientX,
        target: (event.target as HTMLElement)?.tagName
      }, '*');
    }
  }

  private handleSelectionEnd(doc: Document): void {
    const selection = doc.defaultView?.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return;
    }

    const originalRange = selection.getRangeAt(0);
    // Clone the range because removeAllRanges() might detach the original one
    const range = originalRange.cloneRange();
    const text = selection.toString().trim();
    if (!text) return;

    // THE HACK: Clear and restore to kill the native iOS menu
    // This flickers the selection for ~10ms but effectively suppresses the system popup
    this.isBlinking = true;

    try {
      selection.removeAllRanges();

      setTimeout(() => {
        try {
          // Re-add the range so our logic can work
          selection.addRange(range);

          // FORCE LAYOUT/EVENTS: Simulate user interaction to ensure popup shows
          // This mimics the "swipe" effect the user described
          doc.dispatchEvent(new Event('selectionchange'));
          doc.defaultView?.scrollBy(0, 1);
          doc.defaultView?.scrollBy(0, -1);
        } catch (e) {
          console.error('Failed to restore selection range', e);
        }

        // Allow time for event propagation to settle before clearing flag
        setTimeout(() => {
          this.isBlinking = false;
        }, 100);

        const contents = this.viewCallbacks?.getContents();
        if (!contents || contents.length === 0) return;

        const { index } = contents[0];
        const cfi = this.viewCallbacks?.getCFI(index, range);

        if (cfi) {
          const iframe = doc.defaultView?.frameElement as HTMLIFrameElement | null;
          const rangeRect = range.getBoundingClientRect();
          let popupX = rangeRect.left + (rangeRect.width / 2);
          let selectionTop = rangeRect.top;
          let selectionBottom = rangeRect.bottom;

          if (iframe) {
            const iframeRect = iframe.getBoundingClientRect();
            popupX = iframeRect.left + rangeRect.left + (rangeRect.width / 2);
            selectionTop = iframeRect.top + rangeRect.top;
            selectionBottom = iframeRect.top + rangeRect.bottom;
          }

          const minSpaceAbove = 120;
          const showBelow = selectionTop < minSpaceAbove;

          let popupY: number;
          if (showBelow) {
            popupY = selectionBottom + 10;
          } else {
            popupY = selectionTop - 50;
          }

          popupX = Math.max(100, Math.min(popupX, window.innerWidth - 150));

          this.eventSubject.next({
            type: 'text-selected',
            detail: { text, cfi, range, index },
            popupPosition: { x: popupX, y: popupY, showBelow }
          });
        }
      }, 10);
    } catch (e) {
      this.isBlinking = false;
    }
  }

  private handleIframeClickMessage(data: any): void {
    if (!this.view) return;

    const now = Date.now();
    const timeSinceLastClick = now - this.lastClickTime;

    const viewRect = this.view.getBoundingClientRect();
    const x = data.clientX - viewRect.left;
    const width = viewRect.width;

    const leftThreshold = width * this.LEFT_ZONE_PERCENT;
    const rightThreshold = width * this.RIGHT_ZONE_PERCENT;

    let currentZone: 'left' | 'middle' | 'right';
    if (x < leftThreshold) {
      currentZone = 'left';
    } else if (x > rightThreshold) {
      currentZone = 'right';
    } else {
      currentZone = 'middle';
    }

    if (timeSinceLastClick < this.DOUBLE_CLICK_INTERVAL_MS && this.lastClickZone === currentZone) {
      this.lastClickTime = now;
      this.lastClickZone = currentZone;

      if (currentZone !== 'middle') {
      }
      return;
    }

    this.lastClickTime = now;
    this.lastClickZone = currentZone;

    setTimeout(() => {
      if (Date.now() - this.lastClickTime >= this.DOUBLE_CLICK_INTERVAL_MS) {
        this.processIframeClick(data);
      }
    }, this.DOUBLE_CLICK_INTERVAL_MS);
  }

  private processIframeClick(data: any): void {
    if (!this.longHoldTimeout) {
      return;
    }

    if (this.isNavigating) {
      return;
    }

    if (!this.view) return;

    const viewRect = this.view.getBoundingClientRect();
    const x = data.clientX - viewRect.left;
    const width = viewRect.width;

    const leftThreshold = width * this.LEFT_ZONE_PERCENT;
    const rightThreshold = width * this.RIGHT_ZONE_PERCENT;

    if (x < leftThreshold) {
      this.isNavigating = true;
      this.viewCallbacks?.prev();
      setTimeout(() => this.isNavigating = false, 300);
    } else if (x > rightThreshold) {
      this.isNavigating = true;
      this.viewCallbacks?.next();
      setTimeout(() => this.isNavigating = false, 300);
    } else {
      this.eventSubject.next({ type: 'middle-single-tap' });
    }
  }
}
