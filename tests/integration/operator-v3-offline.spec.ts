// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {synchronizeOperatorCommands} from '@/modules/operator-v3/application/sync/sync-commands';
describe('частичная синхронизация operator-v3',()=>{it('сохраняет успехи и конфликты независимо',async()=>{const result=await synchronizeOperatorCommands([{commandId:'a',deviceSequence:1},{commandId:'b',deviceSequence:2},{commandId:'c',deviceSequence:3}],async(command)=>{if(command.commandId==='b')throw Object.assign(new Error('Версия изменилась'),{code:'VERSION_CONFLICT',status:409});return {newVersion:command.deviceSequence};});expect(result.results.map(item=>item.status)).toEqual(['CONFIRMED','CONFLICT','CONFIRMED']);expect(result.confirmed).toBe(2);expect(result.conflicts).toBe(1);});});
