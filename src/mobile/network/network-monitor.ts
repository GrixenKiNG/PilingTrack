/**
 * Network Monitor — Online/Offline Detection
 *
 * Provides:
 * - Real-time network state
 * - Reconnection callbacks
 * - Queue lock (prevent double sync)
 *
 * Usage:
 *   import { networkMonitor } from '@/mobile/network/network-monitor';
 *   networkMonitor.onOnline(() => console.log('back online'));
 */

type NetworkCallback = () => void;

export class NetworkMonitor {
  private onlineCallbacks: NetworkCallback[] = [];
  private offlineCallbacks: NetworkCallback[] = [];
  private _isOnline: boolean;

  constructor() {
    this._isOnline = navigator.onLine;
  }

  /**
   * Current network state.
   */
  get isOnline(): boolean {
    return this._isOnline;
  }

  /**
   * Register callback for when network is restored.
   */
  onOnline(callback: NetworkCallback): () => void {
    this.onlineCallbacks.push(callback);
    return () => {
      this.onlineCallbacks = this.onlineCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Register callback for when network is lost.
   */
  onOffline(callback: NetworkCallback): () => void {
    this.offlineCallbacks.push(callback);
    return () => {
      this.offlineCallbacks = this.offlineCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Start listening to network events.
   */
  start() {
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
  }

  /**
   * Stop listening.
   */
  stop() {
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
  }

  private handleOnline = () => {
    this._isOnline = true;
    console.log('[Network] Online');
    for (const cb of this.onlineCallbacks) {
      cb();
    }
  };

  private handleOffline = () => {
    this._isOnline = false;
    console.log('[Network] Offline');
    for (const cb of this.offlineCallbacks) {
      cb();
    };
  };
}

export const networkMonitor = new NetworkMonitor();
