// @vitest-environment node
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createKnowledgeAttempt, verifyKnowledgeAttempt} from './knowledge-attempt';
const actor = {tenantId:'tenant-a',operatorId:'operator-a'};
beforeEach(()=>vi.stubEnv('SESSION_SECRET','test-only-signing-secret-with-more-than-32-characters'));
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers()});
describe('assigned knowledge attempt',()=>{
 it('accepts exactly the assigned set',async()=>{const a=await createKnowledgeAttempt(actor);expect(a.questions).toHaveLength(8);
 await expect(verifyKnowledgeAttempt(actor,a.attemptToken,a.questions.map(q=>({questionId:q.id,picked:0})))).resolves.toBeUndefined();});
 it('rejects a single answer, duplicate questions and another question',async()=>{const a=await createKnowledgeAttempt(actor);const picks=a.questions.map(q=>({questionId:q.id,picked:0}));
 for(const invalid of [picks.slice(0,1),picks.map(()=>picks[0]),[...picks.slice(1),{questionId:'unassigned',picked:0}]])
 await expect(verifyKnowledgeAttempt(actor,a.attemptToken,invalid)).rejects.toThrow();});
 it('rejects another user, tenant, role and a changed token',async()=>{const a=await createKnowledgeAttempt(actor);const picks=a.questions.map(q=>({questionId:q.id,picked:0}));
 for(const wrong of [{...actor,operatorId:'other'},{...actor,tenantId:'other'},{...actor,audience:'ASSISTANT' as const}])
 await expect(verifyKnowledgeAttempt(wrong,a.attemptToken,picks)).rejects.toThrow();
 await expect(verifyKnowledgeAttempt(actor,'x'+a.attemptToken,picks)).rejects.toThrow();});
 it('expires the issued set after 30 minutes',async()=>{vi.useFakeTimers();const a=await createKnowledgeAttempt(actor);vi.advanceTimersByTime(31*60*1000);
 await expect(verifyKnowledgeAttempt(actor,a.attemptToken,a.questions.map(q=>({questionId:q.id,picked:0})))).rejects.toThrow();});
});
