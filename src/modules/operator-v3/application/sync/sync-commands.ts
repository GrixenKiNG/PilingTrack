export interface SyncCommandIdentity {commandId:string;deviceSequence:number}
export type SyncItemResult = {commandId:string;status:'CONFIRMED';data:unknown}|{commandId:string;status:'CONFLICT'|'REJECTED';code:string;message:string};
export async function synchronizeOperatorCommands<T extends SyncCommandIdentity>(commands:readonly T[],process:(command:T)=>Promise<unknown>){
  const ordered=[...commands].sort((a,b)=>a.deviceSequence-b.deviceSequence);const results:SyncItemResult[]=[];
  for(const command of ordered){try{results.push({commandId:command.commandId,status:'CONFIRMED',data:await process(command)});}catch(error){const value=error as {code?:string;status?:number;message?:string};results.push({commandId:command.commandId,status:value.status===409?'CONFLICT':'REJECTED',code:value.code??'ОШИБКА_КОМАНДЫ',message:value.message??'Команда не принята сервером'});}}
  return {results,confirmed:results.filter(i=>i.status==='CONFIRMED').length,conflicts:results.filter(i=>i.status==='CONFLICT').length,rejected:results.filter(i=>i.status==='REJECTED').length};
}
