import {afterEach, describe, expect, it, vi} from 'vitest';
import {enqueue, QueueStorageError} from './offline-queue';
afterEach(()=>vi.unstubAllGlobals());
const command={command:'log-production',clientCommandId:'quota-test'};
describe('offline storage failures',()=>{
 it('rejects exhausted storage instead of reporting saved',()=>{vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{throw new Error('QuotaExceededError')}});expect(()=>enqueue(command)).toThrow(QueueStorageError)});
 it('detects storage which silently ignores writes',()=>{vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});expect(()=>enqueue(command)).toThrow(QueueStorageError)});
 it('does not overwrite an unreadable existing queue',()=>{const setItem=vi.fn();vi.stubGlobal('localStorage',{getItem:()=>'{broken',setItem});expect(()=>enqueue(command)).toThrow(QueueStorageError);expect(setItem).not.toHaveBeenCalled()});
});
