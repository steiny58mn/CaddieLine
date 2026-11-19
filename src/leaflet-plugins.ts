import L from 'leaflet';

// Ensure window.L and globalThis.L are set for Leaflet plugins like leaflet-rotate
if (typeof window !== 'undefined') {
  (window as any).L = L;
  (globalThis as any).L = L;
}

// Disable Leaflet's built-in MarkerDrag autoPan which causes runaway scrolling on rotated maps
if (typeof window !== 'undefined' && L?.Marker) {
  L.Marker.mergeOptions({
    autoPan: false,
  });

  const markerProto = L.Marker.prototype as any;
  if (markerProto?._initInteraction) {
    const origInitInteraction = markerProto._initInteraction;
    markerProto._initInteraction = function () {
      const ret = origInitInteraction.apply(this, arguments as any);
      if ((this as any).dragging) {
        const proto = Object.getPrototypeOf((this as any).dragging);
        if (proto && proto._adjustPan) {
          proto._adjustPan = function () {};
        }
      }
      return ret;
    };
  }
}

export {};
